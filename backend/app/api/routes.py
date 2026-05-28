from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.integrations.testit_client import (
    TestItApiError,
    TestItAuthError,
    TestItConfigError,
    TestItConnectionError,
    TestItNotFoundError,
    TestItResponseError,
)
from app.parsing.testit_parser import parse_testit_content
from app.parsing.testit_workitem_mapper import normalize_testit_workitem
from app.schemas.analysis import (
    AnalyzeTestCaseRequest,
    AnalyzeTestCaseResponse,
    ImproveTestCaseRequest,
    ImproveTestCaseResponse,
)
from app.schemas.testcase import NormalizedTestCase
from app.schemas.testit import (
    CreateDraftRequest,
    CreateDraftResponse,
    FetchTestItWorkItemRequest,
    FetchTestItWorkItemResponse,
)
from app.services.testcase_analyzer import analyze_raw_testcase
from app.services.testcase_improver import improve_testcase
from app.services.testit_draft_service import create_draft_in_testit
from app.services.testit_workitem_service import fetch_and_normalize_work_item
from pydantic import BaseModel

router = APIRouter()


class RawContentRequest(BaseModel):
    raw_content: str


class WorkItemRequest(BaseModel):
    work_item: dict


@router.post("/clean-testcase", response_model=NormalizedTestCase)
async def clean_testcase(body: RawContentRequest) -> NormalizedTestCase:
    return parse_testit_content(body.raw_content)


@router.post("/normalize-testit-workitem", response_model=NormalizedTestCase)
async def normalize_workitem(body: WorkItemRequest) -> NormalizedTestCase:
    return normalize_testit_workitem(body.work_item)


@router.post("/analyze-testcase", response_model=AnalyzeTestCaseResponse)
async def analyze_testcase(body: AnalyzeTestCaseRequest) -> AnalyzeTestCaseResponse:
    if body.work_item is None and body.raw_content is None:
        raise HTTPException(status_code=422, detail="Provide raw_content or work_item")
    try:
        return analyze_raw_testcase(
            raw_content=body.raw_content,
            work_item=body.work_item,
            source_type=body.source_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/improve-testcase", response_model=ImproveTestCaseResponse)
async def improve_testcase_endpoint(body: ImproveTestCaseRequest) -> ImproveTestCaseResponse:
    if body.work_item is None and body.raw_content is None:
        raise HTTPException(status_code=422, detail="Provide raw_content or work_item")
    try:
        return improve_testcase(
            raw_content=body.raw_content,
            work_item=body.work_item,
            selected_issues=body.selected_issues,
            source_type=body.source_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/testit/workitem/fetch", response_model=FetchTestItWorkItemResponse)
async def fetch_testit_workitem(body: FetchTestItWorkItemRequest) -> FetchTestItWorkItemResponse:
    try:
        return await fetch_and_normalize_work_item(body.input)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except TestItConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except TestItAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except TestItNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except TestItConnectionError as exc:
        raise HTTPException(status_code=503, detail=f"TestIT unavailable: {exc}")
    except TestItResponseError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except TestItApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/testit/workitem/create-draft", response_model=CreateDraftResponse)
async def create_testit_draft(body: CreateDraftRequest) -> CreateDraftResponse:
    try:
        return await create_draft_in_testit(
            improved_testcase=body.improved_testcase,
            source_work_item_id=body.source_work_item_id,
            source_attributes=body.source_attributes,
        )
    except TestItConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except TestItAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except TestItConnectionError as exc:
        raise HTTPException(status_code=503, detail=f"TestIT unavailable: {exc}")
    except TestItResponseError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except TestItApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
