from __future__ import annotations

import json
import logging
from pathlib import Path

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_REVIEW_PROMPT_PATH = Path(__file__).parent / "prompts" / "testcase_review.md"
_IMPROVE_PROMPT_PATH = Path(__file__).parent / "prompts" / "testcase_improvement.md"

_FALLBACK_REVIEW = {
    "summary": "LLM недоступен. Это fallback review. Тест-кейс успешно распарсен, но AI review не выполнен.",
    "issues": [
        {
            "severity": "medium",
            "title": "AI review не выполнен",
            "description": "Локальный LLM endpoint недоступен или вернул невалидные данные.",
            "recommendation": "Проверь статус Ollama, настройки LLM_BASE_URL и LLM_MODEL.",
        }
    ],
    "suggested_test_cases": [],
    "warnings": ["LLM is unavailable, mock response returned"],
    "raw_cleaned_testcase": {},
}


def _load_prompt(path: Path, fallback: str) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception as exc:
        logger.warning("Failed to load prompt %s: %s", path, exc)
        return fallback


def _build_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if settings.LLM_API_KEY:
        headers["Authorization"] = f"Bearer {settings.LLM_API_KEY}"
    return headers


def _post_chat(system_prompt: str, user_content: str) -> dict:
    payload = {
        "model": settings.LLM_MODEL,
        "temperature": settings.LLM_TEMPERATURE,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "response_format": {"type": "json_object"},
    }
    url = f"{settings.LLM_BASE_URL.rstrip('/')}/chat/completions"
    with httpx.Client(timeout=120.0) as client:
        response = client.post(url, json=payload, headers=_build_headers())
        response.raise_for_status()
        data = response.json()
    return data


def review_testcase_with_llm(clean_testcase: dict) -> dict:
    system_prompt = _load_prompt(
        _REVIEW_PROMPT_PATH, "You are a QA assistant. Review the test case and return JSON."
    )
    user_content = f"Тест-кейс для review:\n\n{json.dumps(clean_testcase, ensure_ascii=False, indent=2)}"

    try:
        data = _post_chat(system_prompt, user_content)
        raw_content = data["choices"][0]["message"]["content"]
        try:
            return json.loads(raw_content)
        except json.JSONDecodeError:
            logger.warning("LLM returned invalid JSON: %s", raw_content[:200])
            fallback = dict(_FALLBACK_REVIEW)
            fallback["warnings"] = ["LLM returned invalid JSON"]
            fallback["summary"] = f"LLM вернул невалидный JSON. Raw: {raw_content[:300]}"
            return fallback
    except Exception as exc:
        logger.warning("LLM review request failed: %s", exc)
        return dict(_FALLBACK_REVIEW)


def _build_fallback_improvement(clean_testcase: dict, warning: str) -> dict:
    return {
        "title": clean_testcase.get("title") or "",
        "description": clean_testcase.get("description") or "",
        "preconditions": clean_testcase.get("preconditions") or [],
        "steps": clean_testcase.get("steps") or [],
        "postconditions": clean_testcase.get("postconditions") or [],
        "tags": clean_testcase.get("tags") or [],
        "priority": clean_testcase.get("priority"),
        "status": clean_testcase.get("status"),
        "duration": clean_testcase.get("duration"),
        "attributes": clean_testcase.get("attributes") or {},
        "improvement_notes": ["AI improvement was not performed because LLM is unavailable"],
        "warnings": [warning],
    }


def improve_testcase_with_llm(clean_testcase: dict, review: dict | None = None) -> dict:
    system_prompt = _load_prompt(
        _IMPROVE_PROMPT_PATH, "You are a QA assistant. Improve the test case and return JSON."
    )

    parts = [f"Нормализованный тест-кейс:\n\n{json.dumps(clean_testcase, ensure_ascii=False, indent=2)}"]
    if review:
        parts.append(f"\nРезультат review:\n\n{json.dumps(review, ensure_ascii=False, indent=2)}")
    user_content = "\n".join(parts)

    try:
        data = _post_chat(system_prompt, user_content)
        raw_content = data["choices"][0]["message"]["content"]
        try:
            return json.loads(raw_content)
        except json.JSONDecodeError:
            logger.warning("LLM returned invalid JSON during improvement: %s", raw_content[:200])
            return _build_fallback_improvement(
                clean_testcase, "LLM returned invalid JSON during testcase improvement"
            )
    except Exception as exc:
        logger.warning("LLM improve request failed: %s", exc)
        return _build_fallback_improvement(
            clean_testcase, "LLM is unavailable, fallback improved testcase returned"
        )
