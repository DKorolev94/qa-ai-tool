from __future__ import annotations

import asyncio
import logging
import pathlib
import httpx
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from urllib.parse import urlparse, urlunparse

logger = logging.getLogger(__name__)

from app.tms.testit.client import (
    TestItApiError,
    TestItAuthError,
    TestItConfigError,
    TestItConnectionError,
    TestItNotFoundError,
    TestItResponseError,
)
from app.core.errors_i18n import localize
from app.core.review_config import ReviewConfig, get_review_config
from app.tms.testit.link_parser import InvalidWorkItemInputError
from app.tms.testit.parser import parse_testit_content
from app.tms.testit.workitem_mapper import normalize_testit_workitem
from app.schemas.analysis import (
    AnalyzeTestCaseRequest,
    AnalyzeTestCaseResponse,
    ImproveTestCaseRequest,
    ImproveTestCaseResponse,
)
from app.schemas.testcase import NormalizedTestCase
from app.tms.testit.schemas import (
    CreateDraftRequest,
    CreateDraftResponse,
    FetchTestItWorkItemRequest,
    FetchTestItWorkItemResponse,
    UpdateOriginalRequest,
    UpdateOriginalResponse,
)
from app.services.testcase_analyzer import analyze_raw_testcase
from app.services.testcase_improver import improve_testcase
from app.tms.testit.draft_service import create_draft_in_testit
from app.tms.testit.workitem_service import fetch_and_normalize_work_item
from app.tms.testit.update_service import apply_to_original_in_testit
from app.schemas.runner import RunnerManualStartRequest, RunnerRunResponse, RunnerStartRequest, WriteTestItResultRequest
from app.services import runner_service
from app.schemas.bulk_review import BulkReviewJobStatus, BulkReviewRequest
from app.services import bulk_review_service
from app.core.config import settings
from pydantic import BaseModel

router = APIRouter()


class RawContentRequest(BaseModel):
    raw_content: str


class WorkItemRequest(BaseModel):
    work_item: dict


@router.get("/review-config", response_model=ReviewConfig)
async def review_config(language: str = "ru") -> ReviewConfig:
    return get_review_config(language)


@router.post("/clean-testcase", response_model=NormalizedTestCase)
async def clean_testcase(body: RawContentRequest) -> NormalizedTestCase:
    return parse_testit_content(body.raw_content)


@router.post("/normalize-testit-workitem", response_model=NormalizedTestCase)
async def normalize_workitem(body: WorkItemRequest) -> NormalizedTestCase:
    return normalize_testit_workitem(body.work_item)


