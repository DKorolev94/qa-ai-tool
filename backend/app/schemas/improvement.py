from __future__ import annotations

from pydantic import BaseModel

# Fields that exist in TestIT work items only
class ImprovedTestCaseStep(BaseModel):
    action: str
    expected: str | None = None
    test_data: str | None = None
    comments: str | None = None


class ImprovedTestCase(BaseModel):
    """Contains only fields that map to TestIT work item structure."""
    title: str = ""
    description: str = ""
    preconditions: list[ImprovedTestCaseStep] = []
    steps: list[ImprovedTestCaseStep] = []
    postconditions: list[ImprovedTestCaseStep] = []
    tags: list[str] = []
    priority: str | None = None
    status: str | None = None
    duration: str | int | None = None
    attributes: dict = {}


class ImproveTestCaseRequest(BaseModel):
    raw_content: str | None = None
    work_item: dict | None = None
    review: dict | None = None


class ImproveTestCaseResponse(BaseModel):
    improved_testcase: ImprovedTestCase
    original_normalized_testcase: dict
    review_used: dict | None = None
    diff: dict = {}
    improvement_notes: list[str] = []
    warnings: list[str] = []
    validation_warnings: list[str] = []
    display_duration: str | None = None
