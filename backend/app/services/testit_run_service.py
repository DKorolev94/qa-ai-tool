from __future__ import annotations
import logging
import httpx
from app.integrations.testit_client import (
    TestItClient,
    TestItConfigError,
    TestItConnectionError,
    TestItAuthError,
    TestItResponseError,
    TestItApiError,
)
from app.core.config import settings

logger = logging.getLogger(__name__)

STATUS_MAP = {
    'passed': 'Passed',
    'failed': 'Failed',
    'blocked': 'Blocked',
}


async def write_run_result(
    work_item_id: str,
    status: str,
    summary: str,
    run_id: str | None,
    duration_sec: float,
) -> dict:
    try:
        client = TestItClient()
    except TestItConfigError as e:
        raise ValueError(str(e)) from e

    client._check_config()

    outcome = STATUS_MAP.get(status, 'Blocked')
    project_id = settings.TESTIT_PROJECT_UUID

    base_url = client._base_url
    headers = {**client._headers(), 'Content-Type': 'application/json'}
    verify = client._verify_ssl
    timeout = float(client._timeout)

    async with httpx.AsyncClient(verify=verify, timeout=timeout) as http:
        # Create a test run
        run_name = f"AI Test Runner — #{work_item_id}"
        run_payload = {
            "projectId": project_id,
            "name": run_name,
            "launchSource": "Api",
            "attachments": [],
            "links": [],
            "parameters": {},
            "customParameters": {},
            "description": summary,
        }
        try:
            resp = await http.post(f"{base_url}/api/v2/testRuns", headers=headers, json=run_payload)
        except httpx.TimeoutException:
            raise TestItConnectionError("Connection to TestIT timed out")
        except httpx.RequestError as exc:
            raise TestItConnectionError(f"Could not connect to TestIT: {type(exc).__name__}")

        if resp.status_code in (401, 403):
            raise TestItAuthError("TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.")
        try:
            run_data = resp.json()
        except Exception:
            raise TestItResponseError(f"TestIT returned non-JSON response (HTTP {resp.status_code})")
        if not resp.is_success:
            msg = run_data.get("message") or run_data.get("detail") or "TestIT API error"
            raise TestItApiError(str(msg), status_code=resp.status_code)

        run_id_testit = run_data.get("id")
        if not run_id_testit:
            raise TestItResponseError(f"TestIT create test run returned no id: {run_data}")
        logger.info("Created TestIT test run id=%s for work_item=%s", run_id_testit, work_item_id)

        # Add test result
        result_payload = [{
            "testRunId": run_id_testit,
            "configurationId": None,
            "autoTestExternalId": None,
            "links": [],
            "parameters": {},
            "properties": {},
            "workItemVersionId": None,
            "outcome": outcome,
            "comment": summary,
            "startedOn": None,
            "completedOn": None,
            "duration": int(duration_sec * 1000),
            "traces": "",
            "attachments": [],
            "workItemId": work_item_id,
        }]

        try:
            resp = await http.post(
                f"{base_url}/api/v2/testRuns/{run_id_testit}/testResults",
                headers=headers,
                json=result_payload,
            )
        except httpx.TimeoutException:
            raise TestItConnectionError("Connection to TestIT timed out")
        except httpx.RequestError as exc:
            raise TestItConnectionError(f"Could not connect to TestIT: {type(exc).__name__}")

        if not resp.is_success:
            try:
                err_data = resp.json()
            except Exception:
                err_data = {}
            msg = err_data.get("message") or err_data.get("detail") or f"HTTP {resp.status_code}"
            raise TestItApiError(str(msg), status_code=resp.status_code)

        # Complete the run
        try:
            resp = await http.post(
                f"{base_url}/api/v2/testRuns/{run_id_testit}/complete",
                headers=headers,
                json={},
            )
        except httpx.TimeoutException:
            raise TestItConnectionError("Connection to TestIT timed out")
        except httpx.RequestError as exc:
            raise TestItConnectionError(f"Could not connect to TestIT: {type(exc).__name__}")

        if not resp.is_success:
            try:
                err_data = resp.json()
            except Exception:
                err_data = {}
            msg = err_data.get("message") or err_data.get("detail") or f"HTTP {resp.status_code}"
            raise TestItApiError(str(msg), status_code=resp.status_code)

    return {"run_id_testit": run_id_testit, "outcome": outcome}
