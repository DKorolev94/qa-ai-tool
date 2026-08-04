from __future__ import annotations

# Bilingual catalog for backend-generated strings that end up in API responses
# (issue resolutions, validation warnings, manual notes, LLM-unavailable
# fallback) — mirrors the pattern in app.core.errors_i18n, kept as a separate
# module since these are service-layer messages, not HTTP error bodies.

SERVICE_MESSAGES: dict[str, dict[str, str]] = {
    "not_processed_by_llm": {
        "en": "Not processed by LLM",
        "ru": "Не обработано LLM",
    },
    "linked_docs_placeholder": {
        "en": (
            "Improvement references linked documents, but links is empty — "
            "a real data source is needed"
        ),
        "ru": (
            "Улучшение ссылается на связанные документы, но поле links пустое — "
            "нужен реальный источник данных"
        ),
    },
    "field_unchanged": {
        "en": "Field unchanged — improvement not applied",
        "ru": "Поле не изменилось — улучшение не применено",
    },
    "invented_test_data": {
        "en": (
            "The LLM wrote test data (email/password/token) not present in the "
            "source test case — verify or replace it with a real value before "
            "using this test case."
        ),
        "ru": (
            "LLM указал тестовые данные (email/пароль/токен), которых не было "
            "в исходном тест-кейсе — проверьте и замените их реальным значением "
            "перед использованием этого тест-кейса."
        ),
    },
    "stripped_placeholder": {
        "en": (
            "Test data is missing for at least one step and no real value could "
            "be determined — state it manually rather than leaving a stand-in value."
        ),
        "ru": (
            "Для одного или нескольких шагов не хватает тестовых данных, и "
            "определить реальное значение не удалось — укажите его вручную, "
            "а не оставляйте заглушку."
        ),
    },
    "missing_param_tokens": {
        "en": (
            "A TestIT parameter reference (%param%) from the source test case "
            "appears to be missing or altered — check the diff and restore it "
            "if needed."
        ),
        "ru": (
            "Похоже, ссылка на параметр TestIT (%param%) из исходного тест-кейса "
            "пропала или была изменена — проверьте diff и восстановите её при "
            "необходимости."
        ),
    },
    "no_steps": {
        "en": "Improved test case has no steps",
        "ru": "В улучшенном тест-кейсе нет шагов",
    },
    "step_missing_action": {
        "en": "Step {n}: missing action",
        "ru": "Шаг {n}: отсутствует действие",
    },
    "step_expected_restored": {
        "en": "Step {n}: expected result restored from original",
        "ru": "Шаг {n}: ожидаемый результат восстановлен из оригинала",
    },
    "fallback_summary": {
        "en": "LLM is unavailable. The test case was parsed, but analysis could not run.",
        "ru": "LLM недоступен. Тест-кейс был распознан, но выполнить анализ не удалось.",
    },
    "fallback_issue_title": {
        "en": "AI analysis failed",
        "ru": "Не удалось выполнить AI-анализ",
    },
    "fallback_issue_description": {
        "en": "The LLM endpoint is unavailable or returned invalid data.",
        "ru": "Эндпоинт LLM недоступен или вернул некорректные данные.",
    },
    "fallback_issue_recommendation": {
        "en": "Check the LLM_BASE_URL and LLM_MODEL settings in .env.",
        "ru": "Проверьте настройки LLM_BASE_URL и LLM_MODEL в .env.",
    },
    "invented_data_warning": {
        "en": "Possible invented test data not present in the source (verify before use): {items}",
        "ru": "Возможно придуманные тестовые данные, которых не было в исходнике (проверьте перед использованием): {items}",
    },
    "stripped_placeholder_warning": {
        "en": "LLM tried to write a placeholder instead of real test data — removed; check manual_notes for what's missing",
        "ru": "LLM попытался написать заглушку вместо реальных тестовых данных — удалена; чего не хватает, см. manual_notes",
    },
    "missing_param_tokens_warning": {
        "en": "TestIT parameter reference(s) from the source are missing after improve — verify they weren't altered: {items}",
        "ru": "После улучшения пропали ссылки на параметры TestIT из исходника — проверьте, что они не были изменены: {items}",
    },
    "cancelled_by_user": {
        "en": "Cancelled by user",
        "ru": "Отменено пользователем",
    },
}


def localize(code: str, language: str, **params) -> str:
    """Falls back to English, then to the raw code, if a translation is missing."""
    entry = SERVICE_MESSAGES.get(code)
    if entry is None:
        return code
    template = entry.get(language) or entry.get("en") or code
    try:
        return template.format(**params)
    except (KeyError, IndexError):
        return template
