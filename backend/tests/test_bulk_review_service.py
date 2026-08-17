import asyncio
from unittest.mock import AsyncMock, patch

from app.schemas.analysis import AnalysisIssue, AnalyzeTestCaseResponse, AnalyzedTestCase, ImproveTestCaseResponse
from app.schemas.bulk_review import BulkReviewItemResult, BulkReviewJobStatus
from app.services import bulk_review_service
from app.tms.testit.schemas import CreateDraftResponse, FetchTestItWorkItemResponse


def run(coro):
    return asyncio.run(coro)


def _seed_job(job_id: str, work_item_ids: list[str]) -> None:
    # Mirrors start_bulk_review's job-init step without scheduling via
    # asyncio.create_task, which requires a running loop start_bulk_review
    # normally gets from the FastAPI route handler, not from a sync test.
    bulk_review_service._JOBS[job_id] = BulkReviewJobStatus(
        job_id=job_id,
        items=[BulkReviewItemResult(work_item_id=wid) for wid in work_item_ids],
    )


def _fetch_response(work_item_id: str) -> FetchTestItWorkItemResponse:
    return FetchTestItWorkItemResponse(
        work_item_id=work_item_id,
        raw_work_item={"id": work_item_id, "attributes": {"foo": "bar"}},
        normalized_testcase={"title": "T"},
    )


def _analyze_response(has_issue: bool) -> AnalyzeTestCaseResponse:
    issues = [
        AnalysisIssue(rule="title", severity="low", title="Title", description="d", recommendation="r"),
    ] if has_issue else []
    return AnalyzeTestCaseResponse(summary="s", issues=issues, original_normalized_testcase={}, warnings=[])


def _improve_response(status: str = "Ready", manual_notes: list[str] | None = None) -> ImproveTestCaseResponse:
    return ImproveTestCaseResponse(
        improved_testcase=AnalyzedTestCase(title="Fixed title", status=status),
        original_normalized_testcase={},
        issue_resolutions=[],
        improvement_notes=[],
        manual_notes=manual_notes or [],
        warnings=[],
        validation_warnings=[],
        diff={},
        display_duration=None,
    )


def setup_function():
    bulk_review_service._JOBS.clear()


def test_run_job_creates_draft_when_issues_found():
    with patch.object(bulk_review_service, "fetch_and_normalize_work_item", AsyncMock(return_value=_fetch_response("101"))), \
         patch.object(bulk_review_service, "analyze_raw_testcase", return_value=_analyze_response(True)), \
         patch.object(bulk_review_service, "improve_testcase", return_value=_improve_response()), \
         patch.object(
             bulk_review_service, "create_draft_in_testit",
             AsyncMock(return_value=CreateDraftResponse(work_item_id="new-1", title="Fixed title", testit_url="https://x/1")),
         ) as mock_create_draft:
        job_id = "job-1"
        _seed_job(job_id, ["101"])
        run(bulk_review_service._run_job(job_id, ["101"], None, "ru"))

    job = bulk_review_service.get_job(job_id)
    assert job.done is True
    item = job.items[0]
    assert item.status == "done"
    assert item.issues_count == 1
    assert item.draft_work_item_id == "new-1"
    assert item.testit_url == "https://x/1"
    assert item.needs_manual_review is False
    mock_create_draft.assert_awaited_once()


def test_run_job_flags_needs_manual_review():
    with patch.object(bulk_review_service, "fetch_and_normalize_work_item", AsyncMock(return_value=_fetch_response("101"))), \
         patch.object(bulk_review_service, "analyze_raw_testcase", return_value=_analyze_response(True)), \
         patch.object(bulk_review_service, "improve_testcase", return_value=_improve_response(status="NeedsWork", manual_notes=["Clarify step 2"])), \
         patch.object(
             bulk_review_service, "create_draft_in_testit",
             AsyncMock(return_value=CreateDraftResponse(work_item_id="new-1", title="Fixed title", testit_url="https://x/1")),
         ):
        job_id = "job-needs-work"
        _seed_job(job_id, ["101"])
        run(bulk_review_service._run_job(job_id, ["101"], None, "ru"))

    item = bulk_review_service.get_job(job_id).items[0]
    assert item.needs_manual_review is True
    assert item.manual_notes == ["Clarify step 2"]


