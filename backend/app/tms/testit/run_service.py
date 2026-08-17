from __future__ import annotations
import asyncio
import logging
import httpx
from app.tms.testit.client import (
    TestItClient,
    TestItConfigError,
    TestItConnectionError,
    TestItAuthError,
    TestItResponseError,
    TestItApiError,
)

logger = logging.getLogger(__name__)

STATUS_MAP = {
    'passed': 'Passed',
    'failed': 'Failed',
    'blocked': 'Blocked',
}

# TestIT's testResults endpoint only accepts results tied to a registered
# autotest's externalId (there is no plain-work-item result API) — this
# derives a stable externalId per work item and registers it on first use.
# The default configuration id is likewise fetched and cached per project.
_AUTOTEST_EXTERNAL_ID_PREFIX = "qa-ai-tool-workitem-"
_default_configuration_ids: dict[str, str] = {}
_configuration_locks: dict[str, asyncio.Lock] = {}


def _lock_for(locks: dict[str, asyncio.Lock], key: str) -> asyncio.Lock:
    return locks.setdefault(key, asyncio.Lock())


async def _resolve_default_configuration_id(client: TestItClient, project_id: str) -> str:
    cached = _default_configuration_ids.get(project_id)
    if cached:
        return cached
    async with _lock_for(_configuration_locks, project_id):
        cached = _default_configuration_ids.get(project_id)
        if cached:
            return cached
        configs = await client.list_configurations(project_id)
        if not configs:
            raise TestItResponseError(f"TestIT project {project_id} has no configurations")
        default = next((c for c in configs if c.get("isDefault")), configs[0])
        config_id = default["id"]
        _default_configuration_ids[project_id] = config_id
        return config_id


async def _get_or_create_autotest_external_id(client: TestItClient, project_id: str, work_item: dict) -> str:
    external_id = f"{_AUTOTEST_EXTERNAL_ID_PREFIX}{work_item['id']}"
    existing = await client.search_autotests(project_id, external_id)
    if existing:
        return external_id
    await client.create_autotest(
        project_id, external_id,
        name=work_item.get("name") or "AI Test Runner",
        work_item_id=work_item["id"],
    )
    return external_id


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
    work_item = await client.get_work_item(work_item_id)
    project_id = work_item.get("projectId")
    if not project_id:
        raise TestItResponseError(f"TestIT work item {work_item_id} has no projectId")

    autotest_external_id = await _get_or_create_autotest_external_id(client, project_id, work_item)
    configuration_id = await _resolve_default_configuration_id(client, project_id)

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
            "configurationId": configuration_id,
            "autoTestExternalId": autotest_external_id,
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
            msg = err_data.get("message") or err_data.get("detail") or f"HTTP {resp.status_code}: {resp.text[:500]}"
            raise TestItApiError(str(msg), status_code=resp.status_code)

        # TestIT auto-completes the run (sets stateName=Completed, startedOn/
        # completedOn) as soon as its one-and-only result is posted above — an
        # explicit POST .../complete afterward hits "status transition ...
        # is not allowed" (400), since the run is already Completed by then.

    return {"run_id_testit": run_id_testit, "outcome": outcome}
