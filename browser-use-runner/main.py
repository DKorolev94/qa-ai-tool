from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from browser_use import Agent, Browser
from browser_use.browser.events import AgentFocusChangedEvent, NavigateToUrlEvent as BrowserNavigateToUrlEvent
from browser_use.browser.profile import BrowserProfile
import browser_use.tools.service as browser_tools_service
from views import (
    ArtifactReport,
    LLMCallUsageReport,
    RunRequest,
    RunResponse,
    RunStatus,
    SessionUsageReport,
    TokenUsageReport,
)
from cache_store import load_cached, save_cached

RUNNER_DIR = Path(__file__).resolve().parent
RUNS_DIR = RUNNER_DIR / 'runs'
RUN_SCHEMA_VERSION = '2026-05-18.1'
RUN_FOLDERS = ('raw', 'logs', 'ui', 'metrics', 'media/screenshots')

# User-facing labels for streamed WS 'log' events — keyed by RunRequest.language
_RUNNER_LOG_STRINGS = {
    'ru': {
        'model': 'Модель', 'browser': 'Браузер', 'device': 'Устройство',
        'max_steps': 'Шагов макс', 'locale': 'Локаль', 'step': 'Шаг',
        'total': 'итого', 'cache': 'кэш', 'summary_total': 'Итого',
        'steps_word': 'шагов', 'all_tokens': 'всего', 'tokens_word': 'токенов',
        'sec_suffix': 'с',
    },
    'en': {
        'model': 'Model', 'browser': 'Browser', 'device': 'Device',
        'max_steps': 'Max steps', 'locale': 'Locale', 'step': 'Step',
        'total': 'total', 'cache': 'cache', 'summary_total': 'Total',
        'steps_word': 'steps', 'all_tokens': 'total', 'tokens_word': 'tokens',
        'sec_suffix': 's',
    },
}

# Live run queues: run_id → asyncio.Queue of WS events
_live_runs: dict[str, asyncio.Queue] = {}
# Active run tasks: run_id → asyncio.Task (for cancellation)
_active_tasks: dict[str, asyncio.Task] = {}
# Active agents: run_id → Agent (for graceful stop via agent.stop())
_active_agents: dict[str, Any] = {}

load_dotenv(RUNNER_DIR.parent / '.env')           # project root (base)
load_dotenv(RUNNER_DIR / '.env', override=True)   # local override

@asynccontextmanager
async def _lifespan(_app: FastAPI):
    _configure_browser_globals()
    yield


app = FastAPI(title='Browser-Use Runner', version='0.1.0', lifespan=_lifespan)
logger = logging.getLogger('browser_use_runner')
URL_RE = re.compile(r'https?://[^\s)\]}>"\']+')
_ANSI_RE = re.compile(r'\x1b\[[0-9;]*m')

# Mobile browser preset (iPhone 14)
_MOBILE_UA = (
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) '
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1'
)
_MOBILE_VIEWPORT = {'width': 390, 'height': 844}


@app.get('/health')
def health() -> dict[str, str]:
    return {'status': 'ok'}


# ---------------------------------------------------------------------------
# Runner settings
# ---------------------------------------------------------------------------

def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or value == '':
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'y', 'on'}


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or value == '':
        return default
    return int(value)


def env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None or value == '':
        return default
    return float(value)


# Caps how many browser sessions run at once — an unbounded burst of requests
# (e.g. from bulk review) would otherwise spawn one Chromium per item and
# exhaust host CPU/RAM.
_SESSION_SEMAPHORE = asyncio.Semaphore(env_int('RUNNER_MAX_CONCURRENT_SESSIONS', 3))


_DEFAULT_SYSTEM_INSTRUCTIONS = """
QA agent rules:

Verification:
- NEVER use search_page to verify that a feed, list, collection of posts, or any repeating content is populated — use evaluate() with document.querySelectorAll() instead and count matching elements.
- search_page is only for finding specific known text strings (exact error messages, exact labels, exact headings). If you use | in the query you MUST set regex: True, otherwise | is a literal character, not OR.
- Always search in the language the page is currently displayed in.
- Never call done() immediately after an action. First observe the result: use evaluate() or take a screenshot, then report based on what you actually see.
- If verifying that a social feed, post list, article list, or card grid is displayed: use evaluate() to count items (e.g. document.querySelectorAll('[class*="post"], [class*="feed"], [class*="card"], article, .item').length) before concluding it is empty.

Dynamic content and load states:
- After navigation or form submission, check for loading indicators (spinners, skeletons, progress bars) using evaluate(). If present, wait() 2-3 seconds and recheck before asserting.
- If expected content is not found on first check, wait 2-3 seconds and check again. A single negative result is not enough to call a test failed.
- Content below the fold may not be rendered yet — scroll down before asserting that list items, cards, or feed content do not exist.
- If a page shows 0 items but you expect items to be there, verify the page finished loading (no spinners) before reporting failure.

Robustness:
- If search_page returns 0 matches, ALWAYS try evaluate() or screenshot as fallback before concluding the content is absent.
- Do not treat a timeout or navigation delay as a test failure — retry once after waiting.
- If an unexpected overlay, modal, or cookie banner is blocking the page, close or dismiss it before verification.

Reporting:
- When calling done(), state: what was expected, what was actually observed (counts, text, screenshot analysis), and why the test passed or failed. Do not say "test passed" or "failed" without specifics.
""".strip()


def runner_env_request(request: RunRequest) -> RunRequest:
    # Merge default instructions with any user-supplied ones
    base = os.getenv('RUNNER_SYSTEM_INSTRUCTIONS', _DEFAULT_SYSTEM_INSTRUCTIONS)
    if request.system_instructions and request.system_instructions.strip():
        merged_instructions: str | None = f'{base}\n\n{request.system_instructions.strip()}'
    else:
        merged_instructions = base

    return request.model_copy(
        update={
            'preflight_url': env_bool('RUNNER_PREFLIGHT_URL', True),
            'preflight_timeout_sec': env_float('RUNNER_PREFLIGHT_TIMEOUT_SEC', 45),
            'preflight_retries': env_int('RUNNER_PREFLIGHT_RETRIES', 3),
            'preflight_verify_ssl': env_bool('RUNNER_PREFLIGHT_VERIFY_SSL', False),
            'navigation_timeout_sec': env_float('RUNNER_NAVIGATION_TIMEOUT_SEC', 90),
            'navigation_wait_until': os.getenv('RUNNER_NAVIGATION_WAIT_UNTIL', 'domcontentloaded'),
            'action_timeout_sec': env_float('RUNNER_ACTION_TIMEOUT_SEC', 180),
            'llm_timeout_sec': env_int('RUNNER_LLM_TIMEOUT_SEC', 90),
            'max_steps': env_int('RUNNER_MAX_STEPS', 30),
            'use_vision': env_bool('RUNNER_USE_VISION', False),
            'headless': env_bool('RUNNER_HEADLESS', False),
            'system_instructions': merged_instructions,
            'llm': request.llm.model_copy(
                update={k: v for k, v in {'model': os.getenv('RUNNER_LLM_MODEL')}.items() if v is not None}
            ),
        }
    )


def apply_runner_settings(request: RunRequest) -> RunRequest:
    if env_bool('RUNNER_ALLOW_REQUEST_OVERRIDES', False):
        return request
    return runner_env_request(request)


@app.get('/settings')
def settings() -> dict[str, Any]:
    return {
        'request_overrides': env_bool('RUNNER_ALLOW_REQUEST_OVERRIDES', False),
        'browser': {
            'headless': env_bool('RUNNER_HEADLESS', False),
            'use_vision': env_bool('RUNNER_USE_VISION', False),
        },
        'limits': {
            'max_steps': env_int('RUNNER_MAX_STEPS', 30),
            'navigation_timeout_sec': env_float('RUNNER_NAVIGATION_TIMEOUT_SEC', 90),
            'navigation_wait_until': os.getenv('RUNNER_NAVIGATION_WAIT_UNTIL', 'domcontentloaded'),
            'action_timeout_sec': env_float('RUNNER_ACTION_TIMEOUT_SEC', 180),
            'llm_timeout_sec': env_int('RUNNER_LLM_TIMEOUT_SEC', 90),
        },
        'preflight': {
            'enabled': env_bool('RUNNER_PREFLIGHT_URL', True),
            'timeout_sec': env_float('RUNNER_PREFLIGHT_TIMEOUT_SEC', 45),
            'retries': env_int('RUNNER_PREFLIGHT_RETRIES', 3),
            'verify_ssl': env_bool('RUNNER_PREFLIGHT_VERIFY_SSL', False),
        },
        'llm': {
            'model': os.getenv('RUNNER_LLM_MODEL'),
            'has_api_key': bool(os.getenv('DEEPSEEK_API_KEY')),
        },
    }


# ---------------------------------------------------------------------------
# Small file/log helpers
# ---------------------------------------------------------------------------

def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding='utf-8')


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8') as file:
        for row in rows:
            file.write(json.dumps(row, ensure_ascii=False, default=str) + '\n')


def append_event(run_dir: Path, event: str, data: dict[str, Any] | None = None) -> None:
    line = {
        'timestamp': datetime.now().isoformat(timespec='seconds'),
        'event': event,
        **(data or {}),
    }
    with (run_dir / 'logs' / 'events.jsonl').open('a', encoding='utf-8') as file:
        file.write(json.dumps(line, ensure_ascii=False, default=str) + '\n')


