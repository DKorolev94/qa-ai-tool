from __future__ import annotations

import asyncio
import pathlib
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.integrations.testit_client import (
    TestItApiError,
    TestItAuthError,
    TestItConfigError,
    TestItConnectionError,
    TestItNotFoundError,
    TestItResponseError,
)
from app.core.review_config import ReviewConfig, get_review_config
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
    UpdateOriginalRequest,
    UpdateOriginalResponse,
)
from app.services.testcase_analyzer import analyze_raw_testcase
from app.services.testcase_improver import improve_testcase
from app.services.testit_draft_service import create_draft_in_testit
from app.services.testit_workitem_service import fetch_and_normalize_work_item
from app.services.testit_update_service import apply_to_original_in_testit
from app.schemas.runner import RunnerStartRequest, RunnerRunResponse
from app.services import runner_service
from app.core.config import settings
from pydantic import BaseModel

router = APIRouter()


class RawContentRequest(BaseModel):
    raw_content: str


class WorkItemRequest(BaseModel):
    work_item: dict


@router.get("/review-config", response_model=ReviewConfig)
async def review_config() -> ReviewConfig:
    return get_review_config()


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
        return await asyncio.to_thread(
            analyze_raw_testcase,
            raw_content=body.raw_content,
            work_item=body.work_item,
            source_type=body.source_type,
            enabled_rules=body.enabled_rules,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/improve-testcase", response_model=ImproveTestCaseResponse)
async def improve_testcase_endpoint(body: ImproveTestCaseRequest) -> ImproveTestCaseResponse:
    if body.work_item is None and body.raw_content is None:
        raise HTTPException(status_code=422, detail="Provide raw_content or work_item")
    try:
        return await asyncio.to_thread(
            improve_testcase,
            raw_content=body.raw_content,
            work_item=body.work_item,
            selected_issues=body.selected_issues,
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
            manual_notes=body.manual_notes,
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


@router.post("/testit/workitem/update-original", response_model=UpdateOriginalResponse)
async def update_testit_original(body: UpdateOriginalRequest) -> UpdateOriginalResponse:
    try:
        return await apply_to_original_in_testit(
            improved_testcase=body.improved_testcase,
            source_work_item_id=body.source_work_item_id,
            source_attributes=body.source_attributes,
        )
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


@router.post("/runner/run", response_model=RunnerRunResponse)
async def runner_run(body: RunnerStartRequest) -> RunnerRunResponse:
    try:
        return await runner_service.run_test_case(body)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Runner timeout — test took too long")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Runner error: {exc.response.text[:300]}")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail=f"Runner unavailable: {exc}")
    except (TestItNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except TestItConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/runner/screenshot")
async def runner_screenshot(path: str) -> FileResponse:
    runs_dir = settings.RUNNER_RUNS_DIR
    if not runs_dir:
        raise HTTPException(status_code=503, detail="Screenshot serving not configured (RUNNER_RUNS_DIR not set)")

    runs_root = pathlib.Path(runs_dir).resolve()
    target = pathlib.Path(path).resolve()

    if not str(target).startswith(str(runs_root)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not target.exists():
        raise HTTPException(status_code=404, detail="Screenshot not found")

    return FileResponse(str(target))
