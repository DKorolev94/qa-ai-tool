from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.schemas.bulk_review import BulkReviewItemResult, BulkReviewJobStatus
from app.services import bulk_review_service

client = TestClient(app)


def test_bulk_review_start_rejects_when_project_uuid_missing():
    with patch.object(settings, "TESTIT_PROJECT_UUID", ""), \
         patch.object(bulk_review_service, "start_bulk_review") as mock_start:
        resp = client.post("/api/bulk-review/start", json={"work_item_ids": ["101"]})

    assert resp.status_code == 503
    mock_start.assert_not_called()


def test_bulk_review_start_returns_job_id_when_configured():
    with patch.object(settings, "TESTIT_PROJECT_UUID", "proj-uuid"), \
         patch.object(bulk_review_service, "start_bulk_review", return_value="job-abc") as mock_start:
        resp = client.post("/api/bulk-review/start", json={"work_item_ids": ["101", "102"]})

    assert resp.status_code == 200
    assert resp.json() == {"job_id": "job-abc"}
    mock_start.assert_called_once_with(["101", "102"], None, "ru")


def test_bulk_review_status_404_for_unknown_job():
    resp = client.get("/api/bulk-review/does-not-exist")
    assert resp.status_code == 404


def test_bulk_review_rejects_empty_id_list():
    resp = client.post("/api/bulk-review/start", json={"work_item_ids": []})
    assert resp.status_code == 422


def test_bulk_review_rejects_batch_over_max_size():
    resp = client.post("/api/bulk-review/start", json={"work_item_ids": [str(i) for i in range(201)]})
    assert resp.status_code == 422


def test_bulk_review_stop_404_for_unknown_job():
    resp = client.post("/api/bulk-review/does-not-exist/stop")
    assert resp.status_code == 404


def test_bulk_review_stop_returns_stopped_flag():
    with patch.object(bulk_review_service, "get_job", return_value=object()), \
         patch.object(bulk_review_service, "stop_bulk_review", return_value=True) as mock_stop:
        resp = client.post("/api/bulk-review/job-1/stop")

    assert resp.status_code == 200
    assert resp.json() == {"stopped": True}
    mock_stop.assert_called_once_with("job-1")


def test_bulk_review_list_returns_jobs():
    with patch.object(bulk_review_service, "list_jobs", return_value=[]) as mock_list:
        resp = client.get("/api/bulk-review")

    assert resp.status_code == 200
    assert resp.json() == []
    mock_list.assert_called_once()


def test_bulk_review_retry_404_for_unknown_job():
    resp = client.post("/api/bulk-review/does-not-exist/retry/0")
    assert resp.status_code == 404


def test_bulk_review_retry_rejects_when_project_uuid_missing():
    job = BulkReviewJobStatus(job_id="job-1", items=[BulkReviewItemResult(work_item_id="101", status="error")])
    with patch.object(settings, "TESTIT_PROJECT_UUID", ""), \
         patch.object(bulk_review_service, "get_job", return_value=job), \
         patch.object(bulk_review_service, "retry_item") as mock_retry:
        resp = client.post("/api/bulk-review/job-1/retry/0")

    assert resp.status_code == 503
    mock_retry.assert_not_called()


def test_bulk_review_retry_409_when_not_retryable():
    job = BulkReviewJobStatus(job_id="job-1", items=[BulkReviewItemResult(work_item_id="101", status="done")])
    with patch.object(settings, "TESTIT_PROJECT_UUID", "proj-uuid"), \
         patch.object(bulk_review_service, "get_job", return_value=job), \
         patch.object(bulk_review_service, "retry_item", return_value=False):
        resp = client.post("/api/bulk-review/job-1/retry/0")

    assert resp.status_code == 409


def test_bulk_review_retry_returns_ok():
    job = BulkReviewJobStatus(job_id="job-1", items=[BulkReviewItemResult(work_item_id="101", status="error")])
    with patch.object(settings, "TESTIT_PROJECT_UUID", "proj-uuid"), \
         patch.object(bulk_review_service, "get_job", return_value=job), \
         patch.object(bulk_review_service, "retry_item", return_value=True) as mock_retry:
        resp = client.post("/api/bulk-review/job-1/retry/0")

    assert resp.status_code == 200
    assert resp.json() == {"retried": True}
    mock_retry.assert_called_once_with("job-1", 0)
