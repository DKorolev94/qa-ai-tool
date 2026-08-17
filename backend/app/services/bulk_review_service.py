from __future__ import annotations

import asyncio
import logging
import uuid

from app.core.errors_i18n import localize as _localize_error
from app.core.service_i18n import localize as _localize_service
from app.schemas.analysis import ReviewRuleId
from app.schemas.bulk_review import BulkReviewItemResult, BulkReviewJobStatus
from app.services.testcase_analyzer import analyze_raw_testcase
from app.services.testcase_improver import improve_testcase
from app.tms.testit.draft_service import create_draft_in_testit
from app.tms.testit.workitem_service import fetch_and_normalize_work_item

logger = logging.getLogger(__name__)

# In-memory job store — fine for a single-process internal tool; a restart
# drops in-flight/completed jobs, same tradeoff as the browser-use-runner's
# own run registry. Bounded so a long-lived process doesn't accumulate every
# batch ever run — oldest finished jobs are evicted first.
_JOBS: dict[str, BulkReviewJobStatus] = {}
_MAX_STORED_JOBS = 50

# start_bulk_review() has no "one batch at a time" gate of its own — _RUN_LOCK
# only serializes actual processing, so repeated/duplicate start calls (double
# submit, retried request) would otherwise queue an unbounded number of
# non-done jobs, each held forever since _prune_old_jobs() only evicts
# done=True ones. This caps how many can be queued/running at once, with
# headroom above the intended "next batch queues behind the current one" flow.
_MAX_NON_DONE_JOBS = 5

# Live task handles, so a forgotten/abandoned batch (browser tab closed
# without stopping it) can still be found and cancelled via list_jobs() +
# stop_bulk_review() — not just the one job_id the current page happens to
# hold in React state.
_TASKS: dict[str, asyncio.Task] = {}

# Only one batch (or retry) actually processes items at a time, backend-wide.
# Starting a second batch while one is running just queues it — items stay
# "pending" until the lock frees up. This is what keeps two concurrent
# batches from doubling up on LLM rate limits and from both touching the
# same work_item_id at once (which would otherwise create two TestIT
# drafts for the same source case). Cancelling a task that's still waiting
# on this lock works fine — asyncio.Lock.acquire() is cancellation-aware.
_RUN_LOCK = asyncio.Lock()


def get_job(job_id: str) -> BulkReviewJobStatus | None:
    return _JOBS.get(job_id)


def list_jobs() -> list[BulkReviewJobStatus]:
    # Newest first — dict preserves insertion order, jobs are only ever appended.
    return list(reversed(_JOBS.values()))


def stop_bulk_review(job_id: str) -> bool:
    task = _TASKS.get(job_id)
    if task is None or task.done():
        return False
    task.cancel()
    return True


def _prune_old_jobs() -> None:
    # Only evicts done=True jobs — evicting one still in flight would delete
    # _JOBS[job_id] out from under its own running task, which indexes into
    # it on every _update_item call. Non-done jobs are bounded separately by
    # _MAX_NON_DONE_JOBS in start_bulk_review(), not by this function.
    if len(_JOBS) <= _MAX_STORED_JOBS:
        return
    for old_id in list(_JOBS.keys()):
        if len(_JOBS) <= _MAX_STORED_JOBS:
            break
        if _JOBS[old_id].done:
            del _JOBS[old_id]
            _TASKS.pop(old_id, None)


def start_bulk_review(
    work_item_ids: list[str],
    enabled_rules: list[ReviewRuleId] | None,
    language: str,
) -> str:
    _prune_old_jobs()
    if sum(1 for job in _JOBS.values() if not job.done) >= _MAX_NON_DONE_JOBS:
        raise RuntimeError("Too many bulk review batches already queued or running")
    job_id = uuid.uuid4().hex
    items = [BulkReviewItemResult(work_item_id=wid) for wid in work_item_ids]
    _JOBS[job_id] = BulkReviewJobStatus(job_id=job_id, items=items, enabled_rules=enabled_rules, language=language)
    _TASKS[job_id] = asyncio.create_task(_run_job(job_id, work_item_ids, enabled_rules, language))
    return job_id


def retry_item(job_id: str, index: int) -> bool:
    job = _JOBS.get(job_id)
    if job is None or not (0 <= index < len(job.items)):
        return False
    if not job.done:
        # The batch's own task is still running on other items — retrying
        # here would race with it over _TASKS[job_id] and job.done.
        return False
    item = job.items[index]
    if item.status not in ("error", "cancelled"):
        return False

    work_item_id = item.work_item_id
    item.status = "pending"
    item.error = None
    item.issues_count = 0
    item.draft_work_item_id = None
    item.testit_url = None
    item.needs_manual_review = False
    item.manual_notes = []
    job.done = False
    _TASKS[job_id] = asyncio.create_task(
        _run_retry(job_id, index, work_item_id, job.enabled_rules, job.language)
    )
    return True