def create_run_dir(test_case_id: str | None) -> Path:
    safe_case_id = re.sub(r'[^a-zA-Z0-9_.-]+', '_', test_case_id or 'unknown').strip('._-') or 'unknown'
    run_id = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{safe_case_id}_{uuid.uuid4().hex[:8]}"
    run_dir = RUNS_DIR / run_id
    for folder in RUN_FOLDERS:
        (run_dir / folder).mkdir(parents=True, exist_ok=True)
    return run_dir


def mark_latest_run(run_dir: Path) -> None:
    if run_dir.name == 'latest':
        return

    latest = RUNS_DIR / 'latest'
    try:
        if latest.exists() or latest.is_symlink():
            latest.unlink()
        latest.symlink_to(run_dir, target_is_directory=True)
    except OSError as exc:
        logger.warning('Could not update latest run symlink: %s', exc)


def attach_run_log(run_dir: Path) -> logging.Handler:
    handler = logging.FileHandler(run_dir / 'logs' / 'runner.log', encoding='utf-8')
    handler.setLevel(logging.DEBUG)
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s [%(name)s] %(message)s'))

    root_logger = logging.getLogger()
    root_logger.addHandler(handler)
    root_logger.setLevel(min(root_logger.level or logging.INFO, logging.DEBUG))
    # browser_use has propagate=False — must attach directly
    logging.getLogger('browser_use').addHandler(handler)
    return handler


def detach_run_log(handler: logging.Handler) -> None:
    logging.getLogger().removeHandler(handler)
    logging.getLogger('browser_use').removeHandler(handler)
    handler.close()


class WsLogHandler(logging.Handler):
    """Push log records to a WebSocket queue in real-time."""

    def __init__(self, queue: asyncio.Queue, started_at: float, loop: asyncio.AbstractEventLoop) -> None:
        super().__init__(level=logging.DEBUG)
        self.queue = queue
        self.started_at = started_at
        self.loop = loop
        self.setFormatter(logging.Formatter('%(message)s'))

    def emit(self, record: logging.LogRecord) -> None:
        try:
            lvl = record.levelno
            name = record.name

            # Skip pure noise: token cost, event bus internals, raw protocols
            if name == 'cost' or name.startswith('bubus') or name.startswith('cdp_use') or name.startswith('websockets'):
                return

            # browser_use.browser / browser_use.dom: only errors (too chatty at INFO)
            if (name.startswith('browser_use.browser') or name.startswith('browser_use.dom')) and lvl < logging.ERROR:
                return

            # Everything else: INFO+
            if lvl < logging.INFO:
                return

            ws_level = 'error' if lvl >= logging.ERROR else 'info'
            source = 'agent' if name.startswith('browser_use') else 'session'

            # Normalize dynamic agent logger names like "browser_use.Agent🅰 abc ⇢ …"
            if name.startswith('browser_use.agent') or ('Agent' in name and name.startswith('browser_use')):
                cat = 'agent'
            elif name.startswith('browser_use.tools') or ('tools' in name and name.startswith('browser_use')):
                cat = 'tools'
            elif name.startswith('browser_use'):
                cat = name.split('.')[-1]
            else:
                cat = name.split('.')[-1] if '.' in name else name

            msg = _ANSI_RE.sub('', self.format(record))
            event = {
                'type': 'log',
                'level': ws_level,
                'category': cat,
                'message': msg,
                'elapsed_sec': round(time.monotonic() - self.started_at, 1),
                'source': source,
            }
            self.loop.call_soon_threadsafe(self.queue.put_nowait, event)
        except Exception:
            pass


def redact_request(request: RunRequest) -> dict[str, Any]:
    d = request.model_dump(mode='json')
    if d.get('sensitive_data'):
        d['sensitive_data'] = {k: '***' for k in d['sensitive_data']}
    return d


# ---------------------------------------------------------------------------
# Input checks and browser-use setup
# ---------------------------------------------------------------------------

def get_start_url(request: RunRequest) -> str | None:
    if request.start_url:
        return str(request.start_url)
    match = URL_RE.search(request.task)
    return match.group(0).rstrip('.,;') if match else None


async def preflight_url(
    url: str,
    timeout_sec: float,
    retries: int,
    verify_ssl: bool,
) -> tuple[bool, str, list[dict[str, Any]]]:
    attempts: list[dict[str, Any]] = []

    for attempt in range(1, retries + 2):
        started_at = time.monotonic()
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=timeout_sec, verify=verify_ssl) as client:
                response = await client.get(url)
        except Exception as exc:
            attempts.append(
                {
                    'attempt': attempt,
                    'ok': False,
                    'error_type': type(exc).__name__,
                    'error': str(exc),
                    'elapsed_sec': round(time.monotonic() - started_at, 2),
                }
            )
            continue

        elapsed_sec = round(time.monotonic() - started_at, 2)
        attempts.append({'attempt': attempt, 'ok': True, 'status_code': response.status_code, 'elapsed_sec': elapsed_sec})
        if response.status_code < 500:
            return True, f'Preflight ok for {url}: HTTP {response.status_code}', attempts

    last = attempts[-1] if attempts else {}
    reason = last.get('error') or f"HTTP {last.get('status_code', 'unknown')}"
    return False, f'Preflight failed for {url}: {reason}', attempts


def _configure_browser_globals() -> None:
    nav_timeout = env_float('RUNNER_NAVIGATION_TIMEOUT_SEC', 90)
    action_timeout = env_float('RUNNER_ACTION_TIMEOUT_SEC', 180)
    wait_until = os.getenv('RUNNER_NAVIGATION_WAIT_UNTIL', 'domcontentloaded')
    os.environ['TIMEOUT_NavigateToUrlEvent'] = str(nav_timeout)
    os.environ['TIMEOUT_NavigationStartedEvent'] = str(nav_timeout)
    os.environ['TIMEOUT_NavigationCompleteEvent'] = str(nav_timeout)
    os.environ['BROWSER_USE_ACTION_TIMEOUT_S'] = str(action_timeout)
    _wt = wait_until

    def _navigate_event(*args: Any, **kwargs: Any) -> BrowserNavigateToUrlEvent:
        kwargs.setdefault('wait_until', _wt)
        return BrowserNavigateToUrlEvent(*args, **kwargs)

    browser_tools_service.NavigateToUrlEvent = _navigate_event


from llm_factory import create_llm as _create_llm_for_provider


def _extract_summary(raw: str | None) -> str:
    if not raw:
        return ''
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return str(data.get('summary') or data.get('result') or raw)
    except (json.JSONDecodeError, ValueError):
        pass
    return raw


def create_llm(request: RunRequest) -> Any:
    try:
        return _create_llm_for_provider(request.llm.model, request.llm_timeout_sec, request.llm.max_tokens)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


def create_browser(request: RunRequest, start_url: str | None = None) -> Browser:
    cfg = request.browser_profile
    profile_kwargs: dict[str, Any] = {'headless': request.headless}

    # Opt-in SSRF guard: off by default because a real, legitimate target here
    # can be a local/staging/internal environment addressed by bare IP (no
    # DNS set up yet) — this tool needs to reach whatever the user points it
    # at. Turn on if the agent should never be steerable (e.g. via an
    # on-page prompt injection) toward cloud metadata (169.254.169.254),
    # localhost, or other internal addresses.
    profile_kwargs['block_ip_addresses'] = env_bool('RUNNER_BLOCK_IP_ADDRESSES', False)

    if request.sensitive_data:
        # browser-use itself warns that sensitive_data with no allowed_domains
        # exposes credentials to prompt injection from any page the agent
        # navigates to — lock it to the task's own host when we know it.
        host = urlparse(start_url).hostname if start_url else None
        if host:
            profile_kwargs['allowed_domains'] = [host, f'*.{host}']
        else:
            logger.warning('sensitive_data provided with no start_url to lock allowed_domains to')

    if cfg.is_mobile:
        profile_kwargs['user_agent'] = cfg.user_agent or _MOBILE_UA
        profile_kwargs['device_scale_factor'] = cfg.device_scale_factor or 2.0
        profile_kwargs['viewport'] = {
            'width': cfg.viewport_width or _MOBILE_VIEWPORT['width'],
            'height': cfg.viewport_height or _MOBILE_VIEWPORT['height'],
        }
    else:
        if cfg.user_agent:
            profile_kwargs['user_agent'] = cfg.user_agent
        if cfg.device_scale_factor:
            profile_kwargs['device_scale_factor'] = cfg.device_scale_factor
        if cfg.viewport_width and cfg.viewport_height:
            profile_kwargs['viewport'] = {'width': cfg.viewport_width, 'height': cfg.viewport_height}

    extra_args: list[str] = []
    if cfg.locale:
        # --lang sets UI language; --accept-languages sets navigator.language + Accept-Language header
        extra_args.append(f'--lang={cfg.locale}')
        extra_args.append(f'--accept-languages={cfg.locale}')
    if cfg.is_mobile:
        # Enable touch API so apps detect mobile browser
        extra_args.append('--touch-events=enabled')
    if extra_args:
        profile_kwargs['args'] = extra_args

    # NOTE: BrowserProfile.env is never passed to subprocess by browser-use (bug in library).
    # TZ is applied at os.environ level in _stream_run before browser creation.

    return Browser(browser_profile=BrowserProfile(**profile_kwargs))


# ---------------------------------------------------------------------------
# Token usage
# ---------------------------------------------------------------------------