def test_run_job_skips_draft_when_no_issues():
    with patch.object(bulk_review_service, "fetch_and_normalize_work_item", AsyncMock(return_value=_fetch_response("202"))), \
         patch.object(bulk_review_service, "analyze_raw_testcase", return_value=_analyze_response(False)), \
         patch.object(bulk_review_service, "improve_testcase") as mock_improve, \
         patch.object(bulk_review_service, "create_draft_in_testit", AsyncMock()) as mock_create_draft:
        job_id = "job-2"
        _seed_job(job_id, ["202"])
        run(bulk_review_service._run_job(job_id, ["202"], None, "ru"))

    item = bulk_review_service.get_job(job_id).items[0]
    assert item.status == "done"
    assert item.issues_count == 0
    assert item.draft_work_item_id is None
    mock_improve.assert_not_called()
    mock_create_draft.assert_not_awaited()


def test_run_job_handles_duplicate_ids_independently():
    # A batch listing the same work_item_id twice must not collapse into a
    # single tracked item — each occurrence has its own row and must reach
    # "done" independently, not leave the second one stuck on "pending".
    with patch.object(bulk_review_service, "fetch_and_normalize_work_item", AsyncMock(return_value=_fetch_response("101"))), \
         patch.object(bulk_review_service, "analyze_raw_testcase", return_value=_analyze_response(False)):
        job_id = "job-dup"
        _seed_job(job_id, ["101", "101"])
        run(bulk_review_service._run_job(job_id, ["101", "101"], None, "ru"))

    job = bulk_review_service.get_job(job_id)
    assert job.done is True
    assert len(job.items) == 2
    assert all(item.status == "done" for item in job.items)


def test_run_job_marks_error_and_continues_to_next_item():
    def fetch_side_effect(work_item_id):
        if work_item_id == "bad":
            raise RuntimeError("not found")
        return _fetch_response(work_item_id)

    with patch.object(bulk_review_service, "fetch_and_normalize_work_item", AsyncMock(side_effect=fetch_side_effect)), \
         patch.object(bulk_review_service, "analyze_raw_testcase", return_value=_analyze_response(False)):
        job_id = "job-3"
        _seed_job(job_id, ["bad", "303"])
        run(bulk_review_service._run_job(job_id, ["bad", "303"], None, "ru"))

    job = bulk_review_service.get_job(job_id)
    assert job.done is True
    bad_item, ok_item = job.items
    assert bad_item.status == "error"
    assert "not found" in bad_item.error
    assert ok_item.status == "done"


def test_retry_item_reruns_just_that_item_and_succeeds():
    async def scenario():
        _seed_job("job-retry", ["bad", "202"])
        job = bulk_review_service.get_job("job-retry")
        job.items[0].status = "error"
        job.items[0].error = "boom"
        job.items[1].status = "done"
        job.done = True

        with patch.object(bulk_review_service, "fetch_and_normalize_work_item", AsyncMock(return_value=_fetch_response("bad"))), \
             patch.object(bulk_review_service, "analyze_raw_testcase", return_value=_analyze_response(False)):
            assert bulk_review_service.retry_item("job-retry", 0) is True
            # job flips back to "in progress" for the duration of the retry
            assert bulk_review_service.get_job("job-retry").done is False
            await asyncio.sleep(0.05)

        job = bulk_review_service.get_job("job-retry")
        assert job.done is True
        assert job.items[0].status == "done"
        assert job.items[0].error is None
        assert job.items[1].status == "done"  # untouched by the retry

    run(scenario())


