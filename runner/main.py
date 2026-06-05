from __future__ import annotations

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

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException

from browser_use import Agent, Browser
from browser_use.browser.events import NavigateToUrlEvent as BrowserNavigateToUrlEvent
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

RUNNER_DIR = Path(__file__).resolve().parent
RUNS_DIR = RUNNER_DIR / 'runs'
RUN_SCHEMA_VERSION = '2026-05-18.1'
RUN_FOLDERS = ('raw', 'logs', 'ui', 'metrics', 'media/screenshots')

load_dotenv(RUNNER_DIR / '.env')

@asynccontextmanager
async def _lifespan(_app: FastAPI):
    _configure_browser_globals()
    yield


app = FastAPI(title='Browser-Use Runner', version='0.1.0', lifespan=_lifespan)
logger = logging.getLogger('browser_use_runner')
URL_RE = re.compile(r'https?://[^\s)\]}>"\']+')


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


def runner_env_request(request: RunRequest) -> RunRequest:
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
            'llm': request.llm.model_copy(
                update={
                    'model': os.getenv('RUNNER_LLM_MODEL', 'deepseek-chat'),
                }
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
            'model': os.getenv('RUNNER_LLM_MODEL', 'deepseek-chat'),
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
    return handler


def detach_run_log(handler: logging.Handler) -> None:
    logging.getLogger().removeHandler(handler)
    handler.close()


def redact_request(request: RunRequest) -> dict[str, Any]:
    return request.model_dump(mode='json')


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


def create_llm(request: RunRequest) -> Any:
    try:
        return _create_llm_for_provider(request.llm.model, request.llm_timeout_sec)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


def create_browser(request: RunRequest) -> Browser:
    return Browser(headless=request.headless)


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
        'done': ('success',),
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

    for step_number, item in enumerate(history.model_dump().get('history', []), start=1):
        metadata = item.get('metadata') or {}
        raw_actions = (item.get('model_output') or {}).get('action', [])
        raw_results = item.get('result', [])
        actions = []
        results = []
        service_actions = []

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

        summary = errors[0] if errors else ''
        if not summary and actions:
            summary = summarize_actions(actions)
        if not summary and contents:
            summary = contents[0]

        steps.append(
            {
                'step': step_number,
                'status': 'error' if errors else 'ok',
                'summary': short_text(summary),
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


def last_browser_state_text(history: Any | None) -> str:
    if history is None:
        return ''

    for item in reversed(history.model_dump().get('history', [])):
        state_message = item.get('state_message') or ''
        start = state_message.rfind('<browser_state>')
        end = state_message.rfind('</browser_state>')
        if start != -1 and end != -1 and end > start:
            return state_message[start + len('<browser_state>') : end].strip()

    return ''


def step_action_names(steps: list[dict[str, Any]]) -> list[str]:
    return [action.get('name', 'unknown') for step in steps for action in step.get('actions', [])]


def input_texts(steps: list[dict[str, Any]]) -> list[str]:
    texts = []
    for step in steps:
        for action in step.get('actions', []):
            if action.get('name') == 'input':
                text = (action.get('input') or {}).get('text')
                if text:
                    texts.append(str(text))
    return texts


def result_texts(steps: list[dict[str, Any]]) -> list[str]:
    texts = []
    for step in steps:
        for result in step.get('results', []):
            for key in ('content', 'error'):
                value = result.get(key)
                if value:
                    texts.append(str(value))
    return texts


def task_has_any(task: str, words: tuple[str, ...]) -> bool:
    task_lower = task.lower()
    return any(word in task_lower for word in words)


def build_evidence_verdict(
    request: RunRequest | None,
    response: RunResponse,
    steps: list[dict[str, Any]],
    history: Any | None,
) -> dict[str, Any]:
    action_names = step_action_names(steps)
    texts = input_texts(steps)
    result_text = ' '.join(result_texts(steps)).lower()
    final_state = last_browser_state_text(history)
    final_state_lower = final_state.lower()
    task = request.task if request else ''
    reasons: list[str] = []
    warnings: list[str] = []
    technical_warnings: list[str] = []
    flags: list[str] = []
    sms_state_markers = ('sms', 'смс', 'код', 'подтвержден', 'подтверждение', 'otp')
    has_sms_state = any(marker in final_state_lower for marker in sms_state_markers)

    if response.status == RunStatus.passed and response.errors:
        flags.append('agent_passed_after_errors')
        flags.append('recovered_agent_error')
        technical_warnings.append('Agent returned passed after browser-use reported errors during the run.')

    if response.status == RunStatus.passed and any(step.get('status') == 'error' for step in steps):
        flags.append('agent_passed_with_failed_steps')
        flags.append('recovered_agent_error')
        technical_warnings.append('At least one browser step has status=error, but the agent continued afterward.')

    if task_has_any(task, ('телефон', 'phone')):
        has_phone_input = any(re.search(r'\+?\d[\d\s().-]{7,}', text) for text in texts)
        has_phone_in_state = bool(re.search(r'name=phone[^>]*value=[^>/]*\d', final_state, re.IGNORECASE))
        if not has_phone_input and not has_phone_in_state:
            flags.append('missing_phone_evidence')
            reasons.append('Test case mentions phone, but no phone input evidence was found.')

    if task_has_any(task, ('email', 'e-mail', 'электронная почта', 'почта')):
        has_email_input = any('@' in text for text in texts)
        has_email_in_state = bool(re.search(r'name=email[^>]*value=[^>/]*@', final_state, re.IGNORECASE))
        if not has_email_input and not has_email_in_state:
            flags.append('missing_email_evidence')
            reasons.append('Test case mentions email, but no email input evidence was found.')

    if task_has_any(task, ('чекбокс', 'checkbox', 'соглашаюсь', 'согласен', 'согласие')):
        has_checkbox_evidence = 'checkbox' in result_text or 'checked=true' in final_state_lower or has_sms_state
        if not has_checkbox_evidence:
            flags.append('missing_checkbox_evidence')
            reasons.append('Test case mentions checkbox/agreement, but checked checkbox evidence was not found.')

    expects_submit = task_has_any(task, ('продолжить', 'submit', 'next'))
    expects_sms = task_has_any(task, ('sms', 'смс', 'код из sms', 'код из смс', 'форма ввода кода'))
    has_submit_evidence = 'clicked button' in result_text or has_sms_state
    if expects_submit and not has_submit_evidence:
        flags.append('missing_submit_click')
        reasons.append('Test case expects continuation/submit, but no submit click action was recorded.')

    if expects_sms:
        if not has_sms_state:
            flags.append('missing_sms_screen_evidence')
            reasons.append('Expected SMS/code screen was not found in the final browser state.')

    if response.status == RunStatus.passed and response.summary:
        summary_lower = response.summary.lower()
        if 'passed' in summary_lower and reasons:
            flags.append('agent_report_conflicts_with_evidence')

    evidence_status = 'passed' if not reasons else 'failed'
    runner_status = response.status.value
    if response.status == RunStatus.passed and evidence_status == 'failed':
        runner_status = RunStatus.failed.value

    if not final_state:
        warnings.append('Final browser_state was not available; evidence checks are weaker.')

    return {
        'agent_status': response.status.value,
        'evidence_status': evidence_status,
        'runner_status': runner_status,
        'quality_flags': list(dict.fromkeys(flags)),
        'reasons': list(dict.fromkeys(reasons)),
        'warnings': list(dict.fromkeys(warnings)),
        'technical_warnings': list(dict.fromkeys(technical_warnings)),
        'final_browser_state_excerpt': short_text(final_state, 1200),
    }


def apply_evidence_verdict(response: RunResponse, verdict: dict[str, Any]) -> RunResponse:
    runner_status = verdict.get('runner_status')
    if runner_status == response.status.value:
        return response

    reasons = [str(reason) for reason in verdict.get('reasons', [])]
    prefix = 'Runner evidence check changed status from passed to failed.'
    summary = response.summary
    if reasons:
        summary = prefix + '\n\nEvidence issues:\n' + '\n'.join(f'- {reason}' for reason in reasons) + '\n\nAgent summary:\n' + summary

    return response.model_copy(
        update={
            'status': RunStatus(runner_status),
            'summary': summary,
            'errors': [*response.errors, *reasons],
        }
    )


def build_analysis(
    response: RunResponse,
    steps: list[dict[str, Any]],
    screenshots: list[dict[str, Any]],
    verdict: dict[str, Any] | None = None,
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
        'usage': usage_summary(response.usage),
        'verdict': verdict or {},
        'quality_flags': (verdict or {}).get('quality_flags', []),
        'evidence_reasons': (verdict or {}).get('reasons', []),
        'technical_warnings': (verdict or {}).get('technical_warnings', []),
    }


def build_manifest(response: RunResponse, screenshots: list[dict[str, Any]], analysis: dict[str, Any]) -> dict[str, Any]:
    return {
        'schema_version': RUN_SCHEMA_VERSION,
        'run_id': response.run_id,
        'test_case_id': response.test_case_id,
        'status': response.status.value,
        'created_at': datetime.now().isoformat(timespec='seconds'),
        'duration_sec': response.duration_sec,
        'steps_count': response.steps_count,
        'errors_count': len(response.errors),
        'final_url': analysis.get('final_url'),
        'usage': usage_summary(response.usage),
        'ui': {
            'report': 'report.md',
            'analysis': 'ui/analysis.json',
            'verdict': 'ui/verdict.json',
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
    verdict = analysis.get('verdict') or {}
    lines = [
        f'# Browser-Use Run {response.run_id or ""}'.strip(),
        '',
        f'- Test case: `{response.test_case_id or "unknown"}`',
        f'- Status: `{response.status.value}`',
        f'- Agent status: `{verdict.get("agent_status", response.status.value)}`',
        f'- Evidence status: `{verdict.get("evidence_status", "unknown")}`',
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

    if verdict.get('quality_flags') or verdict.get('reasons'):
        lines += ['', '## Evidence Verdict', '']
        lines += [
            f'- Agent status: `{verdict.get("agent_status", "unknown")}`',
            f'- Evidence status: `{verdict.get("evidence_status", "unknown")}`',
            f'- Runner status: `{verdict.get("runner_status", response.status.value)}`',
        ]
        if verdict.get('quality_flags'):
            lines += ['', 'Quality flags:']
            lines += [f'- `{flag}`' for flag in verdict['quality_flags']]
        if verdict.get('reasons'):
            lines += ['', 'Reasons:']
            lines += [f'- {reason}' for reason in verdict['reasons']]
        if verdict.get('technical_warnings'):
            lines += ['', 'Technical warnings:']
            lines += [f'- {warning}' for warning in verdict['technical_warnings']]

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
        '- `ui/verdict.json` - agent status vs evidence status',
        '- `ui/steps.json` - compact browser-step list',
        '- `raw/agent_result.json` - original browser-use agent result before runner evidence checks',
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
    verdict = build_evidence_verdict(request, response, steps, history)
    final_response = apply_evidence_verdict(response, verdict)
    verdict['runner_status'] = final_response.status.value
    analysis = build_analysis(final_response, steps, screenshots, verdict)

    write_json(run_dir / 'raw' / 'agent_result.json', response.model_dump(mode='json'))
    write_json(run_dir / 'raw' / 'result.json', final_response.model_dump(mode='json'))
    write_json(run_dir / 'metrics' / 'usage_summary.json', usage_summary(final_response.usage))
    write_json(run_dir / 'ui' / 'analysis.json', analysis)
    write_json(run_dir / 'ui' / 'verdict.json', analysis.get('verdict', {}))
    write_json(run_dir / 'ui' / 'steps.json', steps)
    write_jsonl(run_dir / 'ui' / 'timeline.jsonl', steps)
    write_json(run_dir / 'manifest.json', build_manifest(final_response, screenshots, analysis))
    write_report(run_dir, final_response, analysis)
    mark_latest_run(run_dir)
    return final_response


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

@app.post('/run', response_model=RunResponse)
async def run_test_case(request: RunRequest) -> RunResponse:
    started_at = time.monotonic()
    run_dir = create_run_dir(request.test_case_id)
    log_handler = attach_run_log(run_dir)
    browser: Browser | None = None

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

        browser = create_browser(request)
        task = f'{request.task}\n\nStart from URL: {start_url}' if start_url else request.task

        agent = Agent(
            task=task,
            llm=llm,
            browser=browser,
            use_vision=request.use_vision,
            extend_system_message=request.system_instructions,
            llm_timeout=request.llm_timeout_sec,
            step_timeout=int(request.action_timeout_sec),
        )

        append_event(run_dir, 'agent_started', {'start_url': start_url})
        history = await agent.run(max_steps=request.max_steps)
        append_event(run_dir, 'agent_finished', {'history_steps': len(history.history)})

        history.save_to_file(run_dir / 'raw' / 'history.json')
        usage, llm_usage = collect_usage(agent, history)
        write_json(
            run_dir / 'raw' / 'usage.json',
            {
                'session': usage.model_dump(mode='json'),
                'llm_calls': [item.model_dump(mode='json') for item in llm_usage],
            },
        )

        if history.is_done() and history.is_successful() is True:
            status = RunStatus.passed
        elif history.is_done() and history.is_successful() is False:
            status = RunStatus.failed
        else:
            status = RunStatus.blocked

        errors = [error for error in history.errors() if error]
        response = RunResponse(
            test_case_id=request.test_case_id,
            status=status,
            summary=history.final_result() or ('Agent finished with errors.' if errors else 'Agent finished without final extracted content.'),
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
            await browser.stop()
        detach_run_log(log_handler)
