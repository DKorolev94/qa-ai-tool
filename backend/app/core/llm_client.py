from __future__ import annotations

import json
import logging
import time

import instructor
from openai import OpenAI

from app.core.config import settings
from app.core.prompt_builder import build_improve_prompt, build_review_prompt
from app.schemas.analysis import (
    AnalysisIssue,
    AnalyzedTestCase,
    ImproveResult,
    ReviewResult,
    TextParseResult,
    _LLMReviewResult,
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
    summary="LLM недоступен. Тест-кейс распарсен, но анализ не выполнен.",
    issues=[
        AnalysisIssue(
            severity="medium",
            title="AI анализ не выполнен",
            description="LLM endpoint недоступен или вернул невалидные данные.",
            recommendation="Проверь настройки LLM_BASE_URL и LLM_MODEL в .env.",
        )
    ],
    warnings=["LLM is unavailable, fallback response returned"],
)

_FALLBACK_IMPROVE = ImproveResult(
    improved_testcase=AnalyzedTestCase(),
    issue_resolutions=[],
    warnings=["LLM is unavailable, fallback response returned"],
)


def _make_client() -> instructor.Instructor:
    openai_client = OpenAI(
        base_url=settings.LLM_BASE_URL,
        api_key=settings.LLM_API_KEY or "no-key",
        timeout=float(settings.LLM_TIMEOUT_SECONDS),
    )
    return instructor.from_openai(openai_client, mode=instructor.Mode.JSON)


_client = _make_client()


def analyze_testcase_with_llm(
    clean_testcase: dict,
    enabled_rules: list[str] | None = None,
) -> ReviewResult:
    prompt = build_review_prompt(enabled_rules)
    rules_count = len(enabled_rules) if enabled_rules else 0
    logger.info("LLM analyze: model=%s rules=%d title=%s", settings.LLM_MODEL, rules_count, clean_testcase.get("title", "")[:60])
    t0 = time.perf_counter()
    try:
        llm_result = _client.chat.completions.create(
            model=settings.LLM_MODEL,
            response_model=_LLMReviewResult,
            max_retries=1,
            temperature=settings.LLM_TEMPERATURE_REVIEW if settings.LLM_TEMPERATURE_REVIEW is not None else settings.LLM_TEMPERATURE,
            messages=[
                {"role": "system", "content": prompt},
                {
                    "role": "user",
                    "content": f"Тест-кейс для анализа:\n\n{json.dumps(clean_testcase, ensure_ascii=False, indent=2)}",
                },
            ],
        )
        logger.info("LLM analyze ok: %.1fs issues=%d warnings=%d", time.perf_counter() - t0, len(llm_result.issues), len(llm_result.warnings))
        return ReviewResult(
            summary=llm_result.summary,
            issues=[i.to_issue() for i in llm_result.issues],
            warnings=llm_result.warnings,
        )
    except Exception as exc:
        logger.error("LLM analyze failed (%.1fs): %s", time.perf_counter() - t0, _root_cause(exc))
        return _FALLBACK_REVIEW


def improve_testcase_with_llm(
    testcase: dict,
    selected_issues: list[dict],
) -> ImproveResult:
    rule_ids = [r for iss in selected_issues if (r := iss.get("rule"))]
    prompt = build_improve_prompt(rule_ids if rule_ids else None)
    numbered_issues = [{"issue_index": i, **iss} for i, iss in enumerate(selected_issues)]
    user_content = (
        f"Тест-кейс для улучшения:\n{json.dumps(testcase, ensure_ascii=False, indent=2)}\n\n"
        f"Проблемы для исправления (нумерация с 0, используй issue_index из поля 'issue_index'):\n"
        f"{json.dumps(numbered_issues, ensure_ascii=False, indent=2)}"
    )
    logger.info("LLM improve: model=%s issues=%d title=%s", settings.LLM_MODEL, len(selected_issues), testcase.get("title", "")[:60])
    t0 = time.perf_counter()
    try:
        result = _client.chat.completions.create(
            model=settings.LLM_MODEL,
            response_model=ImproveResult,
            max_retries=1,
            temperature=settings.LLM_TEMPERATURE_IMPROVE if settings.LLM_TEMPERATURE_IMPROVE is not None else settings.LLM_TEMPERATURE,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_content},
            ],
        )
        logger.info("LLM improve ok: %.1fs resolved=%d", time.perf_counter() - t0, len(result.issue_resolutions))
        return result
    except Exception as exc:
        logger.error("LLM improve failed (%.1fs): %s", time.perf_counter() - t0, _root_cause(exc))
        return _FALLBACK_IMPROVE


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
        result = _client.chat.completions.create(
            model=settings.LLM_MODEL,
            response_model=TextParseResult,
            max_retries=1,
            temperature=0,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": f"Разбери этот тест-кейс:\n\n{raw_text}"},
            ],
        )
        logger.debug("LLM parse ok: %.1fs", time.perf_counter() - t0)
        return result
    except Exception as exc:
        logger.error("LLM parse failed (%.1fs): %s", time.perf_counter() - t0, _root_cause(exc))
        return None
