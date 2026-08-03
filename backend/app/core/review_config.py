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

_CONFIG = ReviewConfig(
    sources=[
        ReviewSourceConfig(id="testit", label="TestIT", enabled=True),
        ReviewSourceConfig(id="testops", label="TestOps", enabled=False, badge="soon"),
    ],
    profiles=[
        ReviewProfileConfig(
            id="standard",
            label="Standard review",
            rules=["title", "description", "preconditions", "steps", "expected_results", "test_data", "reproducibility"],
        ),
        ReviewProfileConfig(
            id="strict",
            label="Strict review",
            rules=_DEFAULT_RULES,
        ),
    ],
    rules=[
        ReviewRuleConfig(id="title", label="Title", description="Title is readable, not in snake_case/kebab-case, reflects the scenario.", group="Case quality", enabled=True, order=10),
        ReviewRuleConfig(id="description", label="Description", description="Description is present, does not duplicate the title or contradict the steps.", group="Case quality", enabled=True, order=12),
        ReviewRuleConfig(id="preconditions", label="Preconditions", description="Preconditions describe system state, not actions. No references to other test cases.", group="Case quality", enabled=True, order=15),
        ReviewRuleConfig(id="steps", label="Steps", description="Each step contains one action. The order of steps is logically possible. No vague goals instead of concrete actions.", group="Case quality", enabled=True, order=17),
        ReviewRuleConfig(id="postconditions", label="Postconditions", description="The final system state after the test is described. No mixing of state and observed result in one field.", group="Case quality", enabled=True, order=18),
        ReviewRuleConfig(id="priority", label="Priority", description="Priority matches the criticality of the scenario. Auth and payments: high. Main flow: medium. UI details: low.", group="Metadata", enabled=True, order=19),
        ReviewRuleConfig(id="expected_results", label="Expected results", description="Each significant step has a specific expected result: system state, text, screen, status.", group="Case quality", enabled=True, order=20),
        ReviewRuleConfig(id="test_data", label="Test data", description="Data is explicitly specified in a separate field, not embedded in the action text.", group="Case quality", enabled=True, order=30),
        ReviewRuleConfig(id="tags", label="Tags", description="Tags match the case content: type, level, module. Flags incorrect and obviously missing tags.", group="Metadata", enabled=True, order=40),
        ReviewRuleConfig(id="atomicity", label="Atomicity", description="One case contains one verification goal. Flags mixing of independent scenarios.", group="Case quality", enabled=True, order=60),
        ReviewRuleConfig(id="independence", label="Independence", description="Case runs in any order without dependency on other tests.", group="Case quality", enabled=True, order=70),
        ReviewRuleConfig(id="reproducibility", label="Reproducibility", description="Case can be run without verbal explanations from the author. Flags implicit assumptions and vague wording.", group="Case quality", enabled=True, order=90),
    ],
    defaults={"testit": _DEFAULT_RULES},
)


def get_review_config() -> ReviewConfig:
    return _CONFIG
