from __future__ import annotations

import json
import logging
import re
import threading
import time

import instructor
from openai import OpenAI

from app.core.config import settings
from app.core.prompt_builder import build_improve_prompt, build_review_prompt
from app.schemas.analysis import (
    AnalysisIssue,
    ImproveResult,
    ReviewResult,
    TextParseResult,
    _LLMReviewResult,
    _SummaryRewrite,
)

logger = logging.getLogger(__name__)


def _root_cause(exc: Exception) -> str:
    """Walk the exception chain, return compact single-line root cause."""
    seen: set[int] = set()
    cause: BaseException = exc
    while True:
        if id(cause) in seen:
            break
        seen.add(id(cause))
        nxt = cause.__cause__ or cause.__context__
        if nxt is None:
            break
        cause = nxt
    msg = str(cause)[:200].replace("\n", " ").strip()
    return f"{type(cause).__name__}: {msg}"


_FALLBACK_REVIEW = ReviewResult(
    summary="LLM is unavailable. The test case was parsed, but analysis could not run.",
    issues=[
        AnalysisIssue(
            severity="medium",
            title="AI analysis failed",
            description="The LLM endpoint is unavailable or returned invalid data.",
            recommendation="Check the LLM_BASE_URL and LLM_MODEL settings in .env.",
        )
    ],
    warnings=["LLM is unavailable, fallback response returned"],
)


def _make_client(mode: instructor.Mode) -> instructor.Instructor:
    openai_client = OpenAI(
        base_url=settings.LLM_BASE_URL,
        api_key=settings.LLM_API_KEY or "no-key",
        timeout=float(settings.LLM_TIMEOUT_SECONDS),
    )
    return instructor.from_openai(openai_client, mode=mode)


def _resolve_temperature(override: float | None, default: float) -> float:
    return override if override is not None else default


def _is_ollama_endpoint(base_url: str) -> bool:
    return "ollama" in base_url.lower() or ":11434" in base_url


def _extra_body() -> dict:
    """Ollama-specific request options. num_ctx overrides Ollama's default
    4096-token context window, which silently truncates prompts on complex
    rule sets. OpenAI (and OpenAI-compatible cloud APIs) reject an unrecognized
    "options" field with a hard 400 instead of ignoring it, so this must only
    be sent when LLM_BASE_URL actually points at an Ollama server."""
    if settings.LLM_NUM_CTX is None:
        return {}
    if not _is_ollama_endpoint(settings.LLM_BASE_URL):
        return {}
    return {"options": {"num_ctx": settings.LLM_NUM_CTX}}


_clients: dict[instructor.Mode, instructor.Instructor] = {}
_client_lock = threading.Lock()


def _get_client(mode: instructor.Mode) -> instructor.Instructor:
    if mode not in _clients:
        with _client_lock:
            if mode not in _clients:
                _clients[mode] = _make_client(mode)
    return _clients[mode]


_CYRILLIC_RE = re.compile(r'[а-яёА-ЯЁ]')


def _has_cyrillic(text: str) -> bool:
    return bool(_CYRILLIC_RE.search(text))


def _rewrite_summary_language(summary: str, want_russian: bool) -> str | None:
    """One-shot fix for a `summary` written in the wrong language relative to
    the selected review language — cheaper than re-running the whole review call."""
    target = "Russian" if want_russian else "English"
    try:
        result = _get_client(instructor.Mode.JSON).chat.completions.create(
            model=settings.LLM_MODEL,
            response_model=_SummaryRewrite,
            max_retries=1,
            temperature=0,
            extra_body=_extra_body(),
            messages=[
                {
                    "role": "system",
                    "content": f"Rewrite the given text in {target}, preserving its meaning exactly. Don't add or remove information.",
                },
                {"role": "user", "content": summary},
            ],
        )
        return result.summary
    except Exception as exc:
        logger.warning("Summary language rewrite failed: %s", _root_cause(exc))
        return None


def analyze_testcase_with_llm(
    clean_testcase: dict,
    enabled_rules: list[str] | None = None,
    language: str = "ru",
) -> ReviewResult:
    prompt = build_review_prompt(enabled_rules, language)
    rules_count = len(enabled_rules) if enabled_rules else 0
    logger.info("LLM analyze: model=%s rules=%d title=%s", settings.LLM_MODEL, rules_count, (clean_testcase.get("title") or "")[:60])
    t0 = time.perf_counter()
    try:
        # Mode.JSON (prose schema description) — reliably fills `issues` here.
        # JSON_SCHEMA regressed this call: the model sometimes wrote a `summary`
        # describing violations but left `issues` empty (grammar constraint let
        # it skip the field since list[] is a valid empty default).
        # Mode.JSON appends its own English schema dump to the end of the system
        # message (instructor internals), which sits closer to generation time
        # than our own "## Language" instruction and pulls weaker models back to
        # English — hence the explicit language reminder in the user message below.
        llm_result = _get_client(instructor.Mode.JSON).chat.completions.create(
            model=settings.LLM_MODEL,
            response_model=_LLMReviewResult,
            max_retries=1,
            temperature=_resolve_temperature(settings.LLM_TEMPERATURE_REVIEW, settings.LLM_TEMPERATURE),
            extra_body=_extra_body(),
            messages=[
                {"role": "system", "content": prompt},
                {
                    "role": "user",
                    "content": (
                        f"Test case to analyze:\n\n{json.dumps(clean_testcase, ensure_ascii=False, indent=2)}\n\n"
                        f"Write summary, problem, evidence, and recommendation in {'Russian' if language == 'ru' else 'English'}."
                    ),
                },
            ],
        )
        logger.info("LLM analyze ok: %.1fs issues=%d warnings=%d", time.perf_counter() - t0, len(llm_result.issues), len(llm_result.warnings))
        summary = llm_result.summary
        want_russian = language == "ru"
        if summary.strip() and want_russian != _has_cyrillic(summary):
            logger.warning("LLM analyze: summary language mismatch, retrying rewrite")
            rewritten = _rewrite_summary_language(summary, want_russian=want_russian)
            if rewritten:
                summary = rewritten
        return ReviewResult(
            summary=summary,
            issues=[i.to_issue(language) for i in llm_result.issues],
            warnings=llm_result.warnings,
        )
    except Exception as exc:
        logger.error("LLM analyze failed (%.1fs) [%s]: %s", time.perf_counter() - t0, type(exc).__name__, _root_cause(exc))
        return _FALLBACK_REVIEW