def test_retry_item_rejects_when_job_still_running():
    _seed_job("job-running", ["101"])
    job = bulk_review_service.get_job("job-running")
    job.items[0].status = "error"
    job.done = False  # the batch's own task is still active on other items

    assert bulk_review_service.retry_item("job-running", 0) is False


def test_retry_item_rejects_when_item_not_failed():
    _seed_job("job-ok", ["101"])
    job = bulk_review_service.get_job("job-ok")
    job.items[0].status = "done"
    job.done = True

    assert bulk_review_service.retry_item("job-ok", 0) is False


def test_retry_item_rejects_unknown_job_or_index():
    assert bulk_review_service.retry_item("does-not-exist", 0) is False
    _seed_job("job-idx", ["101"])
    bulk_review_service._JOBS["job-idx"].done = True
    assert bulk_review_service.retry_item("job-idx", 5) is False


def test_start_bulk_review_schedules_job_and_returns_id():
    async def scenario():
        with patch.object(bulk_review_service, "fetch_and_normalize_work_item", AsyncMock(return_value=_fetch_response("404"))), \
             patch.object(bulk_review_service, "analyze_raw_testcase", return_value=_analyze_response(False)):
            job_id = bulk_review_service.start_bulk_review(["404"], None, "ru")
            job = bulk_review_service.get_job(job_id)
            assert job is not None
            assert job.items[0].work_item_id == "404"
            # Let the scheduled background task run to completion before the
            # patched functions above go out of scope.
            await asyncio.sleep(0.05)
            assert bulk_review_service.get_job(job_id).done is True

    run(scenario())


def test_second_batch_queues_behind_a_running_one():
    async def scenario():
        release_first = asyncio.Event()

        async def fetch_side_effect(work_item_id):
            if work_item_id == "A":
                await release_first.wait()
            return _fetch_response(work_item_id)

        with patch.object(bulk_review_service, "fetch_and_normalize_work_item", AsyncMock(side_effect=fetch_side_effect)), \
             patch.object(bulk_review_service, "analyze_raw_testcase", return_value=_analyze_response(False)):
            job_a = bulk_review_service.start_bulk_review(["A"], None, "ru")
            await asyncio.sleep(0.05)  # job A now holds the lock, blocked inside fetch

            job_b = bulk_review_service.start_bulk_review(["B"], None, "ru")
            await asyncio.sleep(0.05)  # job B's task is queued behind the lock

            # B hasn't been able to start processing its item yet.
            assert bulk_review_service.get_job(job_b).items[0].status == "pending"
            assert bulk_review_service.get_job(job_b).done is False

            release_first.set()
            await asyncio.sleep(0.1)  # let A finish, then B run to completion

        assert bulk_review_service.get_job(job_a).done is True
        job_b_status = bulk_review_service.get_job(job_b)
        assert job_b_status.done is True
        assert job_b_status.items[0].status == "done"

    run(scenario())


def test_run_job_localizes_llm_unavailable_error():
    with patch.object(bulk_review_service, "fetch_and_normalize_work_item", AsyncMock(return_value=_fetch_response("101"))), \
         patch.object(bulk_review_service, "analyze_raw_testcase", return_value=_analyze_response(True)), \
         patch.object(bulk_review_service, "improve_testcase", side_effect=RuntimeError("LLM improve unavailable: connection refused")):
        job_id = "job-llm-down"
        _seed_job(job_id, ["101"])
        run(bulk_review_service._run_job(job_id, ["101"], None, "ru"))

    item = bulk_review_service.get_job(job_id).items[0]
    assert item.status == "error"
    assert item.error == "LLM недоступен для улучшения: LLM improve unavailable: connection refused"


