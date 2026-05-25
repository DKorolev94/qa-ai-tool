from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class ReviewIssue(BaseModel):
    severity: Literal["low", "medium", "high"]
    title: str
    description: str
    recommendation: str


class SuggestedTestCaseStep(BaseModel):
    action: str
    expected: str


class SuggestedTestCase(BaseModel):
    title: str
    type: Literal["positive", "negative", "boundary", "permission", "integration"]
    priority: Literal["low", "medium", "high"]
    steps: list[SuggestedTestCaseStep]


class ReviewResponse(BaseModel):
    summary: str
    issues: list[ReviewIssue] = []
    suggested_test_cases: list[SuggestedTestCase] = []
    warnings: list[str] = []
    raw_cleaned_testcase: dict = {}
