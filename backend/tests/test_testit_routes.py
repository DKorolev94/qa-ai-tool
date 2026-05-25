from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.integrations.testit_client import (
    TestItAuthError,
    TestItConfigError,
    TestItConnectionError,
    TestItNotFoundError,
)
from app.schemas.testit import FetchTestItWorkItemResponse

client = TestClient(app)

SAMPLE_RESPONSE = FetchTestItWorkItemResponse(
    work_item_id="6109",
    raw_work_item={"name": "Login test", "steps": []},
    normalized_testcase={"title": "Login test", "steps": []},
    warnings=[],
)


def test_fetch_returns_200():
    with patch(
        "app.api.routes.fetch_and_normalize_work_item",
        new=AsyncMock(return_value=SAMPLE_RESPONSE),
    ):
        resp = client.post("/api/testit/workitem/fetch", json={"input": "6109"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["work_item_id"] == "6109"
    assert "normalized_testcase" in data
    assert "raw_work_item" in data


def test_fetch_invalid_input_returns_400():
    with patch(
        "app.api.routes.fetch_and_normalize_work_item",
        new=AsyncMock(side_effect=ValueError("Could not extract TestIT work item id")),
    ):
        resp = client.post("/api/testit/workitem/fetch", json={"input": "???garbage???"})
    assert resp.status_code == 400
    assert "detail" in resp.json()


def test_fetch_config_missing_returns_503():
    with patch(
        "app.api.routes.fetch_and_normalize_work_item",
        new=AsyncMock(side_effect=TestItConfigError("TESTIT_BASE_URL is not configured")),
    ):
        resp = client.post("/api/testit/workitem/fetch", json={"input": "6109"})
    assert resp.status_code == 503


def test_fetch_auth_error_returns_401():
    with patch(
        "app.api.routes.fetch_and_normalize_work_item",
        new=AsyncMock(side_effect=TestItAuthError("authorization failed")),
    ):
        resp = client.post("/api/testit/workitem/fetch", json={"input": "6109"})
    assert resp.status_code == 401


def test_fetch_not_found_returns_404():
    with patch(
        "app.api.routes.fetch_and_normalize_work_item",
        new=AsyncMock(side_effect=TestItNotFoundError("not found: 6109")),
    ):
        resp = client.post("/api/testit/workitem/fetch", json={"input": "6109"})
    assert resp.status_code == 404


def test_fetch_connection_error_returns_503():
    with patch(
        "app.api.routes.fetch_and_normalize_work_item",
        new=AsyncMock(side_effect=TestItConnectionError("timed out")),
    ):
        resp = client.post("/api/testit/workitem/fetch", json={"input": "6109"})
    assert resp.status_code == 503


def test_fetch_missing_input_field_returns_422():
    resp = client.post("/api/testit/workitem/fetch", json={})
    assert resp.status_code == 422
