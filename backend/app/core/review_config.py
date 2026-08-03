from __future__ import annotations

from pydantic import BaseModel


class ReviewSourceConfig(BaseModel):
    id: str
    label: str
    enabled: bool
    badge: str | None = None


class ReviewProfileConfig(BaseModel):
    id: str
    label: str
    description: str | None = None
    rules: list[str]


class ReviewRuleConfig(BaseModel):
    id: str
    label: str
    description: str | None = None
    group: str | None = None
    default_for: list[str] | None = None
    profiles: list[str] | None = None
    enabled: bool
    order: int


class ReviewConfig(BaseModel):
    sources: list[ReviewSourceConfig]
    profiles: list[ReviewProfileConfig]
    rules: list[ReviewRuleConfig]
    defaults: dict[str, list[str]]


_DEFAULT_RULES = [
    "title",
    "description",
    "preconditions",
    "steps",
    "postconditions",
    "priority",
    "expected_results",
    "test_data",
    "tags",
    "atomicity",
    "independence",
    "reproducibility",
]

# label/description/group text per language — everything else (id, order, enabled,
# rules list membership) is language-independent and lives once, below.
_TEXT: dict[str, dict[str, str]] = {
    "en": {
        "source_testit": "TestIT",
        "source_testops": "TestOps",
        "profile_standard_label": "Standard review",
        "profile_strict_label": "Strict review",
        "group_case_quality": "Case quality",
        "group_metadata": "Metadata",
        "rule_title_label": "Title",
        "rule_title_desc": "Title is readable, not in snake_case/kebab-case, reflects the scenario.",
        "rule_description_label": "Description",
        "rule_description_desc": "Description is present, does not duplicate the title or contradict the steps.",
        "rule_preconditions_label": "Preconditions",
        "rule_preconditions_desc": "Preconditions describe system state, not actions. No references to other test cases.",
        "rule_steps_label": "Steps",
        "rule_steps_desc": "Each step contains one action. The order of steps is logically possible. No vague goals instead of concrete actions.",
        "rule_postconditions_label": "Postconditions",
        "rule_postconditions_desc": "The final system state after the test is described. No mixing of state and observed result in one field.",
        "rule_priority_label": "Priority",
        "rule_priority_desc": "Priority matches the criticality of the scenario. Auth and payments: high. Main flow: medium. UI details: low.",
        "rule_expected_results_label": "Expected results",
        "rule_expected_results_desc": "Each significant step has a specific expected result: system state, text, screen, status.",
        "rule_test_data_label": "Test data",
        "rule_test_data_desc": "Data is explicitly specified in a separate field, not embedded in the action text.",
        "rule_tags_label": "Tags",
        "rule_tags_desc": "Tags match the case content: type, level, module. Flags incorrect and obviously missing tags.",
        "rule_atomicity_label": "Atomicity",
        "rule_atomicity_desc": "One case contains one verification goal. Flags mixing of independent scenarios.",
        "rule_independence_label": "Independence",
        "rule_independence_desc": "Case runs in any order without dependency on other tests.",
        "rule_reproducibility_label": "Reproducibility",
        "rule_reproducibility_desc": "Case can be run without verbal explanations from the author. Flags implicit assumptions and vague wording.",
    },
    "ru": {
        "source_testit": "TestIT",
        "source_testops": "TestOps",
        "profile_standard_label": "Базовая проверка",
        "profile_strict_label": "Строгая проверка",
        "group_case_quality": "Качество кейса",
        "group_metadata": "Метаданные",
        "rule_title_label": "Заголовок",
        "rule_title_desc": "Заголовок читаем, не в snake_case/kebab-case, отражает сценарий.",
        "rule_description_label": "Описание",
        "rule_description_desc": "Описание присутствует, не дублирует заголовок и не противоречит шагам.",
        "rule_preconditions_label": "Предусловия",
        "rule_preconditions_desc": "Предусловия описывают состояние системы, а не действия. Нет ссылок на другие тест-кейсы.",
        "rule_steps_label": "Шаги",
        "rule_steps_desc": "Каждый шаг содержит одно действие. Порядок шагов логически возможен. Нет расплывчатых целей вместо конкретных действий.",
        "rule_postconditions_label": "Постусловия",
        "rule_postconditions_desc": "Описано конечное состояние системы после теста. Нет смешения состояния и наблюдаемого результата в одном поле.",
        "rule_priority_label": "Приоритет",
        "rule_priority_desc": "Приоритет соответствует критичности сценария. Авторизация и платежи: high. Основной сценарий: medium. Детали UI: low.",
        "rule_expected_results_label": "Ожидаемые результаты",
        "rule_expected_results_desc": "У каждого значимого шага есть конкретный ожидаемый результат: состояние системы, текст, экран, статус.",
        "rule_test_data_label": "Тестовые данные",
        "rule_test_data_desc": "Данные явно указаны в отдельном поле, а не встроены в текст действия.",
        "rule_tags_label": "Теги",
        "rule_tags_desc": "Теги соответствуют содержанию кейса: тип, уровень, модуль. Флагует некорректные и явно отсутствующие теги.",
        "rule_atomicity_label": "Атомарность",
        "rule_atomicity_desc": "Один кейс содержит одну цель проверки. Флагует смешение независимых сценариев.",
        "rule_independence_label": "Независимость",
        "rule_independence_desc": "Кейс выполняется в любом порядке без зависимости от других тестов.",
        "rule_reproducibility_label": "Воспроизводимость",
        "rule_reproducibility_desc": "Кейс можно выполнить без устных пояснений автора. Флагует неявные допущения и расплывчатые формулировки.",
    },
}