@router.post("/analyze-testcase", response_model=AnalyzeTestCaseResponse)
async def analyze_testcase(body: AnalyzeTestCaseRequest) -> AnalyzeTestCaseResponse:
    if body.work_item is None and body.raw_content is None:
        raise HTTPException(status_code=422, detail=localize("missing_input", body.language))
    try:
        return await asyncio.to_thread(
            analyze_raw_testcase,
            raw_content=body.raw_content,
            work_item=body.work_item,
            enabled_rules=body.enabled_rules,
            language=body.language,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/improve-testcase", response_model=ImproveTestCaseResponse)
async def improve_testcase_endpoint(body: ImproveTestCaseRequest) -> ImproveTestCaseResponse:
    if body.work_item is None and body.raw_content is None:
        raise HTTPException(status_code=422, detail=localize("missing_input", body.language))
    try:
        return await asyncio.to_thread(
            improve_testcase,
            raw_content=body.raw_content,
            work_item=body.work_item,
            selected_issues=body.selected_issues,
            language=body.language,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=localize("llm_improve_unavailable", body.language, detail=str(exc)))


@router.post("/testit/workitem/fetch", response_model=FetchTestItWorkItemResponse)
async def fetch_testit_workitem(body: FetchTestItWorkItemRequest) -> FetchTestItWorkItemResponse:
    try:
        return await fetch_and_normalize_work_item(body.input)
    except InvalidWorkItemInputError as exc:
        raise HTTPException(status_code=400, detail=localize(exc.code, body.language, **exc.params))
    except TestItConfigError as exc:
        raise HTTPException(status_code=503, detail=localize(exc.code, body.language, **exc.params) if exc.code else str(exc))
    except TestItAuthError as exc:
        raise HTTPException(status_code=401, detail=localize(exc.code, body.language, **exc.params) if exc.code else str(exc))
    except TestItNotFoundError as exc:
        raise HTTPException(status_code=404, detail=localize(exc.code, body.language, **exc.params) if exc.code else str(exc))
    except TestItConnectionError as exc:
        raise HTTPException(status_code=503, detail=localize(exc.code, body.language, **exc.params) if exc.code else f"TestIT unavailable: {exc}")
    except TestItResponseError as exc:
        raise HTTPException(status_code=502, detail=localize(exc.code, body.language, **exc.params) if exc.code else str(exc))
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
        raise HTTPException(status_code=503, detail=localize(exc.code, body.language, **exc.params) if exc.code else str(exc))
    except TestItAuthError as exc:
        raise HTTPException(status_code=401, detail=localize(exc.code, body.language, **exc.params) if exc.code else str(exc))
    except TestItConnectionError as exc:
        raise HTTPException(status_code=503, detail=localize(exc.code, body.language, **exc.params) if exc.code else f"TestIT unavailable: {exc}")
    except TestItResponseError as exc:
        raise HTTPException(status_code=502, detail=localize(exc.code, body.language, **exc.params) if exc.code else str(exc))
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
        raise HTTPException(status_code=503, detail=localize(exc.code, body.language, **exc.params) if exc.code else str(exc))
    except TestItAuthError as exc:
        raise HTTPException(status_code=401, detail=localize(exc.code, body.language, **exc.params) if exc.code else str(exc))
    except TestItNotFoundError as exc:
        raise HTTPException(status_code=404, detail=localize(exc.code, body.language, **exc.params) if exc.code else str(exc))
    except TestItConnectionError as exc:
        raise HTTPException(status_code=503, detail=localize(exc.code, body.language, **exc.params) if exc.code else f"TestIT unavailable: {exc}")
    except TestItResponseError as exc:
        raise HTTPException(status_code=502, detail=localize(exc.code, body.language, **exc.params) if exc.code else str(exc))
    except TestItApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/bulk-review", response_model=list[BulkReviewJobStatus])
async def bulk_review_list() -> list[BulkReviewJobStatus]:
    return bulk_review_service.list_jobs()


@router.post("/bulk-review/start")
async def bulk_review_start(body: BulkReviewRequest) -> dict:
    # Draft creation needs this for every item that has issues — fail the whole
    # batch upfront rather than burning an LLM analyze+improve call per item
    # only to hit the same config error at the last step for each of them.
    if not settings.TESTIT_PROJECT_UUID:
        raise HTTPException(
            status_code=503,
            detail=localize("testit_project_uuid_missing", body.language),
        )
    job_id = bulk_review_service.start_bulk_review(body.work_item_ids, body.enabled_rules, body.language)
    return {"job_id": job_id}


@router.get("/bulk-review/{job_id}", response_model=BulkReviewJobStatus)
async def bulk_review_status(job_id: str) -> BulkReviewJobStatus:
    job = bulk_review_service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Bulk review job not found")
    return job


@router.post("/bulk-review/{job_id}/stop")
async def bulk_review_stop(job_id: str) -> dict:
    if bulk_review_service.get_job(job_id) is None:
        raise HTTPException(status_code=404, detail="Bulk review job not found")
    stopped = bulk_review_service.stop_bulk_review(job_id)
    return {"stopped": stopped}


@router.post("/bulk-review/{job_id}/retry/{index}")
async def bulk_review_retry(job_id: str, index: int) -> dict:
    job = bulk_review_service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Bulk review job not found")
    if not settings.TESTIT_PROJECT_UUID:
        raise HTTPException(
            status_code=503,
            detail=localize("testit_project_uuid_missing", job.language),
        )
    retried = bulk_review_service.retry_item(job_id, index)
    if not retried:
        raise HTTPException(status_code=409, detail="Item is not in a retryable state")
    return {"retried": True}


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


@router.post("/runner/run-manual", response_model=RunnerRunResponse)
async def runner_run_manual(body: RunnerManualStartRequest) -> RunnerRunResponse:
    try:
        return await runner_service.run_manual(body)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Runner timeout — test took too long")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Runner error: {exc.response.text[:300]}")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail=f"Runner unavailable: {exc}")


@router.post("/runner/start-manual")
async def runner_start_manual(body: RunnerManualStartRequest) -> dict:
    try:
        return await runner_service.start_manual_streaming(body)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Runner timeout — could not start test")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail=f"Runner unavailable: {exc}")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Runner error: {exc.response.text[:300]}")