def usage_from_llm_usage(usage: Any, estimated: bool = False) -> TokenUsageReport:
    prompt_tokens = int(getattr(usage, 'prompt_tokens', 0) or 0)
    completion_tokens = int(getattr(usage, 'completion_tokens', 0) or 0)
    total_tokens = int(getattr(usage, 'total_tokens', 0) or 0) or prompt_tokens + completion_tokens
    return TokenUsageReport(
        prompt_tokens=prompt_tokens,
        prompt_cached_tokens=getattr(usage, 'prompt_cached_tokens', None),
        prompt_cache_creation_tokens=getattr(usage, 'prompt_cache_creation_tokens', None),
        prompt_image_tokens=getattr(usage, 'prompt_image_tokens', None),
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        estimated=estimated,
    )


def sum_usage(items: list[TokenUsageReport], estimated: bool = False) -> TokenUsageReport:
    return TokenUsageReport(
        prompt_tokens=sum(item.prompt_tokens for item in items),
        prompt_cached_tokens=sum(item.prompt_cached_tokens or 0 for item in items) or None,
        prompt_cache_creation_tokens=sum(item.prompt_cache_creation_tokens or 0 for item in items) or None,
        prompt_image_tokens=sum(item.prompt_image_tokens or 0 for item in items) or None,
        completion_tokens=sum(item.completion_tokens for item in items),
        total_tokens=sum(item.total_tokens for item in items),
        estimated=estimated or any(item.estimated for item in items),
    )


def estimate_usage_from_history(history: Any) -> tuple[SessionUsageReport, list[LLMCallUsageReport]]:
    llm_calls: list[LLMCallUsageReport] = []
    for call_index, item in enumerate(history.model_dump().get('history', []), start=1):
        text = json.dumps(
            {
                'model_output': item.get('model_output'),
                'result': item.get('result'),
                'metadata': item.get('metadata'),
            },
            ensure_ascii=False,
            default=str,
        )
        tokens = max(1, round(len(text) / 4))
        llm_calls.append(
            LLMCallUsageReport(
                llm_call_index=call_index,
                completion_tokens=tokens,
                total_tokens=tokens,
                estimated=True,
            )
        )

    total = sum_usage(llm_calls, estimated=True) if llm_calls else TokenUsageReport(estimated=True)
    return SessionUsageReport(**total.model_dump(mode='json'), llm_call_count=len(llm_calls)), llm_calls


def collect_usage(agent: Agent, history: Any) -> tuple[SessionUsageReport, list[LLMCallUsageReport]]:
    token_service = getattr(agent, 'token_cost_service', None)
    entries = list(getattr(token_service, 'usage_history', []) or [])

    if entries:
        llm_calls: list[LLMCallUsageReport] = []
        usage_by_model: dict[str, list[TokenUsageReport]] = {}

        for call_index, entry in enumerate(entries, start=1):
            model = str(getattr(entry, 'model', '') or getattr(agent.llm, 'model', '') or 'unknown')
            usage = usage_from_llm_usage(entry.usage)
            llm_calls.append(
                LLMCallUsageReport(
                    **usage.model_dump(mode='json'),
                    llm_call_index=call_index,
                    model=model,
                )
            )
            usage_by_model.setdefault(model, []).append(usage)

        total = sum_usage(llm_calls)
        return (
            SessionUsageReport(
                **total.model_dump(mode='json'),
                llm_call_count=len(llm_calls),
                models={model: sum_usage(items) for model, items in usage_by_model.items()},
            ),
            llm_calls,
        )

    history_usage = getattr(history, 'usage', None)
    if history_usage is not None:
        prompt_tokens = int(getattr(history_usage, 'total_prompt_tokens', 0) or 0)
        completion_tokens = int(getattr(history_usage, 'total_completion_tokens', 0) or 0)
        total_tokens = int(getattr(history_usage, 'total_tokens', 0) or 0) or prompt_tokens + completion_tokens
        usage = SessionUsageReport(
            prompt_tokens=prompt_tokens,
            prompt_cached_tokens=getattr(history_usage, 'total_prompt_cached_tokens', None),
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            llm_call_count=int(getattr(history_usage, 'entry_count', 0) or 0),
        )
        return usage, []

    return estimate_usage_from_history(history)


# ---------------------------------------------------------------------------
# Run artifacts for humans and future UI
# ---------------------------------------------------------------------------

SERVICE_ACTIONS = {'write_file', 'replace_file', 'read_file'}

_RETRY_KEYWORDS = (
    'retry', 'retrying', 'try again', 'try another', 'try a different',
    'investigate', 'investigating',
    'wait for', 'waiting for', 'wait until',
    'снова', 'заново', 'ещё раз', 'повтор', 'повторить', 'повторю', 'повторяю',
    'попробую', 'попробовать', 'попробуем',
    'не удалось', 'не смог', 'не могу', 'подождём', 'подождем', 'ожидаю', 'ожидаем',
    'не активна', 'недоступна', 'недоступен', 'не кликабельна',
)


def detect_instability_flags(
    actions: list[dict[str, Any]],
    next_goal: str,
    duration_sec: float | None,
    prev_next_goal: str,
) -> list[str]:
    flags: list[str] = []
    if any(a.get('name') == 'wait' for a in actions):
        flags.append('wait_action')
    ng_lower = next_goal.lower()
    if any(kw in ng_lower for kw in _RETRY_KEYWORDS):
        flags.append('retry_keyword')
    if duration_sec is not None and duration_sec > 25:
        flags.append('high_duration')
    if next_goal.strip() and prev_next_goal.strip() and next_goal.strip() == prev_next_goal.strip():
        flags.append('duplicate_next_goal')
    return flags


