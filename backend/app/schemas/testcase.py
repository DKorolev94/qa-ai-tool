from __future__ import annotations

from pydantic import BaseModel


class TestCaseStep(BaseModel):
    action: str
    expected: str | None = None
    test_data: str | None = None
    comments: str | None = None


class Attachment(BaseModel):
    name: str | None = None
    url: str | None = None
    type: str | None = None
    file_id: str | None = None


class ParameterTable(BaseModel):
    names: list[str]
    rows: list[list[str]]


class WorkItemLink(BaseModel):
    url: str | None = None
    title: str | None = None
    type: str | None = None
    description: str | None = None


class NormalizedTestCase(BaseModel):
    title: str | None = None
    description: str = ""
    preconditions: list[TestCaseStep] = []
    steps: list[TestCaseStep] = []
    postconditions: list[TestCaseStep] = []
    attachments: list[Attachment] = []
    links: list[WorkItemLink] = []
    tags: list[str] = []
    priority: str | None = None
    status: str | None = None
    duration: str | int | None = None
    display_duration: str | None = None
    attributes: dict = {}
    warnings: list[str] = []
    parameter_table: ParameterTable | None = None
    section_name: str | None = None
    product_versions: list[str] = []
