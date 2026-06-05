from app.schemas.runner import RunnerRunResponse, RunnerScreenshot, RunnerStartRequest


def test_runner_start_request_requires_work_item_id():
    req = RunnerStartRequest(work_item_id="6109")
    assert req.work_item_id == "6109"


def test_runner_run_response_defaults():
    r = RunnerRunResponse(
        status="passed",
        summary="All steps completed",
        steps_count=5,
        errors=[],
        screenshots=[],
        duration_sec=12.3,
        run_id="abc-123",
    )
    assert r.status == "passed"
    assert r.screenshots == []