@router.post("/runner/start-testit")
async def runner_start_testit(body: RunnerStartRequest) -> dict:
    try:
        return await runner_service.start_testit_streaming(body.work_item_id, body.iteration_index, body.language)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Runner timeout — could not start test")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail=f"Runner unavailable: {exc}")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Runner error: {exc.response.text[:300]}")
    except (TestItNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except TestItConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc))



@router.get("/runner/sessions")
async def runner_list_sessions() -> dict:
    try:
        return await runner_service.list_sessions()
    except httpx.TimeoutException:
        return {"sessions": []}
    except httpx.RequestError:
        return {"sessions": []}
    except Exception:
        return {"sessions": []}


@router.get("/runner/sessions/{run_id}/steps")
async def runner_get_session_steps(run_id: str) -> dict:
    try:
        return await runner_service.get_session_steps(run_id)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Runner timeout — could not fetch steps")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text[:300])
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail=f"Runner unavailable: {exc}")


@router.get("/runner/sessions/{run_id}/logs")
async def runner_get_session_logs(run_id: str) -> dict:
    try:
        return await runner_service.get_session_logs(run_id)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Runner timeout — could not fetch logs")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text[:300])
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail=f"Runner unavailable: {exc}")


@router.post("/runner/sessions/{run_id}/stop")
async def runner_stop_session(run_id: str) -> dict:
    try:
        return await runner_service.stop_session(run_id)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Runner timeout — could not stop session")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text[:300])
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail=f"Runner unavailable: {exc}")




@router.websocket("/runner/ws/{run_id}")
async def runner_ws_proxy(websocket: WebSocket, run_id: str) -> None:
    await websocket.accept()
    _parsed = urlparse(settings.RUNNER_URL)
    _ws_scheme = 'wss' if _parsed.scheme == 'https' else 'ws'
    runner_ws_url = urlunparse(_parsed._replace(scheme=_ws_scheme)) + f'/ws/{run_id}'
    try:
        from websockets.asyncio.client import connect as ws_connect
        async with ws_connect(runner_ws_url, max_size=None) as runner_ws:
            try:
                async for message in runner_ws:
                    msg = message if isinstance(message, str) else message.decode()
                    await websocket.send_text(msg)
            except WebSocketDisconnect:
                pass
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("Runner WS proxy error (run_id=%s) [%s]: %s", run_id, type(exc).__name__, exc)
        try:
            await websocket.send_json({'type': 'error', 'message': str(exc)})
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass


def _resolve_video_path(run_id: str) -> tuple[pathlib.Path, str]:
    import re
    if not re.fullmatch(r'[A-Za-z0-9_-]+', run_id):
        raise HTTPException(status_code=400, detail="Invalid run_id")
    runs_dir = settings.RUNNER_RUNS_DIR
    if not runs_dir:
        raise HTTPException(status_code=503, detail="Video serving not configured (RUNNER_RUNS_DIR not set)")
    for ext, mime in [('mp4', 'video/mp4'), ('webm', 'video/webm')]:
        video_path = pathlib.Path(runs_dir) / run_id / 'media' / f'recording.{ext}'
        if video_path.exists():
            return video_path, mime
    raise HTTPException(status_code=404, detail="No video recording for this run")


@router.get("/runner/sessions/{run_id}/video")
async def get_session_video(run_id: str) -> FileResponse:
    video_path, mime = _resolve_video_path(run_id)
    ext = video_path.suffix.lstrip('.')
    return FileResponse(str(video_path), media_type=mime, filename=f'{run_id}.{ext}')


@router.head("/runner/sessions/{run_id}/video")
async def head_session_video(run_id: str):
    _resolve_video_path(run_id)  # raises 404 if not found; returns (path, mime) but unused here


@router.get("/runner/screenshot")
async def runner_screenshot(path: str) -> FileResponse:
    runs_dir = settings.RUNNER_RUNS_DIR
    if not runs_dir:
        raise HTTPException(status_code=503, detail="Screenshot serving not configured (RUNNER_RUNS_DIR not set)")

    runs_root = pathlib.Path(runs_dir).resolve()
    target = pathlib.Path(path).resolve()

    if not str(target).startswith(str(runs_root)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Screenshot not found")

    return FileResponse(str(target))



@router.post("/runner/write-testit-result")
async def write_testit_result(body: WriteTestItResultRequest) -> dict:
    from app.tms.testit.run_service import write_run_result
    try:
        return await write_run_result(
            work_item_id=body.work_item_id,
            status=body.status,
            summary=body.summary,
            run_id=body.run_id,
            duration_sec=body.duration_sec,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
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


