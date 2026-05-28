from __future__ import annotations

import json
import logging
from pathlib import Path

import instructor
from openai import OpenAI

from app.core.config import settings
from app.schemas.analysis import (
    AnalysisIssue,
    AnalyzedTestCase,
    ImproveResult,
    ReviewResult,
)

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).parent / "prompts"

PROMPT_REGISTRY: dict[str, dict[str, Path]] = {
    "review": {
        "testit": _PROMPTS_DIR / "review_testit.md",
        "manual": _PROMPTS_DIR / "review_manual.md",
    },
    "improve": {
        "testit": _PROMPTS_DIR / "improve.md",
        "manual": _PROMPTS_DIR / "improve.md",
    },
}

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


def _load_prompt(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except Exception as exc:
        logger.warning("Failed to load prompt %s: %s", path, exc)
        return "You are a QA assistant."


_instructor_client: instructor.Instructor | None = None


def _get_instructor_client() -> instructor.Instructor:
    global _instructor_client
    if _instructor_client is None:
        openai_client = OpenAI(
            base_url=settings.LLM_BASE_URL,
            api_key=settings.LLM_API_KEY or "no-key",
        )
        _instructor_client = instructor.from_openai(openai_client, mode=instructor.Mode.JSON)
    return _instructor_client


def analyze_testcase_with_llm(
    clean_testcase: dict,
    source_type: str = "testit",
) -> ReviewResult:
    prompt_path = PROMPT_REGISTRY["review"].get(source_type, PROMPT_REGISTRY["review"]["testit"])
    prompt = _load_prompt(prompt_path)
    client = _get_instructor_client()
    try:
        return client.chat.completions.create(
            model=settings.LLM_MODEL,
            response_model=ReviewResult,
            max_retries=2,
            temperature=settings.LLM_TEMPERATURE,
            messages=[
                {"role": "system", "content": prompt},
                {
                    "role": "user",
                    "content": f"Тест-кейс для анализа:\n\n{json.dumps(clean_testcase, ensure_ascii=False, indent=2)}",
                },
            ],
        )
    except Exception as exc:
        logger.warning("LLM analyze failed: %s", exc)
        return _FALLBACK_REVIEW


def improve_testcase_with_llm(
    testcase: dict,
    selected_issues: list[dict],
    source_type: str = "testit",
) -> ImproveResult:
    prompt_path = PROMPT_REGISTRY["improve"].get(source_type, PROMPT_REGISTRY["improve"]["testit"])
    prompt = _load_prompt(prompt_path)
    client = _get_instructor_client()
    user_content = (
        f"Тест-кейс для улучшения:\n{json.dumps(testcase, ensure_ascii=False, indent=2)}\n\n"
        f"Проблемы для исправления (выбраны пользователем):\n{json.dumps(selected_issues, ensure_ascii=False, indent=2)}"
    )
    try:
        return client.chat.completions.create(
            model=settings.LLM_MODEL,
            response_model=ImproveResult,
            max_retries=2,
            temperature=settings.LLM_TEMPERATURE,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_content},
            ],
        )
    except Exception as exc:
        logger.warning("LLM improve failed: %s", exc)
        return _FALLBACK_IMPROVE
