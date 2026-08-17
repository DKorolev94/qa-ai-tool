from __future__ import annotations

ERROR_MESSAGES: dict[str, dict[str, str]] = {
    "missing_input": {
        "en": "Provide raw_content or work_item",
        "ru": "Укажите raw_content или work_item",
    },
    "llm_improve_unavailable": {
        "en": "LLM improve unavailable: {detail}",
        "ru": "LLM недоступен для улучшения: {detail}",
    },
    "invalid_work_item_input": {
        "en": (
            "Could not extract a TestIT work item id from input: {value}. "
            "Provide a numeric ID (e.g. 6109), a UUID, or a TestIT test case URL."
        ),
        "ru": (
            "Не удалось распознать id тест-кейса TestIT во входных данных: {value}. "
            "Укажите числовой ID (например, 6109), UUID или ссылку на тест-кейс TestIT."
        ),
    },
    "testit_base_url_missing": {
        "en": "TESTIT_BASE_URL is not configured in .env",
        "ru": "TESTIT_BASE_URL не задан в .env",
    },
    "testit_token_missing": {
        "en": "TESTIT_PRIVATE_TOKEN is not configured in .env",
        "ru": "TESTIT_PRIVATE_TOKEN не задан в .env",
    },
    "testit_project_uuid_missing": {
        "en": "Source test case has no projectId — cannot determine which TestIT project to save to",
        "ru": "У исходного тест-кейса нет projectId — не удалось определить проект TestIT для сохранения",
    },
    "testit_auth_failed": {
        "en": "TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.",
        "ru": "Ошибка авторизации в TestIT. Проверьте TESTIT_PRIVATE_TOKEN.",
    },
    "testit_not_found": {
        "en": "TestIT work item not found: {id}",
        "ru": "Тест-кейс не найден в TestIT: {id}",
    },
    "testit_timeout": {
        "en": "Connection to TestIT timed out",
        "ru": "Превышено время ожидания соединения с TestIT",
    },
    "testit_connect_failed": {
        "en": "Could not connect to TestIT: {exc_type}",
        "ru": "Не удалось подключиться к TestIT: {exc_type}",
    },
    "testit_response_error": {
        "en": "TestIT returned a non-JSON response (HTTP {status_code})",
        "ru": "TestIT вернул не-JSON ответ (HTTP {status_code})",
    },
}


def localize(code: str, language: str, **params) -> str:
    """Falls back to English, then to the raw code, if a translation is missing."""
    entry = ERROR_MESSAGES.get(code)
    if entry is None:
        return code
    template = entry.get(language) or entry.get("en") or code
    try:
        return template.format(**params)
    except (KeyError, IndexError):
        return template
