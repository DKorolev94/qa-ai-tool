from __future__ import annotations
from typing import Literal
from pydantic import BaseModel


class ParsedStep(BaseModel):
    action: str
    expected: str | None = None
    test_data: str | None = None
    comments: str | None = None


class TextParseResult(BaseModel):
    title: str = ""
    description: str = ""
    preconditions: list[ParsedStep] = []
    steps: list[ParsedStep] = []
    postconditions: list[ParsedStep] = []
    tags: list[str] = []
    priority: str | None = None
    status: str | None = None
    duration: int | None = None


class AnalysisIssue(BaseModel):
    severity: Literal["low", "medium", "high"]
    title: str
    description: str
    recommendation: str


class AnalysisStep(BaseModel):
    action: str
    expected: str | None = None
    test_data: str | None = None
    comments: str | None = None


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
    action_taken: str | None = None
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
    source_type: Literal["testit", "manual"] = "testit"


class AnalyzeTestCaseResponse(BaseModel):
    summary: str
    issues: list[AnalysisIssue] = []
    original_normalized_testcase: dict = {}
    warnings: list[str] = []


class ImproveTestCaseRequest(BaseModel):
    raw_content: str | None = None
    work_item: dict | None = None
    selected_issues: list[dict] = []
    source_type: Literal["testit", "manual"] = "testit"


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