def short_text(value: Any, limit: int = 240) -> str:
    text = str(value or '').replace('\r', ' ').replace('\n', ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + '...'


def usage_summary(usage: SessionUsageReport | None) -> dict[str, Any]:
    if usage is None:
        return {}
    cached = usage.prompt_cached_tokens or 0
    return {
        'prompt_tokens': usage.prompt_tokens,
        'prompt_cached_tokens': cached,
        'prompt_cache_miss_tokens': max(usage.prompt_tokens - cached, 0),
        'completion_tokens': usage.completion_tokens,
        'total_tokens': usage.total_tokens,
        'llm_call_count': usage.llm_call_count,
        'estimated': usage.estimated,
    }


def copy_screenshots(run_dir: Path, screenshot_paths: list[str]) -> list[dict[str, Any]]:
    screenshots = []
    for step, raw_path in enumerate(screenshot_paths, start=1):
        source = Path(raw_path)
        destination = run_dir / 'media' / 'screenshots' / f'step_{step:03d}{source.suffix or ".png"}'

        if source.exists():
            shutil.copy2(source, destination)
        elif not destination.exists():
            continue

        screenshots.append(
            {
                'step': step,
                'path': str(destination.relative_to(run_dir)),
                'size_bytes': destination.stat().st_size,
            }
        )
    return screenshots


def action_name(action: dict[str, Any]) -> str:
    return next(iter(action), 'unknown') if action else 'unknown'


def compact_action(action: dict[str, Any]) -> dict[str, Any]:
    name = action_name(action)
    data = action.get(name) if action else {}

    if not isinstance(data, dict):
        return {'name': name, 'input': data}

    allowed_fields = {
        'navigate': ('url', 'new_tab'),
        'input': ('index', 'text', 'clear'),
        'click': ('index', 'xpath'),
        'wait': ('seconds',),
        'done': ('success', 'text'),
        'evaluate': ('code',),
        'extract': ('query',),
        'scroll': ('amount', 'direction'),
        'send_keys': ('keys',),
        'go_back': (),
    }
    fields = allowed_fields.get(name)
    if fields is None:
        compact = {key: value for key, value in data.items() if key not in {'content', 'old_str', 'new_str'}}
    else:
        compact = {key: data.get(key) for key in fields if key in data}

    if 'code' in compact:
        compact['code'] = short_text(compact['code'], 180)
    if 'query' in compact:
        compact['query'] = short_text(compact['query'], 180)
    return {'name': name, 'input': compact}


def compact_result(result: dict[str, Any]) -> dict[str, Any]:
    return {
        'error': short_text(result.get('error'), 500) if result.get('error') else None,
        'content': short_text(result.get('extracted_content'), 320) if result.get('extracted_content') else None,
        'is_done': result.get('is_done'),
        'success': result.get('success'),
    }


def summarize_actions(actions: list[dict[str, Any]]) -> str:
    if not actions:
        return ''

    parts = []
    current_name = actions[0].get('name', 'unknown')
    current_count = 0
    for action in actions:
        name = action.get('name', 'unknown')
        if name == current_name:
            current_count += 1
            continue
        parts.append(f'{current_name} x{current_count}' if current_count > 1 else current_name)
        current_name = name
        current_count = 1

    parts.append(f'{current_name} x{current_count}' if current_count > 1 else current_name)
    return ', '.join(parts)


def build_steps(history: Any, screenshots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    screenshot_by_step = {item['step']: item for item in screenshots}
    steps = []
    prev_next_goal = ''
    prev_had_errors = False
    prev_error_msg = ''

    history_items = history.model_dump().get('history', [])

    for step_number, item in enumerate(history_items, start=1):
        metadata = item.get('metadata') or {}
        model_output = item.get('model_output') or {}
        raw_actions = model_output.get('action', [])
        current_state = model_output.get('current_state') or {}
        next_goal = str(current_state.get('next_goal') or model_output.get('next_goal') or '').strip()
        raw_results = item.get('result', [])
        actions = []
        results = []
        service_actions = []
        done_text = ''
        for raw_action in raw_actions:
            if action_name(raw_action) == 'done':
                done_data = raw_action.get('done') or {}
                if isinstance(done_data, dict):
                    done_text = short_text(str(done_data.get('text') or '').strip(), 400)
                break

        for index, action in enumerate(raw_actions):
            name = action_name(action)
            result = raw_results[index] if index < len(raw_results) else {}
            if name in SERVICE_ACTIONS:
                service_actions.append(name)
                continue
            actions.append(compact_action(action))
            if result:
                results.append(compact_result(result))

        for result in raw_results[len(raw_actions):]:
            if result.get('error') or result.get('is_done'):
                results.append(compact_result(result))

        all_results = [compact_result(result) for result in raw_results]
        errors = [result['error'] for result in all_results if result.get('error')]
        contents = [result['content'] for result in results if result.get('content')]

        duration_sec = None
        if metadata.get('step_start_time') and metadata.get('step_end_time'):
            duration_sec = round(float(metadata['step_end_time'] - metadata['step_start_time']), 2)

        # evaluation_previous_goal of step N+1 = LLM's verdict on what step N accomplished
        next_item = history_items[step_number] if step_number < len(history_items) else None
        next_mo = (next_item.get('model_output') or {}) if next_item else {}
        eval_result = str(next_mo.get('evaluation_previous_goal') or '').strip()
        _eval_lower = eval_result.lower()
        if _eval_lower in ('start', 'starting', 'initial') or not eval_result:
            eval_result = ''

        summary = errors[0] if errors else ''
        if not summary and done_text:
            summary = done_text
        if not summary and eval_result:
            summary = eval_result
        if not summary and actions:
            summary = summarize_actions(actions)
        if not summary and contents:
            summary = contents[0]

        # If LLM eval explicitly signals failure but no tool error was recorded,
        # treat it as an error so the UI doesn't show a green checkmark with "Failed..." text.
        _FAIL_KEYWORDS = ('failed to', 'не удалось', 'не смог', 'could not', 'unable to', 'failure', 'unsuccessful')
        eval_signals_failure = eval_result and any(kw in eval_result.lower() for kw in _FAIL_KEYWORDS)
        step_status = 'error' if (errors or eval_signals_failure) else 'ok'

        instability_flags = detect_instability_flags(actions, next_goal, duration_sec, prev_next_goal)
        is_retry = prev_had_errors
        retry_error_msg = prev_error_msg if is_retry else ''
        prev_next_goal = next_goal
        prev_had_errors = bool(errors) or eval_signals_failure
        prev_error_msg = errors[0] if errors else (eval_result if eval_signals_failure else '')

        steps.append(
            {
                'step': step_number,
                'status': step_status,
                'summary': short_text(summary),
                'next_goal': next_goal,
                'instability_flags': instability_flags,
                'is_retry': is_retry,
                'retry_error_msg': retry_error_msg,
                'url': item.get('state', {}).get('url'),
                'title': item.get('state', {}).get('title'),
                'duration_sec': duration_sec,
                'actions': actions,
                'results': results,
                'service_actions': service_actions,
                'screenshot': screenshot_by_step.get(step_number),
            }
        )

    return steps


def count_actions(steps: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for step in steps:
        for action in step.get('actions', []):
            name = action.get('name', 'unknown')
            counts[name] = counts.get(name, 0) + 1
    return dict(sorted(counts.items()))


def build_analysis(
    response: RunResponse,
    steps: list[dict[str, Any]],
    screenshots: list[dict[str, Any]],
) -> dict[str, Any]:
    failed_steps = [step for step in steps if step.get('status') == 'error']
    service_action_count = sum(len(step.get('service_actions', [])) for step in steps)
    final_url = response.artifacts.visited_urls[-1] if response.artifacts.visited_urls else None
    warnings = []

    for step in steps:
        for result in step.get('results', []):
            content = result.get('content') or ''
            if '⚠️' in content:
                warnings.append({'step': step['step'], 'message': content})

    return {
        'run_id': response.run_id,
        'test_case_id': response.test_case_id,
        'status': response.status.value,
        'duration_sec': response.duration_sec,
        'steps_count': response.steps_count,
        'ui_steps_count': len(steps),
        'browser_action_counts': count_actions(steps),
        'service_action_count': service_action_count,
        'errors_count': len(response.errors),
        'failed_steps': [{'step': step['step'], 'summary': step['summary']} for step in failed_steps],
        'warnings': warnings[:20],
        'final_url': final_url,
        'screenshots_count': len(screenshots),
        'instability_step_count': response.instability_step_count,
        'usage': usage_summary(response.usage),
    }


def build_manifest(response: RunResponse, screenshots: list[dict[str, Any]], analysis: dict[str, Any]) -> dict[str, Any]:
    return {
        'schema_version': RUN_SCHEMA_VERSION,
        'run_id': response.run_id,
        'test_case_id': response.test_case_id,
        'status': response.status.value,
        'summary': response.summary,
        'errors': response.errors,
        'created_at': datetime.now().isoformat(timespec='seconds'),
        'duration_sec': response.duration_sec,
        'steps_count': response.steps_count,
        'instability_step_count': response.instability_step_count,
        'retry_step_count': response.retry_step_count,
        'errors_count': len(response.errors),
        'final_url': analysis.get('final_url'),
        'usage': usage_summary(response.usage),
        'ui': {
            'report': 'report.md',
            'analysis': 'ui/analysis.json',
            'steps': 'ui/steps.json',
            'timeline': 'ui/timeline.jsonl',
            'usage_summary': 'metrics/usage_summary.json',
        },
        'media': {'screenshots': screenshots},
        'raw': {
            'api_request': 'raw/api_request.json',
            'request': 'raw/request.json',
            'agent_result': 'raw/agent_result.json',
            'result': 'raw/result.json',
            'usage': 'raw/usage.json',
            'history': 'raw/history.json',
        },
        'logs': {'events': 'logs/events.jsonl', 'runner': 'logs/runner.log'},
    }


def format_tokens(value: int | None) -> str:
    return f'{value or 0:,}'.replace(',', ' ')


def write_report(run_dir: Path, response: RunResponse, analysis: dict[str, Any]) -> None:
    usage = response.usage
    lines = [
        f'# Browser-Use Run {response.run_id or ""}'.strip(),
        '',
        f'- Test case: `{response.test_case_id or "unknown"}`',
        f'- Status: `{response.status.value}`',
        f'- Duration: `{response.duration_sec}s`',
        f'- Steps: `{response.steps_count}`',
        f'- Browser actions: `{sum(analysis.get("browser_action_counts", {}).values())}`',
        f'- Service actions hidden from UI: `{analysis.get("service_action_count", 0)}`',
        f'- Errors: `{len(response.errors)}`',
    ]

    if usage:
        lines += [
            f'- LLM calls: `{usage.llm_call_count}`',
            f'- Total tokens: `{format_tokens(usage.total_tokens)}`',
            f'- Prompt tokens: `{format_tokens(usage.prompt_tokens)}`',
            f'- Cached prompt tokens: `{format_tokens(usage.prompt_cached_tokens)}`',
            f'- Completion tokens: `{format_tokens(usage.completion_tokens)}`',
            f'- Usage estimated: `{usage.estimated}`',
        ]

    if analysis.get('screenshots_count'):
        lines.append(f'- Screenshots: `{analysis["screenshots_count"]}`')

    if analysis.get('final_url'):
        lines += ['', '## Final URL', '', analysis['final_url']]

    lines += ['', '## Summary', '', response.summary or 'No summary.']

    if response.errors:
        lines += ['', '## Errors', '']
        lines += [f'- {short_text(error, 500)}' for error in response.errors[:10]]

    if analysis.get('warnings'):
        lines += ['', '## Warnings', '']
        for warning in analysis['warnings'][:10]:
            lines.append(f'- Step {warning["step"]}: {short_text(warning["message"], 300)}')

    lines += [
        '',
        '## Files',
        '',
        '- `ui/analysis.json` - compact diagnostics for quick review',
        '- `ui/steps.json` - compact browser-step list',
        '- `raw/history.json` - full browser-use history',
        '- `raw/usage.json` - LLM calls and session usage',
        '- `logs/runner.log` - captured cost/debug logs',
        '- `media/screenshots/` - step screenshots',
    ]
    (run_dir / 'report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def save_artifacts(
    run_dir: Path,
    response: RunResponse,
    history: Any | None,
    request: RunRequest | None = None,
) -> RunResponse:
    screenshots = copy_screenshots(run_dir, response.artifacts.screenshot_paths)
    steps = build_steps(history, screenshots) if history is not None else []
    saved_paths = [str(run_dir / s['path']) for s in screenshots]

    # Exclude trivial done-action steps (no verification text); keep done steps with real text
    # This matches frontend isDoneStep: filter if done action present AND summary is empty/'done'
    non_done_steps = [
        s for s in steps
        if not (
            any(a.get('name') == 'done' for a in s.get('actions', []))
            and (not s.get('summary') or s.get('summary') == 'done')
        )
    ]
    instability_count = len([s for s in non_done_steps if s.get('instability_flags')])
    retry_count = len([s for s in non_done_steps if s.get('is_retry')])

    response = response.model_copy(update={
        'artifacts': response.artifacts.model_copy(update={'screenshot_paths': saved_paths}),
        'steps_count': len(non_done_steps),
        'instability_step_count': instability_count,
        'retry_step_count': retry_count,
    })
    analysis = build_analysis(response, steps, screenshots)

    write_json(run_dir / 'raw' / 'agent_result.json', response.model_dump(mode='json'))
    write_json(run_dir / 'raw' / 'result.json', response.model_dump(mode='json'))
    write_json(run_dir / 'metrics' / 'usage_summary.json', usage_summary(response.usage))
    write_json(run_dir / 'ui' / 'analysis.json', analysis)
    write_json(run_dir / 'ui' / 'steps.json', steps)
    write_jsonl(run_dir / 'ui' / 'timeline.jsonl', steps)
    write_json(run_dir / 'manifest.json', build_manifest(response, screenshots, analysis))
    write_report(run_dir, response, analysis)
    mark_latest_run(run_dir)
    return response


def finish_run(
    run_dir: Path,
    response: RunResponse,
    history: Any | None = None,
    request: RunRequest | None = None,
) -> RunResponse:
    response = save_artifacts(run_dir, response, history, request)
    append_event(
        run_dir,
        'finished',
        {
            'status': response.status.value,
            'duration_sec': response.duration_sec,
            'total_tokens': response.usage.total_tokens if response.usage else 0,
            'estimated_usage': response.usage.estimated if response.usage else None,
        },
    )
    return response


def fail_run(
    run_dir: Path,
    test_case_id: str | None,
    started_at: float,
    error_type: str,
    message: str,
    status_code: int | None = None,
) -> RunResponse:
    error = {
        'type': error_type,
        'message': message,
        'status_code': status_code,
        'duration_sec': round(time.monotonic() - started_at, 2),
    }
    empty_usage = SessionUsageReport(llm_call_count=0)
    write_json(run_dir / 'raw' / 'error.json', error)
    write_json(run_dir / 'raw' / 'history.json', {'history': []})
    write_json(run_dir / 'raw' / 'usage.json', {'session': empty_usage.model_dump(mode='json'), 'llm_calls': []})

    response = RunResponse(
        test_case_id=test_case_id,
        status=RunStatus.blocked,
        summary=message,
        steps_count=0,
        errors=[message],
        artifacts=ArtifactReport(),
        duration_sec=error['duration_sec'],
        run_id=run_dir.name,
        run_dir=str(run_dir),
        usage=empty_usage,
    )
    return finish_run(run_dir, response)


# ---------------------------------------------------------------------------
# API for future UI and diagnostics
# ---------------------------------------------------------------------------

@app.get('/runs')
def list_runs(limit: int = 20) -> dict[str, Any]:
    if not RUNS_DIR.exists():
        return {'runs': []}

    runs = []
    for run_dir in sorted((path for path in RUNS_DIR.iterdir() if path.is_dir() and path.name != 'latest'), reverse=True):
        manifest_path = run_dir / 'manifest.json'
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            except json.JSONDecodeError:
                manifest = {'run_id': run_dir.name, 'status': 'unknown'}
        else:
            manifest = {'run_id': run_dir.name, 'status': 'legacy'}

        manifest['run_dir'] = str(run_dir)
        runs.append(manifest)
        if len(runs) >= limit:
            break

    return {'runs': runs}


@app.get('/runs/{run_id}')
def get_run(run_id: str) -> dict[str, Any]:
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', run_id):
        raise HTTPException(status_code=400, detail='Invalid run_id')

    manifest_path = RUNS_DIR / run_id / 'manifest.json'
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail='Run manifest not found')

    return json.loads(manifest_path.read_text(encoding='utf-8'))


# ---------------------------------------------------------------------------
# Main run flow
# ---------------------------------------------------------------------------

async def _try_replay(
    request: RunRequest,
    run_dir: Path,
    started_at: float,
    task: str,
    llm: Any,
    browser: Browser,
    cached_path: Path,
) -> RunResponse | None:
    agent = Agent(
        task=task,
        llm=llm,
        browser=browser,
        use_vision=request.use_vision,
        extend_system_message=request.system_instructions,
        llm_timeout=request.llm_timeout_sec,
        step_timeout=int(request.action_timeout_sec),
        sensitive_data=request.sensitive_data or None,
        calculate_cost=True,
    )
    try:
        results = await agent.load_and_rerun(cached_path, skip_failures=False)
    except Exception as exc:
        logger.warning(f'Cache replay failed for test_case_id={request.test_case_id}: {exc}')
        return None

    write_json(run_dir / 'raw' / 'rerun_results.json', [r.model_dump(mode='json') for r in results])
    final = results[-1] if results else None
    summary_text = ((final.extracted_content if final else None) or (final.long_term_memory if final else None) or '').strip()
    success = final.success if final else None
    if success is True:
        status = RunStatus.passed
    elif success is False:
        status = RunStatus.blocked if summary_text.lower().startswith('blocked') else RunStatus.failed
    else:
        status = RunStatus.blocked

    errors = [r.error for r in results if r.error]
    return RunResponse(
        test_case_id=request.test_case_id,
        status=status,
        summary=summary_text or 'Replayed from cache.',
        steps_count=max(len(results) - 1, 0),
        errors=errors,
        artifacts=ArtifactReport(),
        duration_sec=round(time.monotonic() - started_at, 2),
        run_id=run_dir.name,
        run_dir=str(run_dir),
        replayed=True,
    )


@app.post('/run', response_model=RunResponse)
async def run_test_case(request: RunRequest) -> RunResponse:
    started_at = time.monotonic()
    run_dir = create_run_dir(request.test_case_id)
    log_handler = attach_run_log(run_dir)
    browser: Browser | None = None

    await _SESSION_SEMAPHORE.acquire()
    try:
        original_request = request
        request = apply_runner_settings(request)

        write_json(run_dir / 'raw' / 'api_request.json', redact_request(original_request))
        write_json(run_dir / 'raw' / 'request.json', redact_request(request))
        append_event(
            run_dir,
            'started',
            {
                'test_case_id': request.test_case_id,
                'max_steps': request.max_steps,
                'headless': request.headless,
                'navigation_wait_until': request.navigation_wait_until,
                'llm_model': request.llm.model,
                'request_overrides': env_bool('RUNNER_ALLOW_REQUEST_OVERRIDES', False),
            },
        )

        llm = create_llm(request)
        start_url = get_start_url(request)

        if request.preflight_url and start_url:
            ok, message, attempts = await preflight_url(
                start_url,
                request.preflight_timeout_sec,
                request.preflight_retries,
                request.preflight_verify_ssl,
            )
            write_json(run_dir / 'raw' / 'preflight.json', {'ok': ok, 'message': message, 'attempts': attempts})
            append_event(run_dir, 'preflight', {'ok': ok, 'message': message})
            if not ok:
                return fail_run(run_dir, request.test_case_id, started_at, 'PreflightError', message)

        browser = create_browser(request, start_url)
        task = f'{request.task}\n\nStart from URL: {start_url}' if start_url else request.task

        replay_response: RunResponse | None = None
        if request.cache_key and not request.force_regenerate and request.test_case_id:
            try:
                cached_path = load_cached(request.test_case_id, request.cache_key)
            except Exception as exc:
                logger.warning(f'Cache lookup failed for test_case_id={request.test_case_id}: {exc}')
                cached_path = None
            if cached_path is not None:
                replay_response = await _try_replay(request, run_dir, started_at, task, llm, browser, cached_path)
                if replay_response is None:
                    browser = create_browser(request, start_url)

        if replay_response is not None:
            return finish_run(run_dir, replay_response, history=None, request=request)

        agent = Agent(
            task=task,
            llm=llm,
            browser=browser,
            use_vision=request.use_vision,
            extend_system_message=request.system_instructions,
            llm_timeout=request.llm_timeout_sec,
            step_timeout=int(request.action_timeout_sec),
            sensitive_data=request.sensitive_data or None,
            calculate_cost=True,
        )

        append_event(run_dir, 'agent_started', {'start_url': start_url})
        history = await agent.run(max_steps=request.max_steps)
        append_event(run_dir, 'agent_finished', {'history_steps': len(history.history)})

        history.save_to_file(run_dir / 'raw' / 'history.json')
        if request.cache_key and request.test_case_id:
            try:
                save_cached(request.test_case_id, request.cache_key, run_dir / 'raw' / 'history.json')
            except Exception as exc:
                logger.warning(f'Cache save failed for test_case_id={request.test_case_id}: {exc}')
        usage, llm_usage = collect_usage(agent, history)
        write_json(
            run_dir / 'raw' / 'usage.json',
            {
                'session': usage.model_dump(mode='json'),
                'llm_calls': [item.model_dump(mode='json') for item in llm_usage],
            },
        )

        final_summary = _extract_summary(history.final_result()) or ''
        if history.is_done() and history.is_successful() is True:
            status = RunStatus.passed
        elif history.is_done() and history.is_successful() is False:
            if final_summary.lower().startswith('blocked'):
                status = RunStatus.blocked
            else:
                status = RunStatus.failed
        else:
            status = RunStatus.blocked

        errors = [error for error in history.errors() if error]
        response = RunResponse(
            test_case_id=request.test_case_id,
            status=status,
            summary=final_summary or ('Agent finished with errors.' if errors else 'Agent finished without final extracted content.'),
            steps_count=len(history.action_history()),
            errors=errors,
            artifacts=ArtifactReport(
                visited_urls=[url for url in history.urls() if url],
                screenshot_paths=[path for path in history.screenshot_paths(return_none_if_not_screenshot=False) if path],
            ),
            duration_sec=round(time.monotonic() - started_at, 2),
            run_id=run_dir.name,
            run_dir=str(run_dir),
            usage=usage,
            llm_usage=llm_usage,
        )
        return finish_run(run_dir, response, history, request)

    except HTTPException as exc:
        append_event(run_dir, 'rejected', {'status_code': exc.status_code, 'reason': exc.detail})
        return fail_run(
            run_dir,
            request.test_case_id,
            started_at,
            'HTTPException',
            str(exc.detail),
            exc.status_code,
        )
    except Exception as exc:
        logger.exception('Run failed')
        append_event(run_dir, 'error', {'type': type(exc).__name__, 'message': str(exc)})
        return fail_run(run_dir, request.test_case_id, started_at, type(exc).__name__, str(exc))
    finally:
        if browser is not None:
            try:
                await asyncio.wait_for(browser.stop(), timeout=5.0)
            except Exception as _e:
                logger.debug(f'browser.stop() error (non-fatal): {_e}')
        detach_run_log(log_handler)
        _SESSION_SEMAPHORE.release()


# ---------------------------------------------------------------------------
# Streaming run (WebSocket) — /start + /ws/{run_id}
# ---------------------------------------------------------------------------

@app.post('/start')
async def start_run_stream(request: RunRequest) -> dict[str, str]:
    """Start a run in the background and return a run_id for WebSocket streaming."""
    run_id = uuid.uuid4().hex
    queue: asyncio.Queue = asyncio.Queue()
    _live_runs[run_id] = queue
    task = asyncio.create_task(_stream_run(run_id, request, queue))
    _active_tasks[run_id] = task
    return {'run_id': run_id}


async def _hard_stop_after_grace(task: asyncio.Task, grace_sec: float = 5.0) -> None:
    """agent.stop() is cooperative — it can be ignored by a step stuck on a wedged
    page/action for up to step_timeout (default 180s). Give it a short grace
    period, then cancel the run task outright. _stream_run already handles
    CancelledError by writing a proper 'stopped' result, so this is a safe
    hard-kill, not a crash."""
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=grace_sec)
    except asyncio.TimeoutError:
        if not task.done():
            task.cancel()
    except Exception:
        pass


@app.post('/runs/{run_id}/stop')
async def stop_run(run_id: str) -> dict[str, str]:
    """Cancel an active streaming run."""
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', run_id):
        raise HTTPException(status_code=400, detail='Invalid run_id')
    agent = _active_agents.get(run_id)
    if agent is not None:
        agent.stop()  # graceful: sets state.stopped=True, breaks after current step
    task = _active_tasks.get(run_id)
    if task and not task.done():
        asyncio.create_task(_hard_stop_after_grace(task))
        return {'status': 'stopping'}
    if agent is not None:
        return {'status': 'stopping'}
    return {'status': 'not_running'}


@app.websocket('/ws/{run_id}')
async def ws_run_stream(websocket: WebSocket, run_id: str) -> None:
    """Stream run events (step/done/error) to the client."""
    await websocket.accept()
    queue = _live_runs.get(run_id)
    if not queue:
        await websocket.send_json({'type': 'error', 'message': 'Run not found or already completed'})
        await websocket.close()
        return
    try:
        while True:
            event = await queue.get()
            if event is None:
                await websocket.close()
                break
            await websocket.send_json(event)
    except (WebSocketDisconnect, Exception):
        pass


async def _run_screencast(agent: Any, queue: asyncio.Queue, frames_dir: Path) -> None:
    """Stream CDP screencast frames live and save every 3rd frame for post-run video assembly."""
    browser_session = agent.browser_session

    for _ in range(300):  # max 30 s
        try:
            if browser_session.cdp_client is not None and browser_session.agent_focus_target_id is not None:
                break
        except Exception:
            pass
        await asyncio.sleep(0.1)
    else:
        logger.warning('CDP screencast: browser never became ready within 30 s, skipping')
        return

    import base64 as _b64

    loop = asyncio.get_running_loop()
    current_session_id: str | None = None
    frame_counter = 0
    frames_dir.mkdir(parents=True, exist_ok=True)

    SCREENCAST_PARAMS: dict[str, Any] = {
        'format': 'jpeg', 'quality': 70,
        'maxWidth': 1280, 'maxHeight': 800, 'everyNthFrame': 1,
    }

    def on_frame(event: Any, session_id: str | None = None) -> None:
        nonlocal frame_counter
        if current_session_id is not None and session_id != current_session_id:
            return

        data = event['data']

        # Live stream to frontend
        if queue.qsize() < 30:
            queue.put_nowait({'type': 'frame', 'data': data})

        # Save every 3rd frame (~10 fps) for post-run video
        frame_counter += 1
        if frame_counter % 3 == 0:
            frame_num = frame_counter // 3
            frame_path = frames_dir / f'frame_{frame_num:06d}.jpg'
            try:
                frame_path.write_bytes(_b64.b64decode(data))
            except Exception:
                pass

        # Ack CDP frame
        try:
            loop.create_task(
                browser_session.cdp_client.send.Page.screencastFrameAck(
                    params={'sessionId': event['sessionId']},
                    session_id=session_id,
                )
            )
        except Exception:
            pass

    browser_session.cdp_client.register.Page.screencastFrame(on_frame)

    async def switch_to_session(cdp_session: Any) -> None:
        nonlocal current_session_id
        if cdp_session.session_id == current_session_id:
            return
        if current_session_id:
            try:
                await browser_session.cdp_client.send.Page.stopScreencast(session_id=current_session_id)
            except Exception:
                pass
        current_session_id = cdp_session.session_id
        await cdp_session.cdp_client.send.Page.startScreencast(
            params=SCREENCAST_PARAMS, session_id=current_session_id,
        )
        logger.info(f'CDP screencast started/switched (session {current_session_id[:8]}…)')

    async def on_focus_changed(event: Any) -> None:
        try:
            new_session = await browser_session.get_or_create_cdp_session()
            await switch_to_session(new_session)
        except Exception as e:
            logger.debug(f'CDP screencast tab-switch error: {e}')

    browser_session.event_bus.on(AgentFocusChangedEvent, on_focus_changed)

    try:
        initial_session = await browser_session.get_or_create_cdp_session()
        await switch_to_session(initial_session)
        await asyncio.sleep(3600)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.warning(f'CDP screencast error: {e}')
    finally:
        if current_session_id:
            try:
                await browser_session.cdp_client.send.Page.stopScreencast(session_id=current_session_id)
            except Exception:
                pass


async def _stream_run(run_id: str, original_request: RunRequest, queue: asyncio.Queue) -> None:
    """Background task: run agent and push step/done events to queue."""
    started_at = time.monotonic()
    run_dir = create_run_dir(original_request.test_case_id)
    frames_dir = run_dir / 'media' / 'frames'
    log_handler = attach_run_log(run_dir)
    ws_log_handler = WsLogHandler(queue, started_at, asyncio.get_running_loop())
    logging.getLogger().addHandler(ws_log_handler)
    logging.getLogger('browser_use').addHandler(ws_log_handler)
    browser: Any = None
    screencast_task: asyncio.Task[None] | None = None
    _orig_tz: str | None = os.environ.get('TZ')

    await _SESSION_SEMAPHORE.acquire()

    async def push(event: dict) -> None:
        await queue.put(event)

    try:
        request = apply_runner_settings(original_request)
        L = _RUNNER_LOG_STRINGS.get(request.language, _RUNNER_LOG_STRINGS['ru'])
        write_json(run_dir / 'raw' / 'api_request.json', redact_request(original_request))
        write_json(run_dir / 'raw' / 'request.json', redact_request(request))
        append_event(run_dir, 'started', {
            'test_case_id': request.test_case_id,
            'max_steps': request.max_steps,
            'headless': request.headless,
            'llm_model': request.llm.model,
            'streaming': True,
        })

        profile_cfg = request.browser_profile
        info_parts = [
            f'{L["model"]}: {request.llm.model}',
            f'{L["browser"]}: Chromium',
            f'{L["device"]}: {"Mobile" if profile_cfg.is_mobile else "Desktop"}',
            f'{L["max_steps"]}: {request.max_steps}',
        ]
        if profile_cfg.locale:
            info_parts.append(f'{L["locale"]}: {profile_cfg.locale}')
        if profile_cfg.timezone_id:
            info_parts.append(f'TZ: {profile_cfg.timezone_id}')
        await push({
            'type': 'log', 'level': 'info', 'category': 'runner', 'source': 'session',
            'message': ' · '.join(info_parts),
            'elapsed_sec': 0.0,
        })

        llm = create_llm(request)
        start_url = get_start_url(request)

        if request.preflight_url and start_url:
            ok, message, attempts = await preflight_url(
                start_url, request.preflight_timeout_sec,
                request.preflight_retries, request.preflight_verify_ssl,
            )
            write_json(run_dir / 'raw' / 'preflight.json', {'ok': ok, 'message': message, 'attempts': attempts})
            append_event(run_dir, 'preflight', {'ok': ok, 'message': message})
            await push({
                'type': 'log', 'level': 'info' if ok else 'error', 'category': 'preflight', 'source': 'session',
                'message': f'Preflight {"✅" if ok else "❌"} {message}',
                'elapsed_sec': round(time.monotonic() - started_at, 1),
            })
            if not ok:
                resp = fail_run(run_dir, request.test_case_id, started_at, 'PreflightError', message)
                await push({'type': 'done', 'status': resp.status.value, 'summary': resp.summary,
                            'duration_sec': resp.duration_sec, 'steps_count': 0,
                            'errors': resp.errors, 'run_id': resp.run_id})
                return

        # Apply TZ env var before subprocess launch (browser-use spawns Chromium as subprocess
        # which inherits parent process env — BrowserProfile.env field is never passed through)
        if request.browser_profile.timezone_id:
            os.environ['TZ'] = request.browser_profile.timezone_id

        browser = create_browser(request, start_url)
        task_text = f'{request.task}\n\nStart from URL: {start_url}' if start_url else request.task

        replay_response: RunResponse | None = None
        if request.cache_key and not request.force_regenerate and request.test_case_id:
            try:
                cached_path = load_cached(request.test_case_id, request.cache_key)
            except Exception as exc:
                logger.warning(f'Cache lookup failed for test_case_id={request.test_case_id}: {exc}')
                cached_path = None
            if cached_path is not None:
                await push({
                    'type': 'log', 'level': 'info', 'category': 'runner', 'source': 'session',
                    'message': 'Replaying from cached run…',
                    'elapsed_sec': round(time.monotonic() - started_at, 1),
                })
                replay_response = await _try_replay(request, run_dir, started_at, task_text, llm, browser, cached_path)
                if replay_response is None:
                    browser = create_browser(request, start_url)

        if replay_response is not None:
            finish_run(run_dir, replay_response, history=None, request=request)
            await push({
                'type': 'done',
                'status': replay_response.status.value,
                'summary': replay_response.summary,
                'duration_sec': replay_response.duration_sec,
                'steps_count': replay_response.steps_count,
                'instability_step_count': 0,
                'retry_step_count': 0,
                'errors': replay_response.errors,
                'run_id': replay_response.run_id,
                'replayed': True,
            })
            return

        async def on_step(state: Any, output: Any, step_num: int) -> None:
            # Extract planned actions from AgentOutput
            raw_actions = getattr(output, 'action', None) or []
            actions: list[dict[str, Any]] = []
            for action in raw_actions:
                raw = action.model_dump(exclude_unset=True)
                if action_name(raw) in SERVICE_ACTIONS:
                    continue
                actions.append(compact_action(raw))

            # evaluation_previous_goal = LLM's verdict on what step N-1 accomplished.
            # Push it as an update to the previous step so the UI shows actual outcomes,
            # not planned actions, for completed steps.
            eval_prev = (getattr(output, 'evaluation_previous_goal', '') or '').strip()
            _eval_lower = eval_prev.lower()
            if step_num > 1 and eval_prev and _eval_lower not in ('start', 'starting', 'initial'):
                _FAIL_KW = ('failed to', 'не удалось', 'не смог', 'could not', 'unable to', 'failure', 'unsuccessful')
                eval_failed = any(kw in _eval_lower for kw in _FAIL_KW)
                await push({
                    'type': 'step_update',
                    'step': step_num - 1,
                    'summary': short_text(eval_prev),
                    'status': 'error' if eval_failed else 'ok',
                    'elapsed_sec': round(time.monotonic() - started_at, 1),
                })

            # Current step summary: what this step will do (actions or next_goal)
            next_goal_val = (getattr(output, 'next_goal', '') or '').strip()
            live_done_text = ''
            for _raw_action in (getattr(output, 'action', None) or []):
                _raw = _raw_action.model_dump(exclude_unset=True)
                if action_name(_raw) == 'done':
                    _done_data = _raw.get('done') or {}
                    if isinstance(_done_data, dict):
                        live_done_text = short_text(str(_done_data.get('text') or '').strip(), 400)
                    break
            if live_done_text:
                summary = live_done_text
            elif actions:
                summary = summarize_actions(actions)
            else:
                summary = next_goal_val or f'{L["step"]} {step_num}'

            screenshot_b64 = getattr(state, 'screenshot', None) or None

            event: dict[str, Any] = {
                'type': 'step',
                'step': step_num,
                'url': getattr(state, 'url', '') or '',
                'title': getattr(state, 'title', '') or '',
                'next_goal': next_goal_val,
                'summary': summary,
                'actions': actions,
                'screenshot_b64': screenshot_b64,
                'elapsed_sec': round(time.monotonic() - started_at, 1),
            }
            await push(event)
            # Pending placeholder — tells UI next step is being planned by LLM
            await push({
                'type': 'step_pending',
                'step': step_num + 1,
                'elapsed_sec': round(time.monotonic() - started_at, 1),
            })
            # Token stats for this step
            try:
                entries = list(getattr(getattr(agent, 'token_cost_service', None), 'usage_history', []) or [])
                if entries:
                    last = entries[-1]
                    p = int(getattr(last.usage, 'prompt_tokens', 0) or 0)
                    c = int(getattr(last.usage, 'completion_tokens', 0) or 0)
                    await push({
                        'type': 'log', 'level': 'info', 'category': 'tokens', 'source': 'session',
                        'message': f'{L["step"]} {step_num} — prompt: {p:,} · completion: {c:,} · {L["total"]}: {p+c:,}',
                        'elapsed_sec': round(time.monotonic() - started_at, 1),
                    })
            except Exception:
                pass

        agent = Agent(
            task=task_text,
            llm=llm,
            browser=browser,
            use_vision=request.use_vision,
            extend_system_message=request.system_instructions,
            llm_timeout=request.llm_timeout_sec,
            step_timeout=int(request.action_timeout_sec),
            register_new_step_callback=on_step,
            sensitive_data=request.sensitive_data or None,
            calculate_cost=True,
        )
        _active_agents[run_id] = agent
        screencast_task = asyncio.create_task(_run_screencast(agent, queue, frames_dir))

        append_event(run_dir, 'agent_started', {'start_url': start_url})
        history = await agent.run(max_steps=request.max_steps)
        append_event(run_dir, 'agent_finished', {'history_steps': len(history.history)})

        history.save_to_file(run_dir / 'raw' / 'history.json')
        if request.cache_key and request.test_case_id:
            try:
                save_cached(request.test_case_id, request.cache_key, run_dir / 'raw' / 'history.json')
            except Exception as exc:
                logger.warning(f'Cache save failed for test_case_id={request.test_case_id}: {exc}')
        usage, llm_usage = collect_usage(agent, history)
        write_json(run_dir / 'raw' / 'usage.json', {
            'session': usage.model_dump(mode='json'),
            'llm_calls': [item.model_dump(mode='json') for item in llm_usage],
        })

        agent_stopped = getattr(getattr(agent, 'state', None), 'stopped', False)
        final_summary = _extract_summary(history.final_result()) or ''
        if history.is_done() and history.is_successful() is True:
            status = RunStatus.passed
        elif history.is_done() and history.is_successful() is False:
            if final_summary.lower().startswith('blocked'):
                status = RunStatus.blocked
            else:
                status = RunStatus.failed
        elif agent_stopped:
            status = RunStatus.stopped
        else:
            status = RunStatus.blocked

        errors = [e for e in history.errors() if e]
        response = RunResponse(
            test_case_id=request.test_case_id,
            status=status,
            summary=final_summary or ('Agent finished with errors.' if errors else 'Agent finished.'),
            steps_count=len(history.action_history()),
            errors=errors,
            artifacts=ArtifactReport(
                visited_urls=[u for u in history.urls() if u],
                screenshot_paths=[p for p in history.screenshot_paths(return_none_if_not_screenshot=False) if p],
            ),
            duration_sec=round(time.monotonic() - started_at, 2),
            run_id=run_dir.name,
            run_dir=str(run_dir),
            usage=usage,
            llm_usage=llm_usage,
        )
        response = finish_run(run_dir, response, history, request)

        cached = usage.prompt_cached_tokens or 0
        cache_str = f' · {L["cache"]}: {cached:,}' if cached else ''
        await push({
            'type': 'log', 'level': 'info', 'category': 'summary', 'source': 'session',
            'message': (
                f'{L["summary_total"]}: {response.steps_count} {L["steps_word"]} · '
                f'prompt: {usage.prompt_tokens:,}{cache_str} · '
                f'completion: {usage.completion_tokens:,} · '
                f'{L["all_tokens"]}: {usage.total_tokens:,} {L["tokens_word"]} · '
                f'{round(time.monotonic() - started_at, 1)}{L["sec_suffix"]}'
            ),
            'elapsed_sec': round(time.monotonic() - started_at, 1),
        })

        await push({
            'type': 'done',
            'status': response.status.value,
            'summary': response.summary,
            'duration_sec': response.duration_sec,
            'steps_count': response.steps_count,
            'instability_step_count': response.instability_step_count,
            'retry_step_count': response.retry_step_count,
            'errors': response.errors,
            'run_id': response.run_id,
        })

    except asyncio.CancelledError:
        duration = round(time.monotonic() - started_at, 2)
        append_event(run_dir, 'stopped', {'duration_sec': duration})
        empty_usage = SessionUsageReport(llm_call_count=0)
        write_json(run_dir / 'raw' / 'history.json', {'history': []})
        write_json(run_dir / 'raw' / 'usage.json', {'session': empty_usage.model_dump(mode='json'), 'llm_calls': []})
        resp = RunResponse(
            test_case_id=original_request.test_case_id,
            status=RunStatus.stopped,
            summary='Run was stopped by user.',
            steps_count=0,
            errors=[],
            artifacts=ArtifactReport(),
            duration_sec=duration,
            run_id=run_dir.name,
            run_dir=str(run_dir),
            usage=empty_usage,
        )
        finish_run(run_dir, resp)
        await push({'type': 'done', 'status': resp.status.value, 'summary': resp.summary,
                    'duration_sec': resp.duration_sec, 'steps_count': 0,
                    'errors': [], 'run_id': resp.run_id})
    except HTTPException as exc:
        append_event(run_dir, 'rejected', {'status_code': exc.status_code, 'reason': exc.detail})
        resp = fail_run(run_dir, original_request.test_case_id, started_at, 'HTTPException', str(exc.detail), exc.status_code)
        await push({'type': 'done', 'status': resp.status.value, 'summary': resp.summary,
                    'duration_sec': resp.duration_sec, 'steps_count': 0,
                    'errors': resp.errors, 'run_id': resp.run_id})
    except Exception as exc:
        logger.exception('Stream run failed')
        append_event(run_dir, 'error', {'type': type(exc).__name__, 'message': str(exc)})
        resp = fail_run(run_dir, original_request.test_case_id, started_at, type(exc).__name__, str(exc))
        await push({'type': 'done', 'status': resp.status.value, 'summary': resp.summary,
                    'duration_sec': resp.duration_sec, 'steps_count': 0,
                    'errors': resp.errors, 'run_id': resp.run_id})
    finally:
        # Restore TZ env var to avoid leaking across runs
        if original_request.browser_profile.timezone_id:
            if _orig_tz is None:
                os.environ.pop('TZ', None)
            else:
                os.environ['TZ'] = _orig_tz
        if screencast_task is not None:
            screencast_task.cancel()
            try:
                await screencast_task
            except Exception:
                pass
        if browser is not None:
            try:
                await asyncio.wait_for(browser.stop(), timeout=5.0)
            except (asyncio.TimeoutError, Exception) as _e:
                logger.debug(f'browser.stop() error (non-fatal): {_e}')
        # Assemble video from collected screencast frames
        try:
            frame_files = sorted(frames_dir.glob('frame_*.jpg')) if frames_dir.exists() else []
            if frame_files:
                logger.info(f'Assembling video from {len(frame_files)} frames…')
                output_path = run_dir / 'media' / 'recording.mp4'

                def _assemble_video() -> None:
                    import imageio.v2 as iio
                    import numpy as np
                    from PIL import Image
                    with iio.get_writer(
                        str(output_path), fps=10, codec='libx264',
                        pixelformat='yuv420p', quality=8, macro_block_size=None,
                    ) as writer:
                        for f in frame_files:
                            try:
                                with Image.open(f) as img:
                                    writer.append_data(np.array(img.convert('RGB')))
                            except Exception:
                                pass
                    shutil.rmtree(str(frames_dir), ignore_errors=True)

                await asyncio.get_event_loop().run_in_executor(None, _assemble_video)
                logger.info(f'Video assembled → {output_path} ({output_path.stat().st_size} bytes)')
            else:
                logger.warning('No screencast frames collected — video will not be available')
        except Exception as _ve:
            logger.warning(f'Video assembly error: {_ve}')
        logging.getLogger().removeHandler(ws_log_handler)
        logging.getLogger('browser_use').removeHandler(ws_log_handler)
        ws_log_handler.close()
        detach_run_log(log_handler)
        _live_runs.pop(run_id, None)
        _active_tasks.pop(run_id, None)
        _active_agents.pop(run_id, None)
        await queue.put(None)  # sentinel → WS close
        _SESSION_SEMAPHORE.release()


# ---------------------------------------------------------------------------
# Steps endpoint for completed runs
# ---------------------------------------------------------------------------

@app.get('/runs/{run_id}/video')
def get_run_video(run_id: str) -> FileResponse:
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', run_id):
        raise HTTPException(status_code=400, detail='Invalid run_id')
    for ext, mime in [('mp4', 'video/mp4'), ('webm', 'video/webm')]:
        video_path = RUNS_DIR / run_id / 'media' / f'recording.{ext}'
        if video_path.exists():
            return FileResponse(str(video_path), media_type=mime, filename=f'{run_id}.{ext}')
    raise HTTPException(status_code=404, detail='No video recording for this run')


@app.get('/runs/{run_id}/steps')
def get_run_steps(run_id: str) -> dict[str, Any]:
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', run_id):
        raise HTTPException(status_code=400, detail='Invalid run_id')

    run_dir = RUNS_DIR / run_id
    steps_path = run_dir / 'ui' / 'steps.json'
    if not steps_path.exists():
        raise HTTPException(status_code=404, detail='Steps not found for this run')

    steps: list[dict] = json.loads(steps_path.read_text(encoding='utf-8'))

    # Backward-compat: old sessions stored summary='done' for the done step (done.text was stripped).
    # Re-read the real verification text from history.json if available.
    history_path = run_dir / 'raw' / 'history.json'
    if history_path.exists():
        try:
            history_items = json.loads(history_path.read_text(encoding='utf-8')).get('history', [])
            for step in steps:
                if step.get('summary') == 'done':
                    idx = step.get('step', 0) - 1
                    if 0 <= idx < len(history_items):
                        mo = (history_items[idx].get('model_output') or {})
                        for raw_action in (mo.get('action') or []):
                            if 'done' in raw_action:
                                text = str((raw_action['done'] or {}).get('text') or '').strip()
                                if text:
                                    step['summary'] = text[:400]
                                break
        except Exception:
            pass

    for step in steps:
        screenshot = step.get('screenshot')
        if screenshot and screenshot.get('path'):
            abs_path = str(run_dir / screenshot['path'])
            screenshot['url'] = f'/api/runner/screenshot?path={abs_path}'

    return {'steps': steps}


_LOG_LINE_RE = re.compile(r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d+) (\w+) \[([^\]]+)\] (.+)$')
_LOG_SKIP_NAMES = frozenset({'cost', 'bubus'})
_LOG_SKIP_PREFIXES = ('bubus.', 'cdp_use', 'websockets', 'httpx', 'httpcore')
_LOG_INTERNAL_PREFIXES = ('browser_use.browser', 'browser_use.dom')


