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
    "duration",
    "atomicity",
    "independence",
    "requirement_traceability",
    "reproducibility",
    "stability",
    "access_control",
    "api_db",
    "data_security",
]

_CONFIG = ReviewConfig(
    sources=[
        ReviewSourceConfig(id="testit", label="TestIT", enabled=True),
        ReviewSourceConfig(id="manual", label="Вручную", enabled=False, badge="скоро"),
        ReviewSourceConfig(id="testops", label="TestOps", enabled=False, badge="скоро"),
    ],
    profiles=[
        ReviewProfileConfig(
            id="standard",
            label="Базовое ревью",
            rules=["title", "description", "preconditions", "steps", "postconditions", "expected_results", "test_data", "tags", "reproducibility"],
        ),
        ReviewProfileConfig(
            id="strict",
            label="Строгое ревью",
            rules=_DEFAULT_RULES,
        ),
        ReviewProfileConfig(
            id="traceability",
            label="Связанность",
            rules=["title", "steps", "expected_results", "test_data", "tags", "requirement_traceability"],
        ),
    ],
    rules=[
        ReviewRuleConfig(id="title", label="Заголовок", description="Заголовок читаемый, не в snake_case/kebab-case, отражает сценарий.", group="Качество кейса", enabled=True, order=10),
        ReviewRuleConfig(id="description", label="Описание", description="Описание присутствует, не дублирует заголовок и не противоречит шагам.", group="Качество кейса", enabled=True, order=12),
        ReviewRuleConfig(id="preconditions", label="Предусловия", description="Предусловия описывают состояние системы, а не действия. Нет ссылок на другие тест-кейсы.", group="Качество кейса", enabled=True, order=15),
        ReviewRuleConfig(id="steps", label="Шаги", description="Каждый шаг содержит одно действие. Порядок шагов логически возможен. Нет расплывчатых целей вместо конкретных действий.", group="Качество кейса", enabled=True, order=17),
        ReviewRuleConfig(id="postconditions", label="Постусловия", description="Описано конечное состояние системы после теста. Нет смешения состояния и наблюдаемого результата в одном поле.", group="Качество кейса", enabled=True, order=18),
        ReviewRuleConfig(id="priority", label="Приоритет", description="Приоритет соответствует критичности сценария. Авторизация и оплата: высокий. Основной флоу: средний. Детали интерфейса: низкий.", group="Метаданные", enabled=True, order=19),
        ReviewRuleConfig(id="expected_results", label="Ожидаемые результаты", description="У каждого значимого шага есть конкретный ожидаемый результат: состояние системы, текст, экран, статус.", group="Качество кейса", enabled=True, order=20),
        ReviewRuleConfig(id="test_data", label="Тестовые данные", description="Данные явно указаны в отдельном поле, не вписаны в текст действия.", group="Качество кейса", enabled=True, order=30),
        ReviewRuleConfig(id="tags", label="Теги", description="Теги соответствуют содержанию кейса: тип, уровень, модуль. Флажит неверные и очевидно отсутствующие теги.", group="Метаданные", enabled=True, order=40),
        ReviewRuleConfig(id="duration", label="Длительность", description="Длительность реалистична для ручного выполнения. Атомарный кейс: 2-5 мин. Стандартный: 5-15 мин. Сквозной: 15-30 мин.", group="Метаданные", enabled=False, order=50),
        ReviewRuleConfig(id="atomicity", label="Атомарность", description="Один кейс содержит одну цель проверки. Флажит смешение независимых сценариев.", group="Качество кейса", enabled=True, order=60),
        ReviewRuleConfig(id="independence", label="Независимость", description="Кейс выполняется в любом порядке без зависимости от других тестов.", group="Качество кейса", enabled=True, order=70),
        ReviewRuleConfig(id="requirement_traceability", label="Связь с требованиями", description="Флажит только если ссылки отсутствуют и по содержанию кейса непонятно, какая функциональность покрывается.", group="Связанность", enabled=True, order=80),
        ReviewRuleConfig(id="reproducibility", label="Воспроизводимость", description="Кейс можно выполнить без устных пояснений автора. Флажит неявные допущения и расплывчатые формулировки.", group="Качество кейса", enabled=True, order=90),
        ReviewRuleConfig(id="stability", label="Стабильность", description="Признаки нестабильного выполнения: зависимость от времени, внешних сервисов, фиксированные ожидания без проверяемого условия.", group="Качество кейса", enabled=True, order=100),
        ReviewRuleConfig(id="access_control", label="Роли и права доступа", description="Роль и права явно указаны, если влияют на выполнение или результат. Флажит отсутствие роли в кейсах с ограниченным доступом.", group="Качество кейса", enabled=True, order=110),
        ReviewRuleConfig(id="api_db", label="API / DB проверки", description="Только для интеграционных кейсов: достаточность данных запроса, конкретность ожидаемого ответа, изменение данных в базе.", group="Качество кейса", enabled=True, order=120),
        ReviewRuleConfig(id="data_security", label="Безопасность данных", description="Тест-кейс не содержит реальных паролей, токенов или персональных данных. Флажит данные без признаков тестовых значений.", group="Безопасность", enabled=True, order=130),
    ],
    defaults={"testit": _DEFAULT_RULES, "manual": _DEFAULT_RULES},
)


def get_review_config() -> ReviewConfig:
    return _CONFIG
