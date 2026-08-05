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


import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.runner_service import _build_task_prompt, _extract_url
from app.schemas.testcase import NormalizedTestCase, TestCaseStep


def _tc(**kwargs) -> NormalizedTestCase:
    defaults = dict(title="Login test", preconditions=[], steps=[], postconditions=[])
    return NormalizedTestCase(**{**defaults, **kwargs})


def test_build_prompt_includes_title():
    tc = _tc(title="Check login form")
    prompt = _build_task_prompt(tc)
    assert "Check login form" in prompt


def test_build_prompt_numbers_steps():
    tc = _tc(steps=[
        TestCaseStep(action="Open page", expected="Page loaded"),
        TestCaseStep(action="Click button", expected="Modal shown"),
    ])
    prompt = _build_task_prompt(tc)
    assert "1. Open page" in prompt
    assert "Expected result: Page loaded" in prompt
    assert "2. Click button" in prompt


def test_build_prompt_includes_preconditions():
    tc = _tc(preconditions=[TestCaseStep(action="User is logged in")])
    prompt = _build_task_prompt(tc)
    assert "User is logged in" in prompt


def test_build_prompt_skips_empty_expected():
    tc = _tc(steps=[TestCaseStep(action="Do something", expected=None)])
    prompt = _build_task_prompt(tc)
    assert "Expected result" not in prompt


def test_extract_url_from_preconditions():
    tc = _tc(preconditions=[TestCaseStep(action="Open https://example.com/login")])
    assert _extract_url(tc) == "https://example.com/login"


def test_extract_url_from_steps_if_no_precondition_url():
    tc = _tc(steps=[TestCaseStep(action="Navigate to https://app.example.com/dashboard")])
    assert _extract_url(tc) == "https://app.example.com/dashboard"


def test_extract_url_returns_none_when_no_url():
    tc = _tc(steps=[TestCaseStep(action="Click the button")])
    assert _extract_url(tc) is None


from app.services.runner_service import _cache_fields


def test_cache_fields_absent_without_tag():
    tc = _tc(tags=[], attributes={"modifiedDate": "2026-01-01"})
    assert _cache_fields(tc, False) == {"force_regenerate": False}


def test_cache_fields_present_with_tag_and_modified_date():
    tc = _tc(tags=["cache-ok"], attributes={"modifiedDate": "2026-01-01"})
    assert _cache_fields(tc, False) == {"force_regenerate": False, "cache_key": "2026-01-01"}


def test_cache_fields_absent_without_modified_date():
    tc = _tc(tags=["cache-ok"], attributes={})
    assert _cache_fields(tc, False) == {"force_regenerate": False}


def test_cache_fields_force_regenerate_passthrough():
    tc = _tc(tags=["cache-ok"], attributes={"modifiedDate": "2026-01-01"})
    assert _cache_fields(tc, True) == {"force_regenerate": True, "cache_key": "2026-01-01"}