def improve_testcase_with_llm(
    testcase: dict,
    selected_issues: list[dict],
    language: str = "ru",
) -> ImproveResult:
    rule_ids = [r for iss in selected_issues if (r := iss.get("rule"))]
    if not selected_issues:
        # No issues selected at all — no fix guidance should be included.
        prompt = build_improve_prompt([], language)
    elif rule_ids:
        prompt = build_improve_prompt(rule_ids, language)
    else:
        # Issues selected but none carry a `rule` field (e.g. an external
        # source) — fall back to the full rule set for fix guidance.
        prompt = build_improve_prompt(None, language)
    numbered_issues = [{"issue_index": i, **iss} for i, iss in enumerate(selected_issues)]
    user_content = (
        f"Test case to improve:\n{json.dumps(testcase, ensure_ascii=False, indent=2)}\n\n"
        f"Issues to fix (0-indexed, use issue_index from the 'issue_index' field):\n"
        f"{json.dumps(numbered_issues, ensure_ascii=False, indent=2)}"
    )
    logger.info("LLM improve: model=%s issues=%d title=%s", settings.LLM_MODEL, len(selected_issues), (testcase.get("title") or "")[:60])

    def _call() -> ImproveResult:
        # JSON_SCHEMA passes the actual Pydantic schema to the model (via Ollama's
        # grammar-constrained "format" field) instead of describing it in prose.
        # Mode.JSON left local Ollama models (qwen2.5-coder:14b) producing
        # structurally-valid but empty/duplicated output on this nested schema —
        # e.g. description="" and steps=[] on a non-empty source testcase,
        # passing validation while losing all real content.
        return _get_client(instructor.Mode.JSON_SCHEMA).chat.completions.create(
            model=settings.LLM_MODEL,
            response_model=ImproveResult,
            max_retries=1,
            temperature=_resolve_temperature(settings.LLM_TEMPERATURE_IMPROVE, settings.LLM_TEMPERATURE),
            extra_body=_extra_body(),
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_content},
            ],
        )

    t0 = time.perf_counter()
    try:
        result = _call()
        # issue_resolutions=[] is schema-valid, so a model that just skips the
        # field passes validation silently. One retry recovers most cases
        # without risking a hard failure if the model skips it again.
        if selected_issues and not result.issue_resolutions:
            logger.warning("LLM improve: issue_resolutions empty, retrying once")
            retry_result = _call()
            if retry_result.issue_resolutions:
                result = retry_result
        logger.info("LLM improve ok: %.1fs resolved=%d", time.perf_counter() - t0, len(result.issue_resolutions))
        return result
    except Exception as exc:
        logger.error("LLM improve failed (%.1fs): %s", time.perf_counter() - t0, _root_cause(exc))
        raise RuntimeError(f"LLM improve unavailable: {_root_cause(exc)}") from exc


def parse_testcase_with_llm(raw_text: str) -> TextParseResult | None:
    """Parse free-form test case text. Returns None on failure (caller falls back to regex)."""
    from pathlib import Path
    _parse_prompt_path = Path(__file__).parent / "prompts" / "parse_testcase.md"
    try:
        prompt = _parse_prompt_path.read_text(encoding="utf-8").strip()
    except Exception as exc:
        logger.warning("Failed to load parse prompt: %s", exc)
        prompt = "You are a QA assistant."
    t0 = time.perf_counter()
    try:
        result = _get_client(instructor.Mode.JSON).chat.completions.create(
            model=settings.LLM_MODEL,
            response_model=TextParseResult,
            max_retries=1,
            temperature=0,
            extra_body=_extra_body(),
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": f"Parse this test case:\n\n{raw_text}"},
            ],
        )
        logger.debug("LLM parse ok: %.1fs", time.perf_counter() - t0)
        return result
    except Exception as exc:
        logger.error("LLM parse failed (%.1fs): %s", time.perf_counter() - t0, _root_cause(exc))
        return None
