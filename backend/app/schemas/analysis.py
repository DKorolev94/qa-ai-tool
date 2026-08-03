from __future__ import annotations
import logging
import re
from typing import Literal
from pydantic import BaseModel, field_validator

logger = logging.getLogger(__name__)


ReviewRuleId = Literal[
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
    "structure",  # deprecated: kept for backward compat, use title/preconditions/steps/postconditions/priority
]


class TextParseResult(BaseModel):
    title: str = ""
    description: str = ""
    preconditions: list["AnalysisStep"] = []
    steps: list["AnalysisStep"] = []
    postconditions: list["AnalysisStep"] = []
    tags: list[str] = []
    priority: str | None = None
    status: str | None = None
    duration: int | None = None


class AnalysisIssue(BaseModel):
    rule: str | None = None
    severity: Literal["low", "medium", "high"]
    title: str
    description: str
    recommendation: str


# LLM sometimes outputs field names instead of rule IDs — map them to closest valid rule
_RULE_ALIASES: dict[str, str] = {
    "title": "title",
    "description": "description",
    "preconditions": "preconditions",
    "steps": "steps",
    "postconditions": "postconditions",
    "priority": "priority",
    "expected": "expected_results",
    "expected_result": "expected_results",
    "test_data_field": "test_data",
    "data": "test_data",
    # deprecated alias
    "structure": "title",
}

_RULE_LABELS: dict[str, str] = {
    "title": "Заголовок",
    "description": "Описание",
    "preconditions": "Предусловия",
    "steps": "Шаги",
    "postconditions": "Постусловия",
    "priority": "Приоритет",
    "expected_results": "Ожидаемые результаты",
    "test_data": "Тестовые данные",
    "tags": "Теги",
    "atomicity": "Атомарность",
    "independence": "Независимость",
    "reproducibility": "Воспроизводимость",
    "structure": "Структура",  # deprecated
}


_EMPTY_EVIDENCE_RE = re.compile(
    r"=\s*(?:null|none|\[\]|\{\}|\"\"|'')\s*\.?$",
    re.IGNORECASE,
)
_EMPTY_ASSIGNMENT_RE = re.compile(
    r"=\s*(?:null|none|\[\]|\{\}|\"\"|''|“”|‘’)(?:\s|,|\.|$)",
    re.IGNORECASE,
)
_EMPTY_EVIDENCE_TEXT_RE = re.compile(
    r"^(?:поле\s+)?[\wА-Яа-яЁё ._-]+\s+"
    r"(?:пустое|пустой|пустая|пусто|отсутствует|не заполнено|не заполнена)\.?$",
    re.IGNORECASE,
)


def _has_meaningful_evidence(evidence: str | None) -> bool:
    if not evidence or not evidence.strip():
        return False

    text = evidence.strip()
    normalized = " ".join(text.split())
    if _EMPTY_EVIDENCE_RE.search(normalized):
        return False
    if _EMPTY_ASSIGNMENT_RE.search(normalized):
        return False
    if _EMPTY_EVIDENCE_TEXT_RE.fullmatch(normalized):
        return False
    return True


class _LLMIssue(BaseModel):
    """Internal model matching prompt output. rule is constrained to valid ReviewRuleId values."""
    rule: ReviewRuleId
    severity: Literal["low", "medium", "high"]
    problem: str
    evidence: str | None = None
    recommendation: str

    @field_validator("rule", mode="before")
    @classmethod
    def normalize_rule(cls, v: object) -> object:
        if isinstance(v, str):
            aliased = _RULE_ALIASES.get(v)
            if aliased is not None:
                if aliased != v:
                    logger.warning("LLM returned aliased rule '%s' → '%s'", v, aliased)
                return aliased
            return v
        return v

    def to_issue(self) -> AnalysisIssue:
        desc = self.problem
        if _has_meaningful_evidence(self.evidence):
            desc = f"{self.problem}\n\nПример: {self.evidence}"
        return AnalysisIssue(
            rule=self.rule,
            severity=self.severity,
            title=_RULE_LABELS.get(self.rule, self.rule),
            description=desc,
            recommendation=self.recommendation,
        )


class _LLMReviewResult(BaseModel):
    """Internal model for LLM output — converted to ReviewResult before returning."""
    reasoning: str
    summary: str
    issues: list[_LLMIssue] = []
    warnings: list[str] = []


class AnalysisStep(BaseModel):
    action: str
    expected: str | None = None
    test_data: str | None = None
    comments: str | None = None


TextParseResult.model_rebuild()


class AnalyzedTestCase(BaseModel):
    title: str = ""
    description: str = ""
    preconditions: list[AnalysisStep] = []
    steps: list[AnalysisStep] = []
    postconditions: list[AnalysisStep] = []
    tags: list[str] = []
    priority: str | None = None
    status: str | None = None
    duration: str | int | None = None
    attributes: dict = {}


class IssueResolution(BaseModel):
    issue_index: int
    issue_title: str
    status: Literal["resolved", "manual_needed", "skipped"]
    reason: str | None = None


# LLM output models — used by instructor, validated against these schemas
class ReviewResult(BaseModel):
    summary: str
    issues: list[AnalysisIssue] = []
    warnings: list[str] = []


class ImproveResult(BaseModel):
    improved_testcase: AnalyzedTestCase
    issue_resolutions: list[IssueResolution] = []
    improvement_notes: list[str] = []
    manual_notes: list[str] = []
    warnings: list[str] = []


# HTTP request/response models
class AnalyzeTestCaseRequest(BaseModel):
    raw_content: str | None = None
    work_item: dict | None = None
    enabled_rules: list[ReviewRuleId] | None = None
    language: Literal["ru", "en"] = "ru"


class AnalyzeTestCaseResponse(BaseModel):
    summary: str
    issues: list[AnalysisIssue] = []
    original_normalized_testcase: dict = {}
    warnings: list[str] = []


class ImproveTestCaseRequest(BaseModel):
    raw_content: str | None = None
    work_item: dict | None = None
    selected_issues: list[dict] = []
    language: Literal["ru", "en"] = "ru"


class ImproveTestCaseResponse(BaseModel):
    improved_testcase: AnalyzedTestCase
    original_normalized_testcase: dict = {}
    issue_resolutions: list[IssueResolution] = []
    improvement_notes: list[str] = []
    manual_notes: list[str] = []
    warnings: list[str] = []
    validation_warnings: list[str] = []
    diff: dict = {}
    display_duration: str | None = None