def _update_item(job_id: str, index: int, **fields: object) -> None:
    # Indexed, not matched by work_item_id — the same id can legitimately
    # appear more than once in a batch, and a value-based lookup would always
    # hit the first match, leaving every later duplicate stuck on "pending".
    item = _JOBS[job_id].items[index]
    for key, value in fields.items():
        setattr(item, key, value)


async def _process_one(
    job_id: str,
    index: int,
    work_item_id: str,
    enabled_rules: list[ReviewRuleId] | None,
    language: str,
) -> None:
    """Runs review -> improve -> create-draft for a single item, updating its
    status/result in place. Shared by the batch loop and by single-item retry."""
    try:
        _update_item(job_id, index, status="reviewing")
        fetch_result = await fetch_and_normalize_work_item(work_item_id)

        analyze_result = await asyncio.to_thread(
            analyze_raw_testcase,
            raw_content=None,
            work_item=fetch_result.raw_work_item,
            enabled_rules=enabled_rules,
            language=language,
        )
        _update_item(job_id, index, issues_count=len(analyze_result.issues))

        if not analyze_result.issues:
            _update_item(job_id, index, status="done")
            return

        _update_item(job_id, index, status="improving")
        selected_issues = [issue.model_dump() for issue in analyze_result.issues]
        try:
            improve_result = await asyncio.to_thread(
                improve_testcase,
                raw_content=None,
                work_item=fetch_result.raw_work_item,
                selected_issues=selected_issues,
                language=language,
            )
        except RuntimeError as exc:
            # Raised by the LLM client when the endpoint is unreachable/
            # misconfigured — scoped to just this call, same as the
            # single-item endpoint, so a RuntimeError from create_draft_in_testit
            # further down (an unrelated TestIT failure) isn't mislabeled as this.
            logger.exception("Bulk review improve failed for work_item_id=%s", work_item_id)
            message = _localize_error("llm_improve_unavailable", language, detail=str(exc))
            _update_item(job_id, index, status="error", error=message)
            return

        _update_item(job_id, index, status="creating_draft")
        draft_result = await create_draft_in_testit(
            improved_testcase=improve_result.improved_testcase.model_dump(),
            source_work_item_id=work_item_id,
            source_attributes=fetch_result.raw_work_item.get("attributes") or {},
            manual_notes=improve_result.manual_notes,
        )
        _update_item(
            job_id, index,
            status="done",
            draft_work_item_id=draft_result.work_item_id,
            testit_url=draft_result.testit_url,
            needs_manual_review=improve_result.improved_testcase.status == "NeedsWork",
            manual_notes=improve_result.manual_notes,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.exception("Bulk review failed for work_item_id=%s", work_item_id)
        code = getattr(exc, "code", None)
        if code:
            message = _localize_error(code, language, **getattr(exc, "params", {}))
        else:
            message = str(exc)
        _update_item(job_id, index, status="error", error=message)


async def _run_job(
    job_id: str,
    work_item_ids: list[str],
    enabled_rules: list[ReviewRuleId] | None,
    language: str,
) -> None:
    # Sequential on purpose — each item makes 1-2 LLM calls + several TestIT
    # API calls; running them concurrently would multiply LLM rate-limit and
    # TestIT load unpredictably for a batch of unknown size.
    try:
        async with _RUN_LOCK:
            for index, work_item_id in enumerate(work_item_ids):
                await _process_one(job_id, index, work_item_id, enabled_rules, language)
    except asyncio.CancelledError:
        logger.info("Bulk review job %s stopped by user", job_id)
    finally:
        # Covers the in-flight item at the moment of cancellation plus every
        # item the loop never reached — both are still in a non-terminal
        # status here, since only "done"/"error" get set inside the loop.
        cancelled_message = _localize_service("cancelled_by_user", language)
        for item in _JOBS[job_id].items:
            if item.status not in ("done", "error"):
                item.status = "cancelled"
                item.error = cancelled_message
        _JOBS[job_id].done = True
        _TASKS.pop(job_id, None)


async def _run_retry(
    job_id: str,
    index: int,
    work_item_id: str,
    enabled_rules: list[ReviewRuleId] | None,
    language: str,
) -> None:
    try:
        async with _RUN_LOCK:
            await _process_one(job_id, index, work_item_id, enabled_rules, language)
    except asyncio.CancelledError:
        item = _JOBS[job_id].items[index]
        if item.status not in ("done", "error"):
            item.status = "cancelled"
            item.error = _localize_service("cancelled_by_user", language)
    finally:
        # retry_item() only starts once every other item is already terminal,
        # so this one finishing (whatever the outcome) means the whole job is
        # terminal again.
        _JOBS[job_id].done = True
        _TASKS.pop(job_id, None)
