from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)


# ── Exceptions ───────────────────────────────────────────────────────────────

class TestItError(Exception):
    def __init__(self, message: str, code: str | None = None, **params) -> None:
        super().__init__(message)
        self.code = code
        self.params = params

class TestItConfigError(TestItError):
    pass

class TestItAuthError(TestItError):
    pass

class TestItNotFoundError(TestItError):
    pass

class TestItConnectionError(TestItError):
    pass

class TestItResponseError(TestItError):
    pass

class TestItApiError(TestItError):
    def __init__(self, message: str, status_code: int | None = None, code: str | None = None, **params) -> None:
        super().__init__(message, code=code, **params)
        self.status_code = status_code


# ── Client ───────────────────────────────────────────────────────────────────

class TestItClient:
    def __init__(self, cfg=None) -> None:
        if cfg is None:
            from app.core.config import settings
            cfg = settings
        self._base_url = cfg.TESTIT_BASE_URL.rstrip("/")
        self._token = cfg.TESTIT_PRIVATE_TOKEN
        self._auth_scheme = cfg.TESTIT_AUTH_SCHEME
        self._timeout = cfg.TESTIT_TIMEOUT_SECONDS
        self._verify_ssl = cfg.TESTIT_VERIFY_SSL

    def _check_config(self) -> None:
        if not self._base_url:
            raise TestItConfigError("TESTIT_BASE_URL is not configured in .env", code="testit_base_url_missing")
        if not self._token:
            raise TestItConfigError("TESTIT_PRIVATE_TOKEN is not configured in .env", code="testit_token_missing")

    def _headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Authorization": f"{self._auth_scheme} {self._token}",
        }

    async def get_work_item(self, work_item_id: str) -> dict:
        self._check_config()
        url = f"{self._base_url}/api/v2/workItems/{work_item_id}"
        logger.debug("GET TestIT work item id=%s", work_item_id)

        try:
            async with httpx.AsyncClient(
                verify=self._verify_ssl,
                timeout=float(self._timeout),
            ) as client:
                resp = await client.get(url, headers=self._headers())
        except httpx.TimeoutException:
            raise TestItConnectionError("Connection to TestIT timed out", code="testit_timeout")
        except httpx.RequestError as exc:
            raise TestItConnectionError(f"Could not connect to TestIT: {type(exc).__name__}", code="testit_connect_failed", exc_type=type(exc).__name__)

        if resp.status_code in (401, 403):
            raise TestItAuthError(
                "TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.",
                code="testit_auth_failed",
            )
        if resp.status_code == 404:
            raise TestItNotFoundError(
                f"TestIT work item not found: {work_item_id}",
                code="testit_not_found",
                id=work_item_id,
            )

        try:
            data = resp.json()
        except Exception:
            raise TestItResponseError(
                f"TestIT returned non-JSON response (HTTP {resp.status_code})",
                code="testit_response_error",
                status_code=resp.status_code,
            )

        if not resp.is_success:
            msg = (
                data.get("message")
                or data.get("detail")
                or data.get("title")
                or "TestIT API error"
            )
            raise TestItApiError(str(msg), status_code=resp.status_code)

        return data

    async def get_project(self, project_id: str) -> dict:
        self._check_config()
        url = f"{self._base_url}/api/v2/projects/{project_id}"
        try:
            async with httpx.AsyncClient(
                verify=self._verify_ssl,
                timeout=float(self._timeout),
            ) as client:
                resp = await client.get(url, headers=self._headers())
        except httpx.TimeoutException:
            raise TestItConnectionError("Connection to TestIT timed out", code="testit_timeout")
        except httpx.RequestError as exc:
            raise TestItConnectionError(f"Could not connect to TestIT: {type(exc).__name__}", code="testit_connect_failed", exc_type=type(exc).__name__)

        if resp.status_code in (401, 403):
            raise TestItAuthError("TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.", code="testit_auth_failed")

        try:
            data = resp.json()
        except Exception:
            raise TestItResponseError(f"TestIT returned non-JSON response (HTTP {resp.status_code})", code="testit_response_error", status_code=resp.status_code)

        if not resp.is_success:
            msg = data.get("message") or data.get("detail") or "TestIT API error"
            raise TestItApiError(str(msg), status_code=resp.status_code)

        return data

    async def list_sections(self, project_id: str) -> list[dict]:
        self._check_config()
        url = f"{self._base_url}/api/v2/projects/{project_id}/sections"
        try:
            async with httpx.AsyncClient(
                verify=self._verify_ssl,
                timeout=float(self._timeout),
            ) as client:
                resp = await client.get(url, headers=self._headers())
        except httpx.TimeoutException:
            raise TestItConnectionError("Connection to TestIT timed out", code="testit_timeout")
        except httpx.RequestError as exc:
            raise TestItConnectionError(f"Could not connect to TestIT: {type(exc).__name__}", code="testit_connect_failed", exc_type=type(exc).__name__)

        if resp.status_code in (401, 403):
            raise TestItAuthError("TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.", code="testit_auth_failed")

        try:
            data = resp.json()
        except Exception:
            raise TestItResponseError(f"TestIT returned non-JSON response (HTTP {resp.status_code})", code="testit_response_error", status_code=resp.status_code)

        if not resp.is_success:
            msg = data.get("message") or data.get("detail") or "TestIT API error"
            raise TestItApiError(str(msg), status_code=resp.status_code)

        return data if isinstance(data, list) else data.get("items", [])

    async def list_attributes(self, project_id: str) -> list[dict]:
        self._check_config()
        url = f"{self._base_url}/api/v2/projects/{project_id}/attributes"
        try:
            async with httpx.AsyncClient(
                verify=self._verify_ssl,
                timeout=float(self._timeout),
            ) as client:
                resp = await client.get(url, headers=self._headers())
        except httpx.TimeoutException:
            raise TestItConnectionError("Connection to TestIT timed out", code="testit_timeout")
        except httpx.RequestError as exc:
            raise TestItConnectionError(f"Could not connect to TestIT: {type(exc).__name__}", code="testit_connect_failed", exc_type=type(exc).__name__)

        if resp.status_code in (401, 403):
            raise TestItAuthError("TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.", code="testit_auth_failed")

        try:
            data = resp.json()
        except Exception:
            raise TestItResponseError(f"TestIT returned non-JSON response (HTTP {resp.status_code})", code="testit_response_error", status_code=resp.status_code)

        if not resp.is_success:
            msg = data.get("message") or data.get("detail") or "TestIT API error"
            raise TestItApiError(str(msg), status_code=resp.status_code)

        return data if isinstance(data, list) else data.get("items", [])

    async def get_section(self, section_id: str) -> dict:
        self._check_config()
        url = f"{self._base_url}/api/v2/sections/{section_id}"
        try:
            async with httpx.AsyncClient(
                verify=self._verify_ssl,
                timeout=float(self._timeout),
            ) as client:
                resp = await client.get(url, headers=self._headers())
        except (httpx.TimeoutException, httpx.RequestError):
            return {}
        if not resp.is_success:
            return {}
        try:
            return resp.json()
        except Exception:
            return {}

    async def create_section(self, project_id: str, name: str, parent_id: str | None = None) -> dict:
        self._check_config()
        url = f"{self._base_url}/api/v2/sections"
        payload: dict = {"name": name, "projectId": project_id}
        if parent_id:
            payload["parentId"] = parent_id
        try:
            async with httpx.AsyncClient(
                verify=self._verify_ssl,
                timeout=float(self._timeout),
            ) as client:
                resp = await client.post(
                    url,
                    headers={**self._headers(), "Content-Type": "application/json"},
                    json=payload,
                )
        except httpx.TimeoutException:
            raise TestItConnectionError("Connection to TestIT timed out", code="testit_timeout")
        except httpx.RequestError as exc:
            raise TestItConnectionError(f"Could not connect to TestIT: {type(exc).__name__}", code="testit_connect_failed", exc_type=type(exc).__name__)

        if resp.status_code in (401, 403):
            raise TestItAuthError("TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.", code="testit_auth_failed")

        try:
            data = resp.json()
        except Exception:
            raise TestItResponseError(f"TestIT returned non-JSON response (HTTP {resp.status_code})", code="testit_response_error", status_code=resp.status_code)

        if not resp.is_success:
            msg = data.get("message") or data.get("detail") or "TestIT API error"
            raise TestItApiError(str(msg), status_code=resp.status_code)

        return data

    async def create_work_item(self, payload: dict) -> dict:
        self._check_config()
        url = f"{self._base_url}/api/v2/workItems"
        logger.debug(
            "POST TestIT create work item: name=%s steps=%d pre=%d post=%d tags=%s",
            payload.get("name", ""),
            len(payload.get("steps", [])),
            len(payload.get("preconditionSteps", [])),
            len(payload.get("postconditionSteps", [])),
            [t["name"] for t in payload.get("tags", [])],
        )

        try:
            async with httpx.AsyncClient(
                verify=self._verify_ssl,
                timeout=float(self._timeout),
            ) as client:
                resp = await client.post(url, headers={**self._headers(), "Content-Type": "application/json"}, json=payload)
        except httpx.TimeoutException:
            raise TestItConnectionError("Connection to TestIT timed out", code="testit_timeout")
        except httpx.RequestError as exc:
            raise TestItConnectionError(f"Could not connect to TestIT: {type(exc).__name__}", code="testit_connect_failed", exc_type=type(exc).__name__)

        if resp.status_code in (401, 403):
            raise TestItAuthError("TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.", code="testit_auth_failed")

        try:
            data = resp.json()
        except Exception:
            raise TestItResponseError(
                f"TestIT returned non-JSON response (HTTP {resp.status_code})",
                code="testit_response_error",
                status_code=resp.status_code,
            )

        if not resp.is_success:
            logger.error(
                "TestIT create_work_item failed: HTTP %s, body: %s",
                resp.status_code,
                data,
            )
            msg = (
                data.get("message")
                or data.get("detail")
                or data.get("title")
                or data.get("errorMessage")
                or (str(data.get("errors")) if data.get("errors") else None)
                or f"HTTP {resp.status_code}"
            )
            raise TestItApiError(str(msg), status_code=resp.status_code)

        return data

    async def update_work_item(self, work_item_id: str, payload: dict) -> dict:
        """PUT /api/v2/workItems — id must be in body, returns 204 No Content."""
        self._check_config()
        url = f"{self._base_url}/api/v2/workItems"
        logger.debug("PUT TestIT update work item id=%s", work_item_id)

        try:
            async with httpx.AsyncClient(
                verify=self._verify_ssl,
                timeout=float(self._timeout),
            ) as client:
                resp = await client.put(
                    url,
                    headers={**self._headers(), "Content-Type": "application/json"},
                    json=payload,
                )
        except httpx.TimeoutException:
            raise TestItConnectionError("Connection to TestIT timed out", code="testit_timeout")
        except httpx.RequestError as exc:
            raise TestItConnectionError(f"Could not connect to TestIT: {type(exc).__name__}", code="testit_connect_failed", exc_type=type(exc).__name__)

        if resp.status_code in (401, 403):
            raise TestItAuthError("TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.", code="testit_auth_failed")
        if resp.status_code == 404:
            raise TestItNotFoundError(
                f"TestIT work item not found: {work_item_id}",
                code="testit_not_found",
                id=work_item_id,
            )

        if resp.status_code == 204:
            # Success — no body returned; reconstruct minimal response from payload
            return {
                "id": payload.get("id", work_item_id),
                "globalId": payload.get("globalId"),
                "name": payload.get("name", ""),
            }

        try:
            data = resp.json()
        except Exception:
            raise TestItResponseError(
                f"TestIT returned non-JSON response (HTTP {resp.status_code})",
                code="testit_response_error",
                status_code=resp.status_code,
            )

        if not resp.is_success:
            logger.error(
                "TestIT update_work_item failed: HTTP %s, body: %s",
                resp.status_code,
                data,
            )
            msg = (
                data.get("message")
                or data.get("detail")
                or data.get("title")
                or data.get("errorMessage")
                or (str(data.get("errors")) if data.get("errors") else None)
                or f"HTTP {resp.status_code}"
            )
            raise TestItApiError(str(msg), status_code=resp.status_code)

        return data