@app.get('/runs/{run_id}/logs')
def get_run_logs(run_id: str) -> dict[str, Any]:
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', run_id):
        raise HTTPException(status_code=400, detail='Invalid run_id')

    run_dir = RUNS_DIR / run_id
    runner_log_path = run_dir / 'logs' / 'runner.log'
    events_path = run_dir / 'logs' / 'events.jsonl'

    if not runner_log_path.exists() and not events_path.exists():
        raise HTTPException(status_code=404, detail='Logs not found for this run')

    logs: list[dict[str, Any]] = []
    base_ts: float | None = None

    # Parse runner.log (has browser_use + runner logs)
    if runner_log_path.exists():
        for raw_line in runner_log_path.read_text(encoding='utf-8', errors='replace').splitlines():
            m = _LOG_LINE_RE.match(raw_line.strip())
            if not m:
                continue
            ts_str, level_str, name, message = m.group(1), m.group(2), m.group(3), m.group(4)

            # Filter noise
            if name in _LOG_SKIP_NAMES or any(name.startswith(p) for p in _LOG_SKIP_PREFIXES):
                continue
            if any(name.startswith(p) for p in _LOG_INTERNAL_PREFIXES) and level_str not in ('ERROR', 'CRITICAL', 'WARNING'):
                continue
            if level_str == 'DEBUG':
                continue

            try:
                ts = datetime.strptime(ts_str, '%Y-%m-%d %H:%M:%S,%f').timestamp()
            except ValueError:
                ts = 0.0
            if base_ts is None:
                base_ts = ts
            elapsed = round(ts - (base_ts or ts), 1)

            ws_level = 'error' if level_str in ('ERROR', 'CRITICAL') else 'info'
            source = 'agent' if name.startswith('browser_use') else 'session'

            if name.startswith('browser_use.agent') or ('Agent' in name and name.startswith('browser_use')):
                cat = 'agent'
            elif name.startswith('browser_use.tools') or ('tools' in name and name.startswith('browser_use')):
                cat = 'tools'
            elif name.startswith('browser_use'):
                cat = name.split('.')[-1]
            else:
                cat = name.split('.')[-1] if '.' in name else name

            logs.append({
                'type': 'log',
                'level': ws_level,
                'category': cat,
                'message': _ANSI_RE.sub('', message),
                'elapsed_sec': elapsed,
                'source': source,
            })

    # Append lifecycle events from events.jsonl as session logs
    if events_path.exists():
        for line in events_path.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            ts_str = ev.get('timestamp', '')
            try:
                ts = datetime.fromisoformat(ts_str).timestamp()
            except (ValueError, TypeError):
                ts = 0.0
            if base_ts is None:
                base_ts = ts
            elapsed = round(ts - (base_ts or ts), 1)
            event_type = ev.get('event', 'unknown')
            extras = {k: v for k, v in ev.items() if k not in {'timestamp', 'event'}}
            parts = [event_type] + [f'{k}={v}' for k, v in extras.items()]
            logs.append({
                'type': 'log',
                'level': 'error' if event_type == 'error' else 'info',
                'category': 'lifecycle',
                'message': ' · '.join(str(p) for p in parts),
                'elapsed_sec': elapsed,
                'source': 'session',
            })

    # Sort by elapsed
    logs.sort(key=lambda x: x['elapsed_sec'])
    return {'logs': logs}