def test_run_job_does_not_mislabel_draft_creation_runtime_error_as_llm_failure():
    # A RuntimeError from create_draft_in_testit (e.g. TestIT's create_section
    # returned no id) is unrelated to the LLM — must not get the
    # "llm_improve_unavailable" label just because it's also a RuntimeError.
    with patch.object(bulk_review_service, "fetch_and_normalize_work_item", AsyncMock(return_value=_fetch_response("101"))), \
         patch.object(bulk_review_service, "analyze_raw_testcase", return_value=_analyze_response(True)), \
         patch.object(bulk_review_service, "improve_testcase", return_value=_improve_response()), \
         patch.object(bulk_review_service, "create_draft_in_testit", AsyncMock(side_effect=RuntimeError("TestIT create_section returned no id"))):
        job_id = "job-draft-fail"
        _seed_job(job_id, ["101"])
        run(bulk_review_service._run_job(job_id, ["101"], None, "ru"))

    item = bulk_review_service.get_job(job_id).items[0]
    assert item.status == "error"
    assert "LLM" not in item.error
    assert item.error == "TestIT create_section returned no id"


def test_stop_bulk_review_cancels_running_job():
    async def scenario():
        async def slow_fetch(work_item_id):
            await asyncio.sleep(5)
            return _fetch_response(work_item_id)

        with patch.object(bulk_review_service, "fetch_and_normalize_work_item", AsyncMock(side_effect=slow_fetch)):
            job_id = bulk_review_service.start_bulk_review(["101", "202"], None, "ru")
            await asyncio.sleep(0.05)  # let the job start and reach the slow fetch
            assert bulk_review_service.stop_bulk_review(job_id) is True
            await asyncio.sleep(0.05)  # let the cancellation propagate and the finally-block run

            job = bulk_review_service.get_job(job_id)
            assert job.done is True
            assert all(item.status == "cancelled" for item in job.items)
            # Already finished — a second stop has nothing to cancel.
            assert bulk_review_service.stop_bulk_review(job_id) is False

    run(scenario())


def test_stop_bulk_review_unknown_job_returns_false():
    assert bulk_review_service.stop_bulk_review("does-not-exist") is False


def test_list_jobs_returns_newest_first():
    _seed_job("older", ["1"])
    _seed_job("newer", ["2"])

    ids = [job.job_id for job in bulk_review_service.list_jobs()]

    assert ids.index("newer") < ids.index("older")


def test_start_bulk_review_rejects_once_too_many_non_done_jobs_queued():
    # start_bulk_review() itself has no "one batch at a time" gate — only
    # _RUN_LOCK serializes actual processing — so without this cap, repeated
    # calls (double submit, retried request) would queue an unbounded number
    # of non-done jobs that _prune_old_jobs() never evicts (it only reaps
    # done=True ones).
    for i in range(bulk_review_service._MAX_NON_DONE_JOBS):
        _seed_job(f"queued-{i}", ["1"])

    try:
        bulk_review_service.start_bulk_review(["999"], None, "ru")
        assert False, "expected RuntimeError once the non-done cap is reached"
    except RuntimeError:
        pass

    # None of the already-queued jobs, nor a new one, got created past the cap.
    assert len(bulk_review_service._JOBS) == bulk_review_service._MAX_NON_DONE_JOBS


def test_start_bulk_review_allows_new_batch_once_a_slot_frees_up():
    for i in range(bulk_review_service._MAX_NON_DONE_JOBS - 1):
        _seed_job(f"queued-{i}", ["1"])

    async def scenario():
        with patch.object(bulk_review_service, "fetch_and_normalize_work_item", AsyncMock(return_value=_fetch_response("1"))), \
             patch.object(bulk_review_service, "analyze_raw_testcase", return_value=_analyze_response(False)):
            job_id = bulk_review_service.start_bulk_review(["1"], None, "ru")
            assert bulk_review_service.get_job(job_id) is not None
            await asyncio.sleep(0.05)  # let the scheduled task finish before patches go out of scope

    run(scenario())