_RULE_ORDER = [
    ("title", 10), ("description", 12), ("preconditions", 15), ("steps", 17),
    ("postconditions", 18), ("priority", 19), ("expected_results", 20),
    ("test_data", 30), ("tags", 40), ("atomicity", 60), ("independence", 70),
    ("reproducibility", 90),
]
_RULE_GROUP = {
    "title": "group_case_quality", "description": "group_case_quality",
    "preconditions": "group_case_quality", "steps": "group_case_quality",
    "postconditions": "group_case_quality", "priority": "group_metadata",
    "expected_results": "group_case_quality", "test_data": "group_case_quality",
    "tags": "group_metadata", "atomicity": "group_case_quality",
    "independence": "group_case_quality", "reproducibility": "group_case_quality",
}


def _build_config(language: str) -> ReviewConfig:
    t = _TEXT.get(language, _TEXT["ru"])
    rules = [
        ReviewRuleConfig(
            id=rule_id,
            label=t[f"rule_{rule_id}_label"],
            description=t[f"rule_{rule_id}_desc"],
            group=t[_RULE_GROUP[rule_id]],
            enabled=True,
            order=order,
        )
        for rule_id, order in _RULE_ORDER
    ]
    return ReviewConfig(
        sources=[
            ReviewSourceConfig(id="testit", label=t["source_testit"], enabled=True),
            ReviewSourceConfig(id="testops", label=t["source_testops"], enabled=False, badge="soon"),
        ],
        profiles=[
            ReviewProfileConfig(
                id="standard",
                label=t["profile_standard_label"],
                rules=["title", "description", "preconditions", "steps", "expected_results", "test_data", "reproducibility"],
            ),
            ReviewProfileConfig(
                id="strict",
                label=t["profile_strict_label"],
                rules=_DEFAULT_RULES,
            ),
        ],
        rules=rules,
        defaults={"testit": _DEFAULT_RULES},
    )


_CONFIG_CACHE: dict[str, ReviewConfig] = {}


def get_review_config(language: str = "ru") -> ReviewConfig:
    if language not in _CONFIG_CACHE:
        _CONFIG_CACHE[language] = _build_config(language)
    return _CONFIG_CACHE[language]
