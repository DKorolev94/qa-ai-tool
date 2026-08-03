# RU/EN Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit RU/EN language toggle so that when EN is selected everything the user sees — UI chrome, LLM-generated review/improve content, and backend error messages — is in English, and when RU is selected everything is in Russian, replacing today's auto-detect-from-source-test-case behavior.

**Architecture:** Backend endpoints accept a `language: "ru" | "en"` field (default `"ru"`) and use it in three independent places: (1) LLM prompts force output language instead of matching the source test case, (2) a small `errors_i18n.py` lookup translates backend error messages at the API boundary, (3) `review_config.py` returns localized rule/profile labels. Frontend uses `react-i18next` for all static UI copy, persists the chosen language to `localStorage`, and attaches it to every backend request.

**Tech Stack:** Python/FastAPI/Pydantic (backend, existing), React/TypeScript (frontend, existing) + new deps `i18next`, `react-i18next`.

## Global Constraints

- Default language is `"ru"` everywhere a `language` field/query param is added — omitting it must not change behavior for existing callers (231 existing backend tests must keep passing unchanged).
- `/runner/*` endpoints and their errors stay English-only in this pass (separate subsystem, explicitly out of scope per the design spec).
- `clean-testcase` / `parse_testcase_with_llm` keep preserving the source language (out of scope per spec) — no changes to `app/tms/testit/parser.py`.
- FastAPI's own native validation errors (malformed JSON, missing fields) are not localized.
- No frontend test framework is introduced; frontend tasks are verified manually via the dev server.
- Design spec: `docs/superpowers/specs/2026-08-03-ru-en-localization-design.md` — read it if a task here seems to contradict it; this plan is the more detailed, implementation-accurate source when they differ on specifics (e.g. exact error codes), since it was written after deeper file-level investigation.

---

## Task 1: Backend error-code translation table

**Files:**
- Create: `backend/app/core/errors_i18n.py`
- Test: `backend/tests/test_errors_i18n.py`

**Interfaces:**
- Produces: `localize(code: str, language: str, **params) -> str` — used by Task 4 (exception classes) and Task 5 (routes.py).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_errors_i18n.py
import pytest
from app.core.errors_i18n import localize


def test_localize_known_code_russian():
    assert localize("testit_auth_failed", "ru") == "Ошибка авторизации в TestIT. Проверьте TESTIT_PRIVATE_TOKEN."


def test_localize_known_code_english():
    assert localize("testit_auth_failed", "en") == "TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN."


def test_localize_fills_params():
    result = localize("testit_not_found", "ru", id="6109")
    assert result == "Тест-кейс не найден в TestIT: 6109"


def test_localize_unknown_language_falls_back_to_english():
    result = localize("testit_auth_failed", "fr")
    assert result == "TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN."


def test_localize_unknown_code_falls_back_to_code_itself():
    assert localize("some_未知_code", "ru") == "some_未知_code"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_errors_i18n.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.core.errors_i18n'`

- [ ] **Step 3: Write the implementation**

```python
# backend/app/core/errors_i18n.py
from __future__ import annotations

ERROR_MESSAGES: dict[str, dict[str, str]] = {
    "missing_input": {
        "en": "Provide raw_content or work_item",
        "ru": "Укажите raw_content или work_item",
    },
    "llm_improve_unavailable": {
        "en": "LLM improve unavailable: {detail}",
        "ru": "LLM недоступен для улучшения: {detail}",
    },
    "invalid_work_item_input": {
        "en": (
            "Could not extract a TestIT work item id from input: {value}. "
            "Provide a numeric ID (e.g. 6109), a UUID, or a TestIT test case URL."
        ),
        "ru": (
            "Не удалось распознать id тест-кейса TestIT во входных данных: {value}. "
            "Укажите числовой ID (например, 6109), UUID или ссылку на тест-кейс TestIT."
        ),
    },
    "testit_base_url_missing": {
        "en": "TESTIT_BASE_URL is not configured in .env",
        "ru": "TESTIT_BASE_URL не задан в .env",
    },
    "testit_token_missing": {
        "en": "TESTIT_PRIVATE_TOKEN is not configured in .env",
        "ru": "TESTIT_PRIVATE_TOKEN не задан в .env",
    },
    "testit_project_uuid_missing": {
        "en": "TESTIT_PROJECT_UUID is not configured in .env",
        "ru": "TESTIT_PROJECT_UUID не задан в .env",
    },
    "testit_auth_failed": {
        "en": "TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.",
        "ru": "Ошибка авторизации в TestIT. Проверьте TESTIT_PRIVATE_TOKEN.",
    },
    "testit_not_found": {
        "en": "TestIT work item not found: {id}",
        "ru": "Тест-кейс не найден в TestIT: {id}",
    },
    "testit_timeout": {
        "en": "Connection to TestIT timed out",
        "ru": "Превышено время ожидания соединения с TestIT",
    },
    "testit_connect_failed": {
        "en": "Could not connect to TestIT: {exc_type}",
        "ru": "Не удалось подключиться к TestIT: {exc_type}",
    },
    "testit_response_error": {
        "en": "TestIT returned a non-JSON response (HTTP {status_code})",
        "ru": "TestIT вернул не-JSON ответ (HTTP {status_code})",
    },
}


def localize(code: str, language: str, **params) -> str:
    """Falls back to English, then to the raw code, if a translation is missing."""
    entry = ERROR_MESSAGES.get(code)
    if entry is None:
        return code
    template = entry.get(language) or entry.get("en") or code
    try:
        return template.format(**params)
    except (KeyError, IndexError):
        return template
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_errors_i18n.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
cd backend
git add app/core/errors_i18n.py tests/test_errors_i18n.py
git commit -m "feat: add backend error-code translation table for ru/en localization"
```

---

## Task 2: Add `language` field to request/response schemas

**Files:**
- Modify: `backend/app/schemas/analysis.py:203-219` (`AnalyzeTestCaseRequest`, `ImproveTestCaseRequest`)
- Modify: `backend/app/tms/testit/schemas.py:6-7,17-21,32-35` (`FetchTestItWorkItemRequest`, `CreateDraftRequest`, `UpdateOriginalRequest`)
- Test: `backend/tests/test_schemas.py`

**Interfaces:**
- Produces: every in-scope request model now has `.language: Literal["ru", "en"]` with default `"ru"`, consumed by Task 5 (routes.py) and Task 9 (service layer).

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_schemas.py` (append; check the file's existing imports first — it already imports from `app.schemas.analysis`):

```python
from app.schemas.analysis import AnalyzeTestCaseRequest, ImproveTestCaseRequest
from app.tms.testit.schemas import CreateDraftRequest, FetchTestItWorkItemRequest, UpdateOriginalRequest


def test_analyze_request_defaults_to_ru():
    req = AnalyzeTestCaseRequest(raw_content="x")
    assert req.language == "ru"


def test_improve_request_accepts_en():
    req = ImproveTestCaseRequest(raw_content="x", language="en")
    assert req.language == "en"


def test_fetch_request_defaults_to_ru():
    req = FetchTestItWorkItemRequest(input="6109")
    assert req.language == "ru"


def test_create_draft_request_defaults_to_ru():
    req = CreateDraftRequest(improved_testcase={}, source_work_item_id="1")
    assert req.language == "ru"


def test_update_original_request_defaults_to_ru():
    req = UpdateOriginalRequest(improved_testcase={}, source_work_item_id="1")
    assert req.language == "ru"


def test_invalid_language_rejected():
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        AnalyzeTestCaseRequest(raw_content="x", language="fr")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_schemas.py -v`
Expected: FAIL — `AttributeError` or similar, since `.language` doesn't exist yet on these models

- [ ] **Step 3: Add the field**

In `backend/app/schemas/analysis.py`, the two request classes currently read:

```python
class AnalyzeTestCaseRequest(BaseModel):
    raw_content: str | None = None
    work_item: dict | None = None
    enabled_rules: list[ReviewRuleId] | None = None
```

and

```python
class ImproveTestCaseRequest(BaseModel):
    raw_content: str | None = None
    work_item: dict | None = None
    selected_issues: list[dict] = []
```

Add `language: Literal["ru", "en"] = "ru"` to both (the `Literal` import already exists at the top of the file):

```python
class AnalyzeTestCaseRequest(BaseModel):
    raw_content: str | None = None
    work_item: dict | None = None
    enabled_rules: list[ReviewRuleId] | None = None
    language: Literal["ru", "en"] = "ru"
```

```python
class ImproveTestCaseRequest(BaseModel):
    raw_content: str | None = None
    work_item: dict | None = None
    selected_issues: list[dict] = []
    language: Literal["ru", "en"] = "ru"
```

In `backend/app/tms/testit/schemas.py`, add the import and field. Current top of file:

```python
from __future__ import annotations

from pydantic import BaseModel


class FetchTestItWorkItemRequest(BaseModel):
    input: str
```

Change to:

```python
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class FetchTestItWorkItemRequest(BaseModel):
    input: str
    language: Literal["ru", "en"] = "ru"
```

And update `CreateDraftRequest` / `UpdateOriginalRequest`:

```python
class CreateDraftRequest(BaseModel):
    improved_testcase: dict
    source_work_item_id: str
    source_attributes: dict = {}
    manual_notes: list[str] = []
    language: Literal["ru", "en"] = "ru"
```

```python
class UpdateOriginalRequest(BaseModel):
    improved_testcase: dict
    source_work_item_id: str
    source_attributes: dict = {}
    language: Literal["ru", "en"] = "ru"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_schemas.py tests/test_testit_routes.py -v`
Expected: all pass (existing `test_testit_routes.py` tests must be unaffected since the field has a default)

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `cd backend && source venv/bin/activate && python -m pytest`
Expected: 231 + new tests pass, 0 failures

- [ ] **Step 6: Commit**

```bash
cd backend
git add app/schemas/analysis.py app/tms/testit/schemas.py tests/test_schemas.py
git commit -m "feat: add language field to analyze/improve/fetch/draft/update request schemas"
```

---

## Task 3: TestIT exception classes gain `code` + `params`

**Files:**
- Modify: `backend/app/tms/testit/client.py` (exception classes + every raise site)
- Test: `backend/tests/test_testit_client.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `TestItError.code: str | None`, `TestItError.params: dict` — consumed by Task 5 (`routes.py`) via `localize(exc.code, language, **exc.params)`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_testit_client.py` (the existing tests already exercise these exception paths with a mocked `httpx` response — check the file's existing fixtures/mocking pattern first and follow it; the additions below just assert on the new attributes after an existing failure path runs):

```python
def test_auth_error_has_code():
    from app.tms.testit.client import TestItAuthError
    exc = TestItAuthError("TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.", code="testit_auth_failed")
    assert exc.code == "testit_auth_failed"
    assert exc.params == {}


def test_not_found_error_has_code_and_params():
    from app.tms.testit.client import TestItNotFoundError
    exc = TestItNotFoundError("TestIT work item not found: 6109", code="testit_not_found", id="6109")
    assert exc.code == "testit_not_found"
    assert exc.params == {"id": "6109"}


def test_error_without_code_defaults_to_none():
    from app.tms.testit.client import TestItConnectionError
    exc = TestItConnectionError("Connection to TestIT timed out")
    assert exc.code is None
    assert exc.params == {}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_testit_client.py -v`
Expected: FAIL — `TypeError: TestItAuthError.__init__() got an unexpected keyword argument 'code'`

- [ ] **Step 3: Update the exception base class and every raise site**

Replace the exceptions block in `backend/app/tms/testit/client.py`:

```python
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
```

Then update every raise site in the same file to pass a `code` (and `params` where the message has a dynamic value). There are 6 methods (`get_work_item`, `get_project`, `list_sections`, `list_attributes`, `create_section`, `create_work_item`, `update_work_item`) each repeating the same handful of raise patterns — update all occurrences:

- `raise TestItAuthError("TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.")` → add `, code="testit_auth_failed"` (appears 7 times — `get_work_item`, `get_project`, `list_sections`, `list_attributes`, `create_section`, `create_work_item`, `update_work_item`)
- `raise TestItNotFoundError(f"TestIT work item not found: {work_item_id}")` → `raise TestItNotFoundError(f"TestIT work item not found: {work_item_id}", code="testit_not_found", id=work_item_id)` (appears in `get_work_item` and `update_work_item`)
- `raise TestItConnectionError("Connection to TestIT timed out")` → add `, code="testit_timeout"` (appears once per method that has its own `try/except httpx.TimeoutException`, i.e. 7 times)
- ``raise TestItConnectionError(f"Could not connect to TestIT: {type(exc).__name__}")`` → add `, code="testit_connect_failed", exc_type=type(exc).__name__` (7 times, same methods)
- ``raise TestItResponseError(f"TestIT returned non-JSON response (HTTP {resp.status_code})")`` → `raise TestItResponseError(f"TestIT returned non-JSON response (HTTP {resp.status_code})", code="testit_response_error", status_code=resp.status_code)` (7 times)
- `raise TestItApiError(str(msg), status_code=resp.status_code)` (and the `create_work_item`/`update_work_item` variants with the longer `msg` fallback chain) → leave `code=None` (these carry dynamic upstream text that has no fixed translation — `TestItApiError.code` stays `None`, and `routes.py`'s handler for it, per Task 5, falls back to `str(exc)` when code is `None`, same as today)
- In `_check_config`: `raise TestItConfigError("TESTIT_BASE_URL is not configured in .env")` → add `, code="testit_base_url_missing"`; `raise TestItConfigError("TESTIT_PRIVATE_TOKEN is not configured in .env")` → add `, code="testit_token_missing"`

Do this as a careful read-and-edit pass over the whole file (11 raise sites for `TestItAuthError`/`TestItNotFoundError`/`TestItConnectionError`(x2)/`TestItResponseError` repeated across 7 methods, plus 2 in `_check_config`) — every occurrence of these five specific messages gets the matching `code=` kwarg added, nothing else in the file changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_testit_client.py -v`
Expected: all pass, including the 3 new tests

- [ ] **Step 5: Run the full suite**

Run: `cd backend && source venv/bin/activate && python -m pytest`
Expected: all pass (existing tests only assert on the exception message text via `str(exc)`, which is unchanged — `code`/`params` are additive)

- [ ] **Step 6: Commit**

```bash
cd backend
git add app/tms/testit/client.py tests/test_testit_client.py
git commit -m "feat: add error codes to TestIT client exceptions for localization"
```

---

## Task 4: `InvalidWorkItemInputError` + `TestItConfigError` codes on the remaining raise sites

**Files:**
- Modify: `backend/app/tms/testit/link_parser.py`
- Modify: `backend/app/tms/testit/draft_service.py:133-134`
- Modify: `backend/app/tms/testit/update_service.py:18-19`
- Create: `backend/tests/test_testit_update_service.py` (no test file for `apply_to_original_in_testit` exists yet)
- Test: `backend/tests/test_testit_link_parser.py`, `backend/tests/test_testit_draft_service.py`, `backend/tests/test_testit_update_service.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `InvalidWorkItemInputError` (subclass of `ValueError`, has `.code == "invalid_work_item_input"` and `.params == {"value": <original input>}`) — consumed by Task 5's `routes.py` handler for `/testit/workitem/fetch`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_testit_link_parser.py`:

```python
def test_invalid_input_raises_typed_error_with_code():
    from app.tms.testit.link_parser import extract_work_item_id, InvalidWorkItemInputError
    import pytest
    with pytest.raises(InvalidWorkItemInputError) as exc_info:
        extract_work_item_id("not a valid id")
    assert exc_info.value.code == "invalid_work_item_input"
    assert exc_info.value.params == {"value": "not a valid id"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_testit_link_parser.py -v`
Expected: FAIL — `ImportError: cannot import name 'InvalidWorkItemInputError'`

- [ ] **Step 3: Add the exception class and use it**

In `backend/app/tms/testit/link_parser.py`, the current final lines are:

```python
    raise ValueError(
        f"Could not extract TestIT work item id from input: {value!r}. "
        "Provide a numeric ID (e.g. 6109), a UUID, or a TestIT test case URL."
    )
```

Add the class above `extract_work_item_id` and change the raise:

```python
class InvalidWorkItemInputError(ValueError):
    def __init__(self, value: str) -> None:
        super().__init__(
            f"Could not extract TestIT work item id from input: {value!r}. "
            "Provide a numeric ID (e.g. 6109), a UUID, or a TestIT test case URL."
        )
        self.code = "invalid_work_item_input"
        self.params = {"value": value}
```

and at the bottom of `extract_work_item_id`:

```python
    raise InvalidWorkItemInputError(value)
```

- [ ] **Step 4: Add `TestItConfigError` codes for the project-UUID checks**

In `backend/app/tms/testit/draft_service.py`, find:

```python
    if not settings.TESTIT_PROJECT_UUID:
        raise TestItConfigError("TESTIT_PROJECT_UUID is not configured in .env")
```

Change to:

```python
    if not settings.TESTIT_PROJECT_UUID:
        raise TestItConfigError("TESTIT_PROJECT_UUID is not configured in .env", code="testit_project_uuid_missing")
```

In `backend/app/tms/testit/update_service.py`, the same line at the top of `apply_to_original_in_testit`:

```python
    if not settings.TESTIT_PROJECT_UUID:
        raise TestItConfigError("TESTIT_PROJECT_UUID is not configured in .env")
```

gets the same `, code="testit_project_uuid_missing"` addition.

- [ ] **Step 5: Create the new test file for `apply_to_original_in_testit`**

No test file exercises `apply_to_original_in_testit` yet. Create one, mirroring the mocking pattern already used in `test_testit_draft_service.py` (`patch("app.tms.testit.<module>.settings", SimpleNamespace(...))`):

```python
# backend/tests/test_testit_update_service.py
import asyncio
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.tms.testit.client import TestItConfigError
from app.tms.testit.update_service import apply_to_original_in_testit


def run(coro):
    return asyncio.run(coro)


def test_missing_project_uuid_raises_with_code():
    with patch(
        "app.tms.testit.update_service.settings",
        SimpleNamespace(TESTIT_PROJECT_UUID=None, TESTIT_BASE_URL="https://testit.example.com"),
    ):
        with pytest.raises(TestItConfigError) as exc_info:
            run(apply_to_original_in_testit({}, "6109"))
    assert exc_info.value.code == "testit_project_uuid_missing"
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_testit_link_parser.py tests/test_testit_draft_service.py tests/test_testit_update_service.py -v`
Expected: all pass

- [ ] **Step 7: Run the full suite**

Run: `cd backend && source venv/bin/activate && python -m pytest`
Expected: all pass — `routes.py` still catches plain `ValueError` for this path until Task 5, and `InvalidWorkItemInputError` **is** a `ValueError`, so the existing `except ValueError as exc: raise HTTPException(status_code=400, detail=str(exc))` in `fetch_testit_workitem` keeps working unchanged in the meantime

- [ ] **Step 8: Commit**

```bash
cd backend
git add app/tms/testit/link_parser.py app/tms/testit/draft_service.py app/tms/testit/update_service.py tests/test_testit_link_parser.py tests/test_testit_update_service.py
git commit -m "feat: add typed error code for invalid work item input and project UUID config"
```

---

## Task 5: Wire `language` + `localize()` into `routes.py`

**Files:**
- Modify: `backend/app/api/routes.py`
- Test: `backend/tests/test_testit_routes.py`

**Interfaces:**
- Consumes: `localize(code, language, **params)` from Task 1; `.language` on request models from Task 2; `.code`/`.params` on exceptions from Tasks 3-4; `InvalidWorkItemInputError` from Task 4.
- Produces: nothing new for later tasks — this is where localization becomes user-visible in HTTP responses.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_testit_routes.py`. The file already defines a module-level `client = TestClient(app)` (not a pytest fixture) that its existing tests call directly — use that same `client` object, don't add a fixture:

```python
def test_analyze_missing_input_localized_ru():
    resp = client.post("/api/analyze-testcase", json={"language": "ru"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Укажите raw_content или work_item"


def test_analyze_missing_input_localized_en():
    resp = client.post("/api/analyze-testcase", json={"language": "en"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Provide raw_content or work_item"


def test_analyze_missing_input_defaults_to_ru():
    resp = client.post("/api/analyze-testcase", json={})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Укажите raw_content или work_item"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_testit_routes.py -v -k missing_input`
Expected: FAIL — current detail is the hardcoded English string regardless of `language`

- [ ] **Step 3: Update every in-scope handler**

Add the import at the top of `backend/app/api/routes.py` (alongside the existing imports):

```python
from app.core.errors_i18n import localize
```

Replace `analyze_testcase`:

```python
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
```

Replace `improve_testcase_endpoint`:

```python
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
```

Replace `fetch_testit_workitem` — note the new `except InvalidWorkItemInputError` branch must come before the generic `except ValueError`, and every branch below now uses `localize(exc.code, body.language, **exc.params)` with a fallback to `str(exc)` for `TestItApiError` (which has no fixed code):

```python
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
```

Import `InvalidWorkItemInputError` alongside the other TestIT imports near the top of the file:

```python
from app.tms.testit.link_parser import InvalidWorkItemInputError
```

Apply the same `localize(exc.code, body.language, **exc.params) if exc.code else str(exc)` pattern to `create_testit_draft` and `update_testit_original` (both already have `body.language` available since Task 2 added it to `CreateDraftRequest`/`UpdateOriginalRequest`):

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_testit_routes.py -v`
Expected: all pass

- [ ] **Step 5: Run the full suite**

Run: `cd backend && source venv/bin/activate && python -m pytest`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
cd backend
git add app/api/routes.py tests/test_testit_routes.py
git commit -m "feat: localize backend error responses on analyze/improve/fetch/draft/update endpoints"
```

---

## Task 6: Localized `review_config.py`

**Files:**
- Modify: `backend/app/core/review_config.py`
- Modify: `backend/app/api/routes.py:60-62` (`review_config` handler)
- Create: `backend/tests/test_review_config.py` (no test file for `review_config.py` exists yet)

**Interfaces:**
- Produces: `get_review_config(language: str = "ru") -> ReviewConfig` (signature change from today's zero-arg version) — consumed by Task 12 (`api.ts` `getReviewConfig`).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_review_config.py
from app.core.review_config import get_review_config


def test_default_is_russian():
    config = get_review_config()
    title_rule = next(r for r in config.rules if r.id == "title")
    assert title_rule.label == "Заголовок"


def test_english_labels():
    config = get_review_config("en")
    title_rule = next(r for r in config.rules if r.id == "title")
    assert title_rule.label == "Title"


def test_same_rule_ids_and_order_in_both_languages():
    ru = get_review_config("ru")
    en = get_review_config("en")
    assert [r.id for r in ru.rules] == [r.id for r in en.rules]
    assert [p.id for p in ru.profiles] == [p.id for p in en.profiles]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_review_config.py -v`
Expected: FAIL — `get_review_config()` currently takes no arguments and returns English labels always

- [ ] **Step 3: Rewrite `review_config.py`**

Replace the whole file (the `ReviewSourceConfig`/`ReviewProfileConfig`/`ReviewRuleConfig`/`ReviewConfig` Pydantic models at the top stay exactly as they are today — only the `_CONFIG` construction and `get_review_config` function change):

```python
from __future__ import annotations

from pydantic import BaseModel


class ReviewSourceConfig(BaseModel):
    id: str
    label: str
    enabled: bool
    badge: str | None = None


class ReviewProfileConfig(BaseModel):
    id: str
    label: str
    description: str | None = None
    rules: list[str]


class ReviewRuleConfig(BaseModel):
    id: str
    label: str
    description: str | None = None
    group: str | None = None
    default_for: list[str] | None = None
    profiles: list[str] | None = None
    enabled: bool
    order: int


class ReviewConfig(BaseModel):
    sources: list[ReviewSourceConfig]
    profiles: list[ReviewProfileConfig]
    rules: list[ReviewRuleConfig]
    defaults: dict[str, list[str]]


_DEFAULT_RULES = [
    "title",
    "description",
    "preconditions",
    "steps",
    "postconditions",
    "priority",
    "expected_results",
    "test_data",
    "tags",
    "atomicity",
    "independence",
    "reproducibility",
]

# label/description/group text per language — everything else (id, order, enabled,
# rules list membership) is language-independent and lives once, below.
_TEXT: dict[str, dict[str, dict[str, str]]] = {
    "en": {
        "source_testit": "TestIT",
        "source_testops": "TestOps",
        "profile_standard_label": "Standard review",
        "profile_strict_label": "Strict review",
        "group_case_quality": "Case quality",
        "group_metadata": "Metadata",
        "rule_title_label": "Title",
        "rule_title_desc": "Title is readable, not in snake_case/kebab-case, reflects the scenario.",
        "rule_description_label": "Description",
        "rule_description_desc": "Description is present, does not duplicate the title or contradict the steps.",
        "rule_preconditions_label": "Preconditions",
        "rule_preconditions_desc": "Preconditions describe system state, not actions. No references to other test cases.",
        "rule_steps_label": "Steps",
        "rule_steps_desc": "Each step contains one action. The order of steps is logically possible. No vague goals instead of concrete actions.",
        "rule_postconditions_label": "Postconditions",
        "rule_postconditions_desc": "The final system state after the test is described. No mixing of state and observed result in one field.",
        "rule_priority_label": "Priority",
        "rule_priority_desc": "Priority matches the criticality of the scenario. Auth and payments: high. Main flow: medium. UI details: low.",
        "rule_expected_results_label": "Expected results",
        "rule_expected_results_desc": "Each significant step has a specific expected result: system state, text, screen, status.",
        "rule_test_data_label": "Test data",
        "rule_test_data_desc": "Data is explicitly specified in a separate field, not embedded in the action text.",
        "rule_tags_label": "Tags",
        "rule_tags_desc": "Tags match the case content: type, level, module. Flags incorrect and obviously missing tags.",
        "rule_atomicity_label": "Atomicity",
        "rule_atomicity_desc": "One case contains one verification goal. Flags mixing of independent scenarios.",
        "rule_independence_label": "Independence",
        "rule_independence_desc": "Case runs in any order without dependency on other tests.",
        "rule_reproducibility_label": "Reproducibility",
        "rule_reproducibility_desc": "Case can be run without verbal explanations from the author. Flags implicit assumptions and vague wording.",
    },
    "ru": {
        "source_testit": "TestIT",
        "source_testops": "TestOps",
        "profile_standard_label": "Базовая проверка",
        "profile_strict_label": "Строгая проверка",
        "group_case_quality": "Качество кейса",
        "group_metadata": "Метаданные",
        "rule_title_label": "Заголовок",
        "rule_title_desc": "Заголовок читаем, не в snake_case/kebab-case, отражает сценарий.",
        "rule_description_label": "Описание",
        "rule_description_desc": "Описание присутствует, не дублирует заголовок и не противоречит шагам.",
        "rule_preconditions_label": "Предусловия",
        "rule_preconditions_desc": "Предусловия описывают состояние системы, а не действия. Нет ссылок на другие тест-кейсы.",
        "rule_steps_label": "Шаги",
        "rule_steps_desc": "Каждый шаг содержит одно действие. Порядок шагов логически возможен. Нет расплывчатых целей вместо конкретных действий.",
        "rule_postconditions_label": "Постусловия",
        "rule_postconditions_desc": "Описано конечное состояние системы после теста. Нет смешения состояния и наблюдаемого результата в одном поле.",
        "rule_priority_label": "Приоритет",
        "rule_priority_desc": "Приоритет соответствует критичности сценария. Авторизация и платежи: high. Основной сценарий: medium. Детали UI: low.",
        "rule_expected_results_label": "Ожидаемые результаты",
        "rule_expected_results_desc": "У каждого значимого шага есть конкретный ожидаемый результат: состояние системы, текст, экран, статус.",
        "rule_test_data_label": "Тестовые данные",
        "rule_test_data_desc": "Данные явно указаны в отдельном поле, а не встроены в текст действия.",
        "rule_tags_label": "Теги",
        "rule_tags_desc": "Теги соответствуют содержанию кейса: тип, уровень, модуль. Флагует некорректные и явно отсутствующие теги.",
        "rule_atomicity_label": "Атомарность",
        "rule_atomicity_desc": "Один кейс содержит одну цель проверки. Флагует смешение независимых сценариев.",
        "rule_independence_label": "Независимость",
        "rule_independence_desc": "Кейс выполняется в любом порядке без зависимости от других тестов.",
        "rule_reproducibility_label": "Воспроизводимость",
        "rule_reproducibility_desc": "Кейс можно выполнить без устных пояснений автора. Флагует неявные допущения и расплывчатые формулировки.",
    },
}

_RULE_ORDER = [
    ("title", 10), ("description", 12), ("preconditions", 15), ("steps", 17),
    ("postconditions", 18), ("priority", 19), ("expected_results", 20),
    ("test_data", 30), ("tags", 40), ("atomicity", 60), ("independence", 70),
    ("reproducibility", 90),
]
_RULE_GROUP = {
    "title": "group_case_quality", "description": "group_case_quality",
    "preconditions": "group_case_quality", "steps": "group_case_quality",
    "postconditions": "group_case_quality", "priority": "group_metadata",
    "expected_results": "group_case_quality", "test_data": "group_case_quality",
    "tags": "group_metadata", "atomicity": "group_case_quality",
    "independence": "group_case_quality", "reproducibility": "group_case_quality",
}


def _build_config(language: str) -> ReviewConfig:
    t = _TEXT.get(language, _TEXT["ru"])
    rules = [
        ReviewRuleConfig(
            id=rule_id,
            label=t[f"rule_{rule_id}_label"],
            description=t[f"rule_{rule_id}_desc"],
            group=t[_RULE_GROUP[rule_id]],
            enabled=True,
            order=order,
        )
        for rule_id, order in _RULE_ORDER
    ]
    return ReviewConfig(
        sources=[
            ReviewSourceConfig(id="testit", label=t["source_testit"], enabled=True),
            ReviewSourceConfig(id="testops", label=t["source_testops"], enabled=False, badge="soon"),
        ],
        profiles=[
            ReviewProfileConfig(
                id="standard",
                label=t["profile_standard_label"],
                rules=["title", "description", "preconditions", "steps", "expected_results", "test_data", "reproducibility"],
            ),
            ReviewProfileConfig(
                id="strict",
                label=t["profile_strict_label"],
                rules=_DEFAULT_RULES,
            ),
        ],
        rules=rules,
        defaults={"testit": _DEFAULT_RULES},
    )


_CONFIG_CACHE: dict[str, ReviewConfig] = {}


def get_review_config(language: str = "ru") -> ReviewConfig:
    if language not in _CONFIG_CACHE:
        _CONFIG_CACHE[language] = _build_config(language)
    return _CONFIG_CACHE[language]
```

Note: the original English config had slightly shorter descriptions in some places for `priority`/`expected_results`/`test_data`/etc. that differ between `review_config.py`'s hardcoded copy and `App.tsx`'s `FALLBACK_CONFIG` duplicate (Task 18 will re-sync `FALLBACK_CONFIG` to match these exact English strings) — this rewrite keeps `review_config.py`'s original wording verbatim for English so nothing shifts unexpectedly for existing consumers.

- [ ] **Step 4: Update the route handler to accept `language`**

In `backend/app/api/routes.py`, change:

```python
@router.get("/review-config", response_model=ReviewConfig)
async def review_config() -> ReviewConfig:
    return get_review_config()
```

to:

```python
@router.get("/review-config", response_model=ReviewConfig)
async def review_config(language: str = "ru") -> ReviewConfig:
    return get_review_config(language)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_review_config.py tests/test_testit_routes.py -v`
Expected: all pass

- [ ] **Step 6: Run the full suite**

Run: `cd backend && source venv/bin/activate && python -m pytest`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
cd backend
git add app/core/review_config.py app/api/routes.py tests/test_review_config.py
git commit -m "feat: localize review-config rule/profile labels"
```

---

## Task 7: Parameterize the `## Language` prompt section

**Files:**
- Modify: `backend/app/core/prompts/review_base.md:15-17`
- Modify: `backend/app/core/prompts/improve_base.md:5-7`
- Modify: `backend/app/core/prompt_builder.py`
- Test: `backend/tests/test_prompt_builder.py`

**Interfaces:**
- Produces: `build_review_prompt(enabled_rules, language="ru")`, `build_improve_prompt(rule_ids, language="ru")` — both gain a `language` parameter — consumed by Task 8 (`llm_client.py`).

- [ ] **Step 1: Write the failing tests**

Check `backend/tests/test_prompt_builder.py`'s existing 2 tests first to match its style, then add:

```python
def test_review_prompt_defaults_to_russian_directive():
    prompt = build_review_prompt(None)
    assert "in Russian" in prompt

def test_review_prompt_english_directive():
    prompt = build_review_prompt(None, language="en")
    assert "in English" in prompt
    assert "in Russian" not in prompt

def test_improve_prompt_english_directive():
    prompt = build_improve_prompt(None, language="en")
    assert "in English" in prompt
```

(Import `build_review_prompt`/`build_improve_prompt` the same way the existing tests in the file already do.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_prompt_builder.py -v`
Expected: FAIL — `TypeError: build_review_prompt() got an unexpected keyword argument 'language'`

- [ ] **Step 3: Update the two `.md` files' Language sections**

In `backend/app/core/prompts/review_base.md`, replace:

```
## Language

Write `summary` and every issue's `problem`, `evidence`, and `recommendation` in the same language as the source test case. Detect the language from the test case's title, steps, and description; if the source mixes languages, use whichever language dominates the content. Never switch to a different language than the source, and never mix languages within a single field — this includes hybrid loanwords, like writing an English word (`data`, `test`) inside an otherwise non-English sentence. Field names like `test_data` may stay as literal snake_case, but ordinary prose around them must be a single consistent language.
```

with:

```
## Language

Write `summary` and every issue's `problem`, `evidence`, and `recommendation` in {LANGUAGE_NAME}, regardless of the source test case's language. Never mix languages within a single field — this includes hybrid loanwords, like writing an English word (`data`, `test`) inside an otherwise non-English sentence. Field names like `test_data` may stay as literal snake_case, but ordinary prose around them must be a single consistent language: {LANGUAGE_NAME}.
```

In `backend/app/core/prompts/improve_base.md`, replace:

```
## Language

Write every text field of the test case (title, description, steps, preconditions, postconditions, manual_notes, improvement_notes) in the same language as the source test case. Detect the source language from its title, steps, and description. If the source mixes languages, use whichever language dominates the content. Never translate the test case into a different language than the source, and never mix languages within a single field.
```

with:

```
## Language

Write every text field of the test case (title, description, steps, preconditions, postconditions, manual_notes, improvement_notes) in {LANGUAGE_NAME}, regardless of the source test case's language — translate the content if the source differs. Never mix languages within a single field.
```

- [ ] **Step 4: Add the substitution to `prompt_builder.py`**

Add near the top of `backend/app/core/prompt_builder.py`, after the existing module-level constants:

```python
_LANGUAGE_NAMES: dict[str, str] = {"ru": "Russian", "en": "English"}


def _apply_language(text: str, language: str) -> str:
    return text.replace("{LANGUAGE_NAME}", _LANGUAGE_NAMES.get(language, "Russian"))
```

Update `build_review_prompt`'s first line from:

```python
def build_review_prompt(enabled_rules: list[str] | None = None) -> str:
    base = _load(_REVIEW_BASE)
```

to:

```python
def build_review_prompt(enabled_rules: list[str] | None = None, language: str = "ru") -> str:
    base = _apply_language(_load(_REVIEW_BASE), language)
```

Update `build_improve_prompt`'s signature and base-loading line from:

```python
def build_improve_prompt(rule_ids: list[str] | None = None) -> str:
    ...
    base = _load(_IMPROVE_BASE)
```

to:

```python
def build_improve_prompt(rule_ids: list[str] | None = None, language: str = "ru") -> str:
    ...
    base = _apply_language(_load(_IMPROVE_BASE), language)
```

(the `...` above is the existing body between the signature and the `base = _load(...)` line — leave it untouched, only those two lines change).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_prompt_builder.py -v`
Expected: all pass

- [ ] **Step 6: Run the full suite**

Run: `cd backend && source venv/bin/activate && python -m pytest`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
cd backend
git add app/core/prompts/review_base.md app/core/prompts/improve_base.md app/core/prompt_builder.py tests/test_prompt_builder.py
git commit -m "feat: parameterize LLM prompt language directive instead of matching source"
```

---

## Task 8: Thread `language` through `llm_client.py`, repoint the mismatch retry

**Files:**
- Modify: `backend/app/core/llm_client.py`
- Test: `backend/tests/test_llm_client.py`

**Interfaces:**
- Consumes: `build_review_prompt(enabled_rules, language)`, `build_improve_prompt(rule_ids, language)` from Task 7.
- Produces: `analyze_testcase_with_llm(clean_testcase, enabled_rules=None, language="ru")`, `improve_testcase_with_llm(testcase, selected_issues, language="ru")` — both gain a `language` parameter — consumed by Task 9 (`testcase_analyzer.py`/`testcase_improver.py`).

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_llm_client.py`, following the same `patch("app.core.llm_client._get_client")` pattern the file's existing tests already use (e.g. `test_analyze_returns_review_result` at the top of the file):

```python
def test_analyze_passes_language_to_prompt_builder(monkeypatch):
    from app.core.llm_client import analyze_testcase_with_llm

    captured = {}
    def fake_build_review_prompt(enabled_rules, language="ru"):
        captured["language"] = language
        return "prompt"
    monkeypatch.setattr("app.core.llm_client.build_review_prompt", fake_build_review_prompt)

    with patch("app.core.llm_client._get_client") as mock_get_client:
        mock_client = mock_get_client.return_value
        mock_client.chat.completions.create.return_value = _mock_llm_review()
        analyze_testcase_with_llm(SAMPLE_TESTCASE, language="en")

    assert captured["language"] == "en"


def test_improve_passes_language_to_prompt_builder(monkeypatch):
    from app.core.llm_client import improve_testcase_with_llm

    captured = {}
    def fake_build_improve_prompt(rule_ids, language="ru"):
        captured["language"] = language
        return "prompt"
    monkeypatch.setattr("app.core.llm_client.build_improve_prompt", fake_build_improve_prompt)

    with patch("app.core.llm_client._get_client") as mock_get_client:
        mock_client = mock_get_client.return_value
        mock_client.chat.completions.create.return_value = _mock_improve_result()
        improve_testcase_with_llm(SAMPLE_TESTCASE, SAMPLE_ISSUES, language="en")

    assert captured["language"] == "en"
```

(`patch` is already imported at the top of the file via `from unittest.mock import MagicMock, patch`; `monkeypatch` is pytest's built-in fixture, so both test functions need it as a parameter as shown.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_llm_client.py -v -k passes_language`
Expected: FAIL — `TypeError: analyze_testcase_with_llm() got an unexpected keyword argument 'language'`

- [ ] **Step 3: Update `analyze_testcase_with_llm`**

Current signature and body (relevant parts):

```python
def analyze_testcase_with_llm(
    clean_testcase: dict,
    enabled_rules: list[str] | None = None,
) -> ReviewResult:
    prompt = build_review_prompt(enabled_rules)
    ...
        llm_result = _get_client(instructor.Mode.JSON).chat.completions.create(
            ...
            messages=[
                {"role": "system", "content": prompt},
                {
                    "role": "user",
                    "content": (
                        f"Test case to analyze:\n\n{json.dumps(clean_testcase, ensure_ascii=False, indent=2)}\n\n"
                        "Write summary, problem, evidence, and recommendation in the same language as this test case."
                    ),
                },
            ],
        )
        ...
        summary = llm_result.summary
        if summary.strip() and _source_is_russian(clean_testcase) != _has_cyrillic(summary):
            logger.warning("LLM analyze: summary language mismatch, retrying rewrite")
            rewritten = _rewrite_summary_language(summary, want_russian=_source_is_russian(clean_testcase))
            if rewritten:
                summary = rewritten
```

Change to:

```python
def analyze_testcase_with_llm(
    clean_testcase: dict,
    enabled_rules: list[str] | None = None,
    language: str = "ru",
) -> ReviewResult:
    prompt = build_review_prompt(enabled_rules, language)
    ...
        llm_result = _get_client(instructor.Mode.JSON).chat.completions.create(
            ...
            messages=[
                {"role": "system", "content": prompt},
                {
                    "role": "user",
                    "content": (
                        f"Test case to analyze:\n\n{json.dumps(clean_testcase, ensure_ascii=False, indent=2)}\n\n"
                        f"Write summary, problem, evidence, and recommendation in {'Russian' if language == 'ru' else 'English'}."
                    ),
                },
            ],
        )
        ...
        summary = llm_result.summary
        want_russian = language == "ru"
        if summary.strip() and want_russian != _has_cyrillic(summary):
            logger.warning("LLM analyze: summary language mismatch, retrying rewrite")
            rewritten = _rewrite_summary_language(summary, want_russian=want_russian)
            if rewritten:
                summary = rewritten
```

(the `...` sections above are unchanged existing code — `rules_count`/logging line, the `try:`, the `t0 = time.perf_counter()`, `except Exception as exc:` block, and the final `return ReviewResult(...)` all stay exactly as they are)

- [ ] **Step 4: Remove the now-dead `_source_is_russian` helper**

`_source_is_russian` was only called from the two spots just replaced. Delete its definition:

```python
def _source_is_russian(clean_testcase: dict) -> bool:
    """Best-effort source-language guess from title + step actions — used only
    to catch a `summary` written in the wrong language, not for anything that
    needs to be exact."""
    parts = [str(clean_testcase.get("title") or "")]
    for section in ("preconditions", "steps", "postconditions"):
        for step in clean_testcase.get(section) or []:
            if isinstance(step, dict) and step.get("action"):
                parts.append(str(step["action"]))
    return _has_cyrillic(" ".join(parts))
```

(`_has_cyrillic` stays — it's still used by the mismatch check above.)

- [ ] **Step 5: Update `improve_testcase_with_llm`**

Current signature:

```python
def improve_testcase_with_llm(
    testcase: dict,
    selected_issues: list[dict],
) -> ImproveResult:
    rule_ids = [r for iss in selected_issues if (r := iss.get("rule"))]
    if not selected_issues:
        prompt = build_improve_prompt([])
    elif rule_ids:
        prompt = build_improve_prompt(rule_ids)
    else:
        prompt = build_improve_prompt(None)
```

Change to:

```python
def improve_testcase_with_llm(
    testcase: dict,
    selected_issues: list[dict],
    language: str = "ru",
) -> ImproveResult:
    rule_ids = [r for iss in selected_issues if (r := iss.get("rule"))]
    if not selected_issues:
        prompt = build_improve_prompt([], language)
    elif rule_ids:
        prompt = build_improve_prompt(rule_ids, language)
    else:
        prompt = build_improve_prompt(None, language)
```

(the rest of the function — `numbered_issues`, `user_content`, `_call()`, the retry-on-empty-`issue_resolutions` logic — is unchanged)

- [ ] **Step 6: Fix two existing tests that assumed source-language detection**

`test_llm_client.py` already has `test_analyze_rewrites_summary_when_language_mismatches_source` and `test_analyze_keeps_summary_when_language_matches_source` (lines 118-145), written against the old `_source_is_russian`-based behavior. The mismatch test still passes unchanged (it calls `analyze_testcase_with_llm(russian_testcase)` with no explicit `language`, which now defaults to `"ru"`, and its mocked summary "This test checks login" has no Cyrillic — still a `ru`-vs-non-Cyrillic mismatch under the new logic, same outcome). The "keeps" test breaks: it calls `analyze_testcase_with_llm(SAMPLE_TESTCASE)` (an English test case) with no explicit `language`, expecting no retry — but the new code defaults to `language="ru"`, and the mocked summary `"Good test"` has no Cyrillic, so the new mismatch check (`want_russian=True` vs `_has_cyrillic("Good test")=False`) now fires a retry that didn't happen before, breaking the test's `call_count == 1` assertion.

Update that second test to pass an explicit `language="en"` — matching what it's actually verifying (the summary already matches the *requested* language, so no rewrite is needed), not source detection, which no longer exists:

```python
def test_analyze_keeps_summary_when_summary_matches_selected_language():
    from app.core.llm_client import analyze_testcase_with_llm

    with patch("app.core.llm_client._get_client") as mock_get_client:
        mock_client = mock_get_client.return_value
        mock_client.chat.completions.create.return_value = _mock_llm_review()
        result = analyze_testcase_with_llm(SAMPLE_TESTCASE, language="en")

    assert result.summary == "Good test"
    assert mock_client.chat.completions.create.call_count == 1
```

Replace the old `test_analyze_keeps_summary_when_language_matches_source` function with this one (same file, same location) — the rename reflects that the check is now against the selected language, not a source-detected one.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_llm_client.py -v`
Expected: all pass

- [ ] **Step 8: Run the full suite**

Run: `cd backend && source venv/bin/activate && python -m pytest`
Expected: all pass

- [ ] **Step 9: Commit**

```bash
cd backend
git add app/core/llm_client.py tests/test_llm_client.py
git commit -m "feat: thread selected language through analyze/improve LLM calls"
```

---

## Task 9: Thread `language` through the service layer entry points

**Files:**
- Modify: `backend/app/services/testcase_analyzer.py:133-150`
- Modify: `backend/app/services/testcase_improver.py:116-134`
- Test: `backend/tests/test_testcase_analyzer.py`, `backend/tests/test_testcase_improver.py`

**Interfaces:**
- Consumes: `analyze_testcase_with_llm(clean_testcase, enabled_rules, language)`, `improve_testcase_with_llm(testcase, selected_issues, language)` from Task 8.
- Produces: `analyze_raw_testcase(raw_content, work_item, enabled_rules=None, language="ru")`, `improve_testcase(raw_content, work_item, selected_issues, language="ru")` — both gain `language` — already called with `language=body.language` from Task 5's `routes.py` changes.

- [ ] **Step 1: Write the failing tests**

Check the existing mocking pattern in `backend/tests/test_testcase_analyzer.py` (it already patches `app.services.testcase_analyzer.analyze_testcase_with_llm`) and add:

```python
def test_analyze_raw_testcase_passes_language(monkeypatch):
    captured = {}
    def fake_llm(clean_testcase, enabled_rules=None, language="ru"):
        captured["language"] = language
        from app.schemas.analysis import ReviewResult
        return ReviewResult(summary="s", issues=[], warnings=[])
    monkeypatch.setattr("app.services.testcase_analyzer.analyze_testcase_with_llm", fake_llm)
    analyze_raw_testcase(raw_content=None, work_item={"name": "x", "steps": []}, language="en")
    assert captured["language"] == "en"
```

And in `backend/tests/test_testcase_improver.py`, using the existing `MOCK_LLM_RESULT`/`patch` pattern already in the file:

```python
def test_improve_passes_language_to_llm(monkeypatch):
    captured = {}
    def fake_llm(testcase, selected_issues, language="ru"):
        captured["language"] = language
        return MOCK_LLM_RESULT
    monkeypatch.setattr("app.services.testcase_improver.improve_testcase_with_llm", fake_llm)
    improve_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, selected_issues=SELECTED_ISSUES, language="en")
    assert captured["language"] == "en"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_testcase_analyzer.py tests/test_testcase_improver.py -v -k passes_language`
Expected: FAIL — `TypeError: analyze_raw_testcase() got an unexpected keyword argument 'language'` (and similarly for `improve_testcase`)

- [ ] **Step 3: Update `testcase_analyzer.py`**

Current:

```python
def analyze_raw_testcase(
    raw_content: str | None,
    work_item: dict | None,
    enabled_rules: list[str] | None = None,
) -> AnalyzeTestCaseResponse:
    if raw_content is None and work_item is None:
        raise ValueError("Provide raw_content or work_item")

    if work_item is not None:
        normalized = normalize_testit_workitem(work_item)
    else:
        normalized = parse_testit_content(raw_content)  # type: ignore[arg-type]

    clean_dict = normalized.model_dump()
    llm_result: ReviewResult = analyze_testcase_with_llm(
        clean_dict,
        enabled_rules=enabled_rules,
    )
```

Change to:

```python
def analyze_raw_testcase(
    raw_content: str | None,
    work_item: dict | None,
    enabled_rules: list[str] | None = None,
    language: str = "ru",
) -> AnalyzeTestCaseResponse:
    if raw_content is None and work_item is None:
        raise ValueError("Provide raw_content or work_item")

    if work_item is not None:
        normalized = normalize_testit_workitem(work_item)
    else:
        normalized = parse_testit_content(raw_content)  # type: ignore[arg-type]

    clean_dict = normalized.model_dump()
    llm_result: ReviewResult = analyze_testcase_with_llm(
        clean_dict,
        enabled_rules=enabled_rules,
        language=language,
    )
```

(the rest of the function — building `all_warnings`, `_dedupe_test_data_crossover`, `_dedupe_false_positive_test_data_on_click_steps`, the final `return AnalyzeTestCaseResponse(...)` — is unchanged)

- [ ] **Step 4: Update `testcase_improver.py`**

Current:

```python
def improve_testcase(
    raw_content: str | None,
    work_item: dict | None,
    selected_issues: list[dict],
) -> ImproveTestCaseResponse:
    if raw_content is None and work_item is None:
        raise ValueError("Provide raw_content or work_item")

    if work_item is not None:
        normalized = normalize_testit_workitem(work_item)
    else:
        normalized = parse_testit_content(raw_content)  # type: ignore[arg-type]

    clean_dict = normalized.model_dump()
    llm_result: ImproveResult = improve_testcase_with_llm(
        clean_dict,
        selected_issues,
    )
```

Change to:

```python
def improve_testcase(
    raw_content: str | None,
    work_item: dict | None,
    selected_issues: list[dict],
    language: str = "ru",
) -> ImproveTestCaseResponse:
    if raw_content is None and work_item is None:
        raise ValueError("Provide raw_content or work_item")

    if work_item is not None:
        normalized = normalize_testit_workitem(work_item)
    else:
        normalized = parse_testit_content(raw_content)  # type: ignore[arg-type]

    clean_dict = normalized.model_dump()
    llm_result: ImproveResult = improve_testcase_with_llm(
        clean_dict,
        selected_issues,
        language=language,
    )
```

(the rest of the function — postprocessing, `_restore_untouched_fields`, diff building, the final `return ImproveTestCaseResponse(...)` — is unchanged)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_testcase_analyzer.py tests/test_testcase_improver.py -v`
Expected: all pass

- [ ] **Step 6: Run the full suite — this closes out the entire backend phase**

Run: `cd backend && source venv/bin/activate && python -m pytest`
Expected: all pass, 0 failures

- [ ] **Step 7: Commit**

```bash
cd backend
git add app/services/testcase_analyzer.py app/services/testcase_improver.py tests/test_testcase_analyzer.py tests/test_testcase_improver.py
git commit -m "feat: thread language parameter through analyze/improve service entry points"
```

- [ ] **Step 8: Manual smoke test against the live backend**

With the backend running (`docker compose up` or the dev server), confirm the language now actually changes LLM output end-to-end:

```bash
curl -sS -X POST http://localhost:8000/api/analyze-testcase \
  -H "Content-Type: application/json" \
  -d '{"work_item": {"name": "Успешный вход", "steps": [{"action": "Открыть страницу входа", "expected": "Страница загружена"}]}, "language": "en"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['summary'])"
```

Expected: the printed `summary` is in English even though the source test case (`name`/`steps`) is in Russian. Repeat with `"language": "ru"` on an English source test case and confirm the summary comes back in Russian.

---

## Task 10: Frontend i18n scaffolding

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/i18n/index.ts`
- Create: `frontend/src/i18n/locales/en.json`
- Create: `frontend/src/i18n/locales/ru.json`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Produces: importing `"./i18n"` once (in `main.tsx`) initializes a global `i18next` instance; every later component uses `useTranslation()` from `react-i18next` to get `t()`. The instance is also importable directly as `import i18n from '../i18n'` for non-hook contexts (Task 11's language toggle, Task 12's `api.ts`, Task 15's class-component `ErrorBoundary`).

- [ ] **Step 1: Install dependencies**

Run: `cd frontend && npm install i18next react-i18next`
Expected: `package.json` `dependencies` gains `i18next` and `react-i18next` entries; `package-lock.json` updates.

- [ ] **Step 2: Create the seed locale files**

```json
// frontend/src/i18n/locales/en.json
{
  "sidebar": {
    "brandName": "QA AI Tools",
    "brandSub": "AI Review Workspace",
    "toolsLabel": "Tools",
    "reviewImprove": "Review & Improve",
    "reviewImproveSub": "test cases",
    "testRunner": "Test Runner",
    "testRunnerSub": "run test cases in browser",
    "generate": "Generate",
    "generateSub": "test cases",
    "soon": "Soon",
    "settings": "Settings",
    "collapse": "Collapse",
    "language": "Language"
  },
  "common": {
    "apply": "Apply",
    "reset": "Reset",
    "loading": "Loading..."
  }
}
```

```json
// frontend/src/i18n/locales/ru.json
{
  "sidebar": {
    "brandName": "QA AI Tools",
    "brandSub": "AI Review Workspace",
    "toolsLabel": "Инструменты",
    "reviewImprove": "Ревью и улучшение",
    "reviewImproveSub": "тест-кейсов",
    "testRunner": "Тест-раннер",
    "testRunnerSub": "запуск тест-кейсов в браузере",
    "generate": "Генерация",
    "generateSub": "тест-кейсов",
    "soon": "Скоро",
    "settings": "Настройки",
    "collapse": "Свернуть",
    "language": "Язык"
  },
  "common": {
    "apply": "Применить",
    "reset": "Сбросить",
    "loading": "Загрузка..."
  }
}
```

(Later tasks add more keys to both files under new top-level sections — `actionBanner`, `errorBoundary`, `modeButton`, `rulesModal`, `sourcePanel`, `app`, `workbench`, `runner` — always adding the same key to both files in the same commit, since `i18next` silently falls back to the key string itself for a missing translation and that's a defect, not a feature, in this project.)

- [ ] **Step 3: Create the i18n init module**

```typescript
// frontend/src/i18n/index.ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ru from './locales/ru.json'

const STORAGE_KEY = 'qa-ai-tool:language'

function initialLanguage(): 'ru' | 'en' {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'en' ? 'en' : 'ru'
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    lng: initialLanguage(),
    fallbackLng: 'ru',
    interpolation: { escapeValue: false },
  })

export function setLanguage(lng: 'ru' | 'en'): void {
  i18n.changeLanguage(lng)
  localStorage.setItem(STORAGE_KEY, lng)
}

export default i18n
```

- [ ] **Step 4: Import the init module once at app startup**

Read `frontend/src/main.tsx` first to see its exact current imports, then add `import './i18n'` as the first import (before `App` is rendered) so `i18next` is initialized before any component mounts.

- [ ] **Step 5: Verify it builds**

Run: `cd frontend && npm run build`
Expected: build succeeds with no TypeScript errors (nothing consumes `useTranslation()` yet, so this just proves the module wiring is valid)

- [ ] **Step 6: Commit**

```bash
cd frontend
git add package.json package-lock.json src/i18n/ src/main.tsx
git commit -m "feat: add i18next scaffolding for ru/en localization"
```

---

## Task 11: Language toggle in `Sidebar.tsx`

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx` (full file — 78 lines, shown below)

**Interfaces:**
- Consumes: `useTranslation()` from `react-i18next`, `setLanguage` + default export from `../i18n` (Task 10).
- Produces: nothing new for later tasks — this is a leaf UI change, but establishes the pattern (`useTranslation()` + `t('namespace.key')`) every later component task follows.

- [ ] **Step 1: Rewrite the file**

```tsx
import { ChevronLeft, ChevronRight, FileCheck2, MonitorPlay, Sparkles, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n, { setLanguage } from '../i18n'

type Tool = 'review' | 'runner'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  activeTool: Tool
  onToolChange: (tool: Tool) => void
}


export function Sidebar({ collapsed, onToggle, activeTool, onToolChange }: SidebarProps) {
  const { t } = useTranslation()

  return (
    <aside className={`sidebar${collapsed ? ' sb-collapsed' : ''}`}>
      <div className="sb-logo">
        <div className="sb-mark"><span>QA</span></div>
        <div className="sb-brand">
          <span className="sb-brand-name">{t('sidebar.brandName')}</span>
          <span className="sb-brand-sub">{t('sidebar.brandSub')}</span>
        </div>
      </div>
      <div className="sb-section">
        <span className="sb-section-label">{t('sidebar.toolsLabel')}</span>
      </div>
      <nav className="sb-nav">
        <div
          className={`sb-item${activeTool === 'review' ? ' sb-item-active' : ''}`}
          onClick={() => onToolChange('review')}
          style={{ cursor: 'pointer' }}
        >
          <div className="sb-icon"><FileCheck2 size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">{t('sidebar.reviewImprove')}</span>
            <span className="sb-sub">{t('sidebar.reviewImproveSub')}</span>
          </div>
        </div>
        <div
          className={`sb-item${activeTool === 'runner' ? ' sb-item-active' : ''}`}
          onClick={() => onToolChange('runner')}
          style={{ cursor: 'pointer' }}
        >
          <div className="sb-icon"><MonitorPlay size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">{t('sidebar.testRunner')}</span>
            <span className="sb-sub">{t('sidebar.testRunnerSub')}</span>
          </div>
        </div>
        <div className="sb-item sb-item-soon">
          <div className="sb-icon"><Sparkles size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">{t('sidebar.generate')}</span>
            <span className="sb-sub">{t('sidebar.generateSub')}</span>
          </div>
          <span className="sb-badge">{t('sidebar.soon')}</span>
        </div>

      </nav>
      <div className="sb-divider" />
      <div className="sb-bottom">
        <div className="sb-item sb-item-lang" style={{ cursor: 'default' }}>
          <div className="sb-copy"><span className="sb-title">{t('sidebar.language')}</span></div>
          <div className="sb-lang-switch">
            <button
              type="button"
              className={`sb-lang-btn${i18n.language === 'ru' ? ' active' : ''}`}
              onClick={() => setLanguage('ru')}
            >
              RU
            </button>
            <button
              type="button"
              className={`sb-lang-btn${i18n.language === 'en' ? ' active' : ''}`}
              onClick={() => setLanguage('en')}
            >
              EN
            </button>
          </div>
        </div>
        <div className="sb-item sb-item-soon">
          <div className="sb-icon"><Settings size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy"><span className="sb-title">{t('sidebar.settings')}</span></div>
          <span className="sb-badge">{t('sidebar.soon')}</span>
        </div>
        <button type="button" className="sb-item" onClick={onToggle}>
          <div className="sb-icon">
            {collapsed
              ? <ChevronRight size={16} strokeWidth={1.75} />
              : <ChevronLeft size={16} strokeWidth={1.75} />
            }
          </div>
          <div className="sb-copy"><span className="sb-title">{t('sidebar.collapse')}</span></div>
        </button>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Add minimal CSS for the new toggle**

Read `frontend/src/index.css` to find the existing `.sb-item`/`.sb-badge` rules and add nearby, matching the file's existing naming/spacing conventions:

```css
.sb-lang-switch { display: flex; gap: 4px; }
.sb-lang-btn {
  border: 1px solid var(--bd-default, #333);
  background: transparent;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  color: var(--tx-muted);
}
.sb-lang-btn.active {
  background: var(--tx-primary, #fff);
  color: var(--bg-primary, #000);
}
```

(Check `index.css` for the actual CSS variable names in use — `--bd-default`, `--tx-primary`, `--bg-primary` are guesses based on the `--tx-primary`/`--tx-muted`/`--tx-dim` variables already seen in `ErrorBoundary.tsx`; use whatever the file actually defines, with the same fallback-value pattern if a variable doesn't exist.)

- [ ] **Step 3: Manual verification**

Run: `cd frontend && npm run dev`, open the app in a browser.
Expected: Sidebar shows an RU/EN toggle in the bottom section; clicking EN changes "Ревью и улучшение" → "Review & Improve" (and vice versa) immediately, and reloading the page keeps the last-picked language (persisted via `localStorage`).

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/Sidebar.tsx src/index.css
git commit -m "feat: add RU/EN language toggle to Sidebar"
```

---

## Task 12: Wire `language` into `api.ts`, simplify the error-humanizing functions

**Files:**
- Modify: `frontend/src/api.ts` (full file — 104 lines, shown below)

**Interfaces:**
- Consumes: `i18n` default export from `../i18n` (Task 10).
- Produces: every `api.*` call whose backend endpoint accepts `language` (per Task 2) now sends the current UI language automatically; `humanizeFetchError`/`humanizeDraftError` keep their existing signatures `(msg: string) => string` so no caller needs to change.

- [ ] **Step 1: Rewrite the file**

```typescript
import type { AnalyzeResult, ApplyResult, DraftResult, FetchResult, HistoricalStep, ImproveResult, ReviewConfig, ReviewIssue, ReviewRuleId, RunnerRunResponse, SessionListItem } from './types'
import i18n from './i18n'

const BASE = '/api'

function currentLanguage(): 'ru' | 'en' {
  return i18n.language === 'en' ? 'en' : 'ru'
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  getReviewConfig: () => get<ReviewConfig>(`/review-config?language=${currentLanguage()}`),

  fetchWorkItem: (input: string) =>
    post<FetchResult>('/testit/workitem/fetch', { input, language: currentLanguage() }),

  improveTestCase: (body: {
    work_item?: unknown
    raw_content?: string
    selected_issues: ReviewIssue[]
    enabled_rules?: ReviewRuleId[]
  }) => post<ImproveResult>('/improve-testcase', { ...body, language: currentLanguage() }),

  analyzeTestCase: (body: {
    work_item?: unknown
    raw_content?: string
    enabled_rules?: ReviewRuleId[]
  }) =>
    post<AnalyzeResult>('/analyze-testcase', { ...body, language: currentLanguage() }),

  createDraft: (body: {
    improved_testcase: unknown
    source_work_item_id: string
    source_attributes: Record<string, unknown>
    manual_notes?: string[]
  }) => post<DraftResult>('/testit/workitem/create-draft', { ...body, language: currentLanguage() }),

  applyToOriginal: (body: {
    improved_testcase: unknown
    source_work_item_id: string
    source_attributes: Record<string, unknown>
  }) => post<ApplyResult>('/testit/workitem/update-original', { ...body, language: currentLanguage() }),

  runTestCase: (work_item_id: string) =>
    post<RunnerRunResponse>('/runner/run', { work_item_id }),

  runManual: (body: { task: string; start_url?: string; test_case_id?: string }) =>
    post<RunnerRunResponse>('/runner/run-manual', body),

  startManualStreaming: (body: { task: string; start_url?: string }) =>
    post<{ run_id: string }>('/runner/start-manual', body),

  startTestItStreaming: (work_item_id: string) =>
    post<{ run_id: string }>('/runner/start-testit', { work_item_id }),

  listSessions: () =>
    get<{ sessions: SessionListItem[] }>('/runner/sessions'),

  getSessionSteps: (runId: string) =>
    get<{ steps: HistoricalStep[] }>(`/runner/sessions/${runId}/steps`),

}

// Backend errors from Task 5 onward are already localized in the current UI
// language — these functions now only strip the "HTTP xxx: " prefix so the
// user doesn't see raw HTTP jargon, and add HTTP-status-code-based framing
// where useful (status codes are language-independent, unlike the phrase-
// matching this used to do against the backend's — now localized — text).
function stripHttpPrefix(msg: string): string {
  const match = msg.match(/^HTTP \d+: (.*)$/s)
  return match ? match[1] : msg
}

export function humanizeFetchError(msg: string): string {
  return stripHttpPrefix(msg)
}

export function humanizeDraftError(msg: string): string {
  return stripHttpPrefix(msg)
}
```

Note: `runTestCase`/`runManual`/`startManualStreaming`/`startTestItStreaming`/`listSessions`/`getSessionSteps` are `/runner/*` calls — per the Global Constraints, runner stays English-only for errors in this pass, so these do **not** get a `language` field added.

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build`
Expected: build succeeds

- [ ] **Step 3: Manual verification**

With the backend running and Task 5-9 deployed, toggle the Sidebar language to EN, fetch a Russian-language test case by ID, and confirm the browser Network tab shows `language: "en"` in the POST body for `/api/testit/workitem/fetch` and `/api/analyze-testcase`.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/api.ts
git commit -m "feat: attach selected language to backend requests, simplify error humanizing"
```

---

## Task 13: `ActionBanner.tsx`

**Files:**
- Modify: `frontend/src/components/ActionBanner.tsx` (full file — 75 lines, shown below)

**Interfaces:**
- Consumes: `useTranslation()` (established in Task 11).

- [ ] **Step 1: Add the keys**

Add to `frontend/src/i18n/locales/en.json` (new top-level section):

```json
"actionBanner": {
  "appliedToOriginal": "Applied to original",
  "draftCreatedIn": "Draft created in section \"{{sectionName}}\"",
  "stillNeedsWork": "case still needs work",
  "openInTestIt": "Open in TestIT",
  "dismiss": "Dismiss"
}
```

Add to `frontend/src/i18n/locales/ru.json`:

```json
"actionBanner": {
  "appliedToOriginal": "Применено к оригиналу",
  "draftCreatedIn": "Черновик создан в разделе «{{sectionName}}»",
  "stillNeedsWork": "кейс всё ещё требует доработки",
  "openInTestIt": "Открыть в TestIT",
  "dismiss": "Скрыть"
}
```

- [ ] **Step 2: Rewrite the component**

```tsx
import { useEffect, useState } from 'react'
import { CheckCircle2, FilePlus, ExternalLink, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ActionNotification } from '../types'

interface Props {
  notifications: ActionNotification[]
}

const EXIT_MS = 180

export function ActionBanner({ notifications }: Props) {
  if (notifications.length === 0) return null
  return (
    <div className="action-banner">
      {notifications.map(n => (
        <BannerRow key={`${n.type}-${n.id}`} notification={n} />
      ))}
    </div>
  )
}

// Stays until the user dismisses it — it carries the "Open in TestIT" link,
// so it must not disappear before the user has had a chance to click it.
// Keyed by `${type}-${id}` in the parent, so a fresh draft/apply result (new id)
// always mounts a new instance and starts un-dismissed.
function BannerRow({ notification: n }: { notification: ActionNotification }) {
  const { t } = useTranslation()
  const [closing, setClosing] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!closing) return
    const timer = setTimeout(() => setDismissed(true), EXIT_MS)
    return () => clearTimeout(timer)
  }, [closing])

  if (dismissed) return null

  return (
    <div
      className={`action-banner-row${n.isPartial ? ' action-banner-row--partial' : ''}${closing ? ' action-banner-row--closing' : ''}`}
    >
      <span className="action-banner-icon">
        {n.type === 'apply'
          ? <CheckCircle2 size={14} strokeWidth={2} />
          : <FilePlus size={14} strokeWidth={2} />}
      </span>
      <span className="action-banner-text">
        {n.type === 'apply'
          ? <>{t('actionBanner.appliedToOriginal')} · <strong>#{n.id}</strong></>
          : <>{t('actionBanner.draftCreatedIn', { sectionName: n.sectionName })} · <strong>#{n.id}</strong></>}
        {n.isPartial && <span className="action-banner-partial"> · {t('actionBanner.stillNeedsWork')}</span>}
        {n.testit_url && (
          <a
            className="action-banner-link"
            href={n.testit_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {' · '}{t('actionBanner.openInTestIt')}
            <ExternalLink size={11} strokeWidth={2} style={{ marginLeft: 3, verticalAlign: 'middle' }} />
          </a>
        )}
      </span>
      <button
        type="button"
        className="action-banner-close"
        onClick={() => setClosing(true)}
        aria-label={t('actionBanner.dismiss')}
        title={t('actionBanner.dismiss')}
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build`
Expected: build succeeds

- [ ] **Step 3: Manual verification**

Trigger a "Create draft" and an "Apply to original" action in the dev server in both languages; confirm the banner text and the "Dismiss" button's tooltip switch correctly, and that `{{sectionName}}` interpolates the real section name in both languages.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/ActionBanner.tsx src/i18n/locales/en.json src/i18n/locales/ru.json
git commit -m "feat: localize ActionBanner"
```

---

## Task 14: `ErrorBoundary.tsx` (class component — no hook)

**Files:**
- Modify: `frontend/src/components/ErrorBoundary.tsx` (full file — 37 lines, shown below)

**Interfaces:**
- Consumes: the `i18n` default export directly (not the `useTranslation()` hook — this is a class component, and hooks can't be used inside `render()` of a class; `i18n.t()` is the plain-function equivalent react-i18next exposes for exactly this situation).

- [ ] **Step 1: Add the keys**

`en.json`:
```json
"errorBoundary": {
  "title": "Something went wrong",
  "subtitle": "Try refreshing the page or navigating to another section."
}
```

`ru.json`:
```json
"errorBoundary": {
  "title": "Что-то пошло не так",
  "subtitle": "Попробуйте обновить страницу или перейти в другой раздел."
}
```

- [ ] **Step 2: Rewrite the component**

```tsx
import { Component, type ReactNode } from 'react'
import i18n from '../i18n'

interface Props { children: ReactNode }
interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100%', gap: 12, padding: 40, textAlign: 'center',
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--tx-primary)', margin: 0 }}>
            {i18n.t('errorBoundary.title')}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--tx-muted)', maxWidth: 400, margin: 0, lineHeight: 1.5 }}>
            {i18n.t('errorBoundary.subtitle')}
          </p>
          <p style={{ fontSize: 11, color: 'var(--tx-dim)', fontFamily: 'monospace', margin: 0 }}>
            {this.state.error?.message}
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build`
Expected: build succeeds

- [ ] **Step 3: Manual verification**

Temporarily throw an error in a child component to trigger the boundary (or use React DevTools' built-in error simulation), confirm the title/subtitle switch with the Sidebar's language toggle.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/ErrorBoundary.tsx src/i18n/locales/en.json src/i18n/locales/ru.json
git commit -m "feat: localize ErrorBoundary"
```

---

## Task 15: `ModeButton.tsx`

**Files:**
- Modify: `frontend/src/components/ModeButton.tsx` (full file — 134 lines, shown below)

**Interfaces:**
- Consumes: `useTranslation()`. Also consumes `profile.label`/`profile.description`/`rule.label` from `ReviewConfig` — these come from the backend (Task 6) or `App.tsx`'s `FALLBACK_CONFIG` (Task 18), already localized by the time they reach this component, so this task does **not** translate them itself — only this file's own static strings ("Review mode", "rules", "Custom", "Strict review", "Apply", "All rules →").

- [ ] **Step 1: Add the keys**

`en.json`:
```json
"modeButton": {
  "custom": "Custom",
  "rulesCount": "{{count}} rules",
  "reviewMode": "Review mode",
  "activeOfTotal": "Active <1>{{active}}</1> of {{total}} rules",
  "allRules": "All rules →",
  "apply": "Apply"
}
```

`ru.json`:
```json
"modeButton": {
  "custom": "Свой набор",
  "rulesCount": "{{count}} правил",
  "reviewMode": "Режим ревью",
  "activeOfTotal": "Активно <1>{{active}}</1> из {{total}} правил",
  "allRules": "Все правила →",
  "apply": "Применить"
}
```

(`activeOfTotal` uses i18next's `<1>` component-interpolation syntax to keep `{active}` inside a `<strong>` tag, matching the original JSX's `Active <strong>{localRules.length}</strong> of {total} rules` structure — this needs the `Trans` component from `react-i18next`, not plain `t()`, for that one line; see Step 2.)

- [ ] **Step 2: Rewrite the component**

```tsx
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Star } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { ReviewConfig, ReviewRuleId } from '../types'
import { RulesModal } from './RulesModal'

interface ModeButtonProps {
  reviewConfig: ReviewConfig
  selectedPreset: string
  enabledRules: ReviewRuleId[]
  onApply: (presetId: string, rules: ReviewRuleId[]) => void
}

export function ModeButton({ reviewConfig, selectedPreset, enabledRules, onApply }: ModeButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [localPreset, setLocalPreset] = useState(selectedPreset)
  const [localRules, setLocalRules] = useState<ReviewRuleId[]>(enabledRules)
  const [rulesModalOpen, setRulesModalOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (!open) setLocalPreset(selectedPreset) }, [selectedPreset, open])
  useEffect(() => { if (!open) setLocalRules(enabledRules) }, [enabledRules, open])

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  function selectPreset(profileId: string) {
    setLocalPreset(profileId)
    const profile = reviewConfig.profiles.find(p => p.id === profileId)
    if (profile && profile.rules.length > 0) setLocalRules(profile.rules)
  }

  function handleApply() {
    onApply(localPreset, localRules)
    setOpen(false)
  }

  function handleRulesApply(presetId: string, rules: ReviewRuleId[]) {
    setLocalRules(rules)
    setLocalPreset(presetId)
    onApply(presetId, rules)
    setRulesModalOpen(false)
  }

  const currentLabel = selectedPreset === 'custom'
    ? t('modeButton.custom')
    : (reviewConfig.profiles.find(p => p.id === selectedPreset)?.label ?? t('modeButton.custom'))

  const total = reviewConfig.rules.length

  return (
    <>
      <div className="mode-btn-wrap" ref={wrapRef}>
        <button
          type="button"
          className={`mode-btn${open ? ' open' : ''}`}
          onClick={() => setOpen(v => !v)}
        >
          <span className="mode-btn-star">
            <Star size={16} strokeWidth={1.5} style={{ fill: '#F59E0B', stroke: '#F59E0B' }} />
          </span>
          <span>{currentLabel}</span>
          <span className="mode-btn-sep" />
          <span className="mode-btn-pill">{t('modeButton.rulesCount', { count: enabledRules.length })}</span>
          <span className={`mode-btn-chevron${open ? ' open' : ''}`}>
            <ChevronDown size={16} strokeWidth={1.75} />
          </span>
        </button>

        {open && (
          <div className="review-dropdown">
            <div className="rd-header">{t('modeButton.reviewMode')}</div>

            <div className="rd-presets">
              {reviewConfig.profiles.map(profile => (
                <div
                  key={profile.id}
                  className={`rd-preset${localPreset === profile.id ? ' active' : ''}`}
                  onClick={() => selectPreset(profile.id)}
                >
                  <div className="rd-radio"><div className="rd-radio-dot" /></div>
                  <div className="rd-preset-copy">
                    <div className="rd-preset-name">{profile.label}</div>
                    {profile.description && (
                      <div className="rd-preset-desc">{profile.description}</div>
                    )}
                  </div>
                  {profile.rules.length > 0 && (
                    <span className="rd-preset-count">{t('modeButton.rulesCount', { count: profile.rules.length })}</span>
                  )}
                </div>
              ))}
            </div>

            <div className="rd-summary">
              <div className="rd-summary-line">
                <Trans i18nKey="modeButton.activeOfTotal" values={{ active: localRules.length, total }}>
                  Active <strong>{{ active: localRules.length } as any}</strong> of {{ total } as any} rules
                </Trans>
              </div>
            </div>

            <div className="rd-footer">
              <button
                type="button"
                className="rd-link"
                onClick={() => { setOpen(false); setRulesModalOpen(true) }}
              >
                {t('modeButton.allRules')}
              </button>
              <button type="button" className="rd-apply" onClick={handleApply}>{t('modeButton.apply')}</button>
            </div>
          </div>
        )}
      </div>

      {rulesModalOpen && (
        <RulesModal
          reviewConfig={reviewConfig}
          selectedPreset={localPreset}
          enabledRules={localRules}
          onApply={handleRulesApply}
          onClose={() => setRulesModalOpen(false)}
        />
      )}
    </>
  )
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build`
Expected: build succeeds. If the `Trans` component's typing on the `values`/children combination raises a TypeScript error, replace it with a simpler non-JSX interpolation instead (drop the bold styling on the count and use plain `t('modeButton.activeOfTotal', { active: localRules.length, total })` with the `<1>` markup removed from both locale files) — the bold styling on this one number is a minor visual nicety, not worth fighting `react-i18next`'s stricter `Trans` typings for.

- [ ] **Step 3: Manual verification**

Open the mode dropdown in both languages, confirm "Review mode"/"Режим ревью" header, rule counts, and the "All rules"/"Apply" buttons all switch.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/ModeButton.tsx src/i18n/locales/en.json src/i18n/locales/ru.json
git commit -m "feat: localize ModeButton"
```

---

## Task 16: `RulesModal.tsx`

**Files:**
- Modify: `frontend/src/components/RulesModal.tsx` (full file — 179 lines, shown below)

**Interfaces:**
- Consumes: `useTranslation()`. Same note as Task 15 — `profile.label`/`rule.label`/`rule.description` come pre-localized from `ReviewConfig`, not touched here.

- [ ] **Step 1: Add the keys**

`en.json`:
```json
"rulesModal": {
  "title": "Review rules",
  "selectAll": "Select all",
  "countOfTotal": "{{count}} of {{total}}",
  "descriptionNotAvailable": "Description not available.",
  "rulesSelected": "{{count}} rules selected",
  "reset": "Reset",
  "apply": "Apply"
}
```

`ru.json`:
```json
"rulesModal": {
  "title": "Правила ревью",
  "selectAll": "Выбрать всё",
  "countOfTotal": "{{count}} из {{total}}",
  "descriptionNotAvailable": "Описание недоступно.",
  "rulesSelected": "Выбрано правил: {{count}}",
  "reset": "Сбросить",
  "apply": "Применить"
}
```

- [ ] **Step 2: Rewrite the component**

```tsx
import { useEffect, useRef, useState } from 'react'
import { Check, Info, Minus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReviewConfig, ReviewRuleId } from '../types'

interface RulesModalProps {
  reviewConfig: ReviewConfig
  selectedPreset: string
  enabledRules: ReviewRuleId[]
  onApply: (presetId: string, rules: ReviewRuleId[]) => void
  onClose: () => void
}


export function RulesModal({ reviewConfig, selectedPreset, enabledRules, onApply, onClose }: RulesModalProps) {
  const { t } = useTranslation()
  const initialRules = useRef<ReviewRuleId[]>(enabledRules)
  const initialPreset = useRef<string>(selectedPreset)
  const [localRules, setLocalRules] = useState<ReviewRuleId[]>(enabledRules)
  const [localPreset, setLocalPreset] = useState<string>(selectedPreset)
  const [tooltip, setTooltip] = useState<{
    ruleId: string | null
    text: string | null
    style: React.CSSProperties
  }>({ ruleId: null, text: null, style: {} })

  const hasChanges =
    localPreset !== initialPreset.current ||
    JSON.stringify([...localRules].sort()) !== JSON.stringify([...initialRules.current].sort())

  const allRuleIds = reviewConfig.rules.map(r => r.id as ReviewRuleId)
  const checkedCount = allRuleIds.filter(id => localRules.includes(id)).length
  const allChecked = checkedCount === allRuleIds.length
  const someChecked = checkedCount > 0 && checkedCount < allRuleIds.length

  function selectPreset(profileId: string) {
    setLocalPreset(profileId)
    const profile = reviewConfig.profiles.find(p => p.id === profileId)
    if (profile && profile.rules.length > 0) setLocalRules(profile.rules)
  }

  function toggleAll() {
    setLocalPreset('custom')
    setLocalRules(allChecked || someChecked ? [] : allRuleIds)
  }

  function toggleRule(ruleId: ReviewRuleId) {
    setLocalPreset('custom')
    setLocalRules(prev =>
      prev.includes(ruleId) ? prev.filter(r => r !== ruleId) : [...prev, ruleId]
    )
  }

  function handleInfoEnter(ruleId: string, e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const wouldOverflowRight = rect.left + 260 > window.innerWidth - 20
    const x = wouldOverflowRight ? Math.max(rect.right - 260, 10) : rect.left
    const showAbove = rect.top > window.innerHeight * 0.65
    const style: React.CSSProperties = showAbove
      ? { bottom: window.innerHeight - rect.top + 6, left: x }
      : { top: rect.bottom + 6, left: x }
    const text = reviewConfig.rules.find(r => r.id === ruleId)?.description ?? t('rulesModal.descriptionNotAvailable')
    setTooltip({ ruleId, text, style })
  }

  function handleInfoLeave() {
    setTooltip({ ruleId: null, text: null, style: {} })
  }

  function handleReset() {
    setLocalRules(initialRules.current)
    setLocalPreset(initialPreset.current)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="rules-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rules-modal">
        {/* Header */}
        <div className="rules-modal-header">
          <span className="rules-modal-title">{t('rulesModal.title')}</span>
          <button type="button" className="rules-modal-close" onClick={onClose}>
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>

        {/* Preset selector */}
        <div className="rules-preset-bar">
          {reviewConfig.profiles.map(profile => (
            <button
              key={profile.id}
              type="button"
              className={`rules-preset-item${localPreset === profile.id ? ' active' : ''}`}
              onClick={() => selectPreset(profile.id)}
            >
              <span className="rules-preset-radio" />
              <span className="rules-preset-name">{profile.label}</span>
              {profile.rules.length > 0 && (
                <span className="rules-preset-count">{profile.rules.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Select all row */}
        <div className="rules-select-all-row">
          <button type="button" className="rules-select-all-btn" onClick={toggleAll}>
            <span className={`rules-cb${allChecked ? ' checked' : someChecked ? ' indeterminate' : ''}`}>
              {allChecked && <Check size={11} strokeWidth={2.5} />}
              {someChecked && <Minus size={11} strokeWidth={2.5} />}
            </span>
            <span className="rules-select-all-text">{t('rulesModal.selectAll')}</span>
          </button>
          <span className="rules-select-all-counter">{t('rulesModal.countOfTotal', { count: checkedCount, total: allRuleIds.length })}</span>
        </div>

        {/* Rules grid — two columns */}
        <div className="rules-scroll">
          <div className="rules-grid">
            {reviewConfig.rules.map(rule => {
              const checked = localRules.includes(rule.id as ReviewRuleId)
              return (
                <div key={rule.id} className="rules-row">
                  <button
                    type="button"
                    className={`rules-cb${checked ? ' checked' : ''}`}
                    onClick={() => toggleRule(rule.id as ReviewRuleId)}
                  >
                    {checked && <Check size={11} strokeWidth={2.5} />}
                  </button>
                  <span className="rules-name-wrap">
                    <span className={`rules-name${!checked ? ' rules-name-dim' : ''}`}>{rule.label}</span>
                    <button
                      type="button"
                      className="rules-info-btn"
                      onMouseEnter={e => handleInfoEnter(rule.id, e)}
                      onMouseLeave={handleInfoLeave}
                    >
                      <Info size={13} strokeWidth={1.75} />
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="rules-modal-footer">
          <span className="rules-footer-count">{t('rulesModal.rulesSelected', { count: localRules.length })}</span>
          <div className="rules-footer-actions">
            <button
              type="button"
              className="rules-btn-reset"
              disabled={!hasChanges}
              onClick={handleReset}
            >
              {t('rulesModal.reset')}
            </button>
            <button type="button" className="rules-btn-apply" onClick={() => onApply(localPreset, localRules)}>
              {t('rulesModal.apply')}
            </button>
          </div>
        </div>
      </div>

      {/* Tooltip — fixed position, outside scroll container to avoid overflow clipping */}
      {tooltip.ruleId && (
        <div className="rules-tooltip" style={tooltip.style}>
          {tooltip.text}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build`

- [ ] **Step 3: Manual verification**

Open "All rules →" from `ModeButton`, confirm header/select-all/reset/apply/footer count all switch language, and hovering the info icon on a rule with no description (shouldn't normally happen, but verify the fallback text switches too if you temporarily blank one out).

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/RulesModal.tsx src/i18n/locales/en.json src/i18n/locales/ru.json
git commit -m "feat: localize RulesModal"
```

---

## Task 17: `SourcePanel.tsx`

**Files:**
- Modify: `frontend/src/components/SourcePanel.tsx` (full file — 135 lines, shown below)

**Interfaces:**
- Consumes: `useTranslation()`.

- [ ] **Step 1: Add the keys**

`en.json`:
```json
"sourcePanel": {
  "testCaseIdLabel": "Test case ID in TestIT",
  "idPlaceholder": "e.g. 6110",
  "loading": "Loading...",
  "load": "Load",
  "error": "Error: ",
  "loaded": "Loaded: ",
  "modeLabel": "Mode",
  "rulesCount": "{{count}} rules",
  "howItWorksTitle": "How it works",
  "step1": "Load test case by ID",
  "step2": "Review issues found by AI",
  "step3": "Apply improvements",
  "whatGetsLoadedTitle": "What gets loaded",
  "whatGetsLoadedBody": "Title, description, preconditions, steps, postconditions and metadata.",
  "readOnly": "Read only",
  "reviewModeTitle": "Review mode",
  "reviewModeBody": "Checks are configured via review mode and custom rules."
}
```

`ru.json`:
```json
"sourcePanel": {
  "testCaseIdLabel": "ID тест-кейса в TestIT",
  "idPlaceholder": "например, 6110",
  "loading": "Загрузка...",
  "load": "Загрузить",
  "error": "Ошибка: ",
  "loaded": "Загружено: ",
  "modeLabel": "Режим",
  "rulesCount": "{{count}} правил",
  "howItWorksTitle": "Как это работает",
  "step1": "Загрузите тест-кейс по ID",
  "step2": "Просмотрите проблемы, найденные AI",
  "step3": "Примените улучшения",
  "whatGetsLoadedTitle": "Что загружается",
  "whatGetsLoadedBody": "Заголовок, описание, предусловия, шаги, постусловия и метаданные.",
  "readOnly": "Только чтение",
  "reviewModeTitle": "Режим ревью",
  "reviewModeBody": "Проверки настраиваются через режим ревью и кастомные правила."
}
```

- [ ] **Step 2: Rewrite the component**

```tsx
import {
  CheckCircle2, Clock3, FileText, List, Lock, Loader2, Shield, ShieldCheck, Upload, XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FetchResult } from '../types'

interface SourcePanelProps {
  testItId: string
  onTestItIdChange: (v: string) => void
  fetchLoading: boolean
  fetchResult: FetchResult | null
  fetchError: string | null
  onFetch: () => void
  presetLabel: string
  enabledRulesCount: number
}

export function SourcePanel({
  testItId, onTestItIdChange, fetchLoading, fetchResult, fetchError,
  onFetch, presetLabel, enabledRulesCount,
}: SourcePanelProps) {
  const { t } = useTranslation()
  const canFetch = testItId.trim().length > 0 && !fetchLoading

  return (
    <div className="source-panel">
      <div className="source-body">
        {/* TMS card */}
        <div className="tms-grid">
          <div className="tms-card tms-card-active">
            <div className="tms-icon">
              <img src="/icons/testit.png" width={20} height={20} alt="TestIT" style={{ objectFit: 'contain' }} />
            </div>
            <div className="tms-copy"><div className="tms-name">TestIT</div></div>
          </div>
        </div>

        {/* Input */}
        <div>
          <label className="source-label" htmlFor="testit-id">{t('sourcePanel.testCaseIdLabel')}</label>
          <div className="source-input-row">
            <input
              id="testit-id"
              className="source-id-input"
              type="text"
              placeholder={t('sourcePanel.idPlaceholder')}
              value={testItId}
              onChange={e => onTestItIdChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canFetch && onFetch()}
              spellCheck={false}
              disabled={fetchLoading}
            />
            <button
              type="button"
              className={`source-fetch-btn${!canFetch ? ' source-fetch-btn-muted' : ''}`}
              onClick={onFetch}
              disabled={!canFetch}
            >
              {fetchLoading
                ? <><Loader2 size={15} className="spinner" />{t('sourcePanel.loading')}</>
                : <><Upload size={15} />{t('sourcePanel.load')}</>
              }
            </button>
          </div>
        </div>

        {/* Error alert */}
        {fetchError && (
          <div className="alert alert-error">
            <span className="alert-icon-err"><XCircle size={16} strokeWidth={1.75} /></span>
            <span className="alert-text"><strong>{t('sourcePanel.error')}</strong>{fetchError}</span>
          </div>
        )}

        {/* Success alert */}
        {fetchResult && (
          <div className="alert alert-success">
            <span className="alert-icon-ok"><CheckCircle2 size={16} strokeWidth={1.75} /></span>
            <span className="alert-text"><strong>{t('sourcePanel.loaded')}</strong>{fetchResult.normalized_testcase.title}</span>
            <span className="alert-id">{fetchResult.work_item_id}</span>
          </div>
        )}

        {/* Status chips */}
        <div className="status-bar">
          <div className="status-chip">
            <span className="status-chip-icon"><Clock3 size={14} strokeWidth={1.75} /></span>
            <span className="status-chip-label">{t('sourcePanel.modeLabel')}</span>
            <span className="status-chip-value">{presetLabel}</span>
          </div>
          <div className="status-chip">
            <span className="status-chip-icon"><ShieldCheck size={14} strokeWidth={1.75} /></span>
            <span className="status-chip-value">{t('sourcePanel.rulesCount', { count: enabledRulesCount })}</span>
          </div>
        </div>

        {/* Info cards */}
        <div className="info-grid">
          <div className="info-card">
            <div className="info-card-title">
              <span className="info-card-title-icon"><List size={14} strokeWidth={1.75} /></span>
              {t('sourcePanel.howItWorksTitle')}
            </div>
            <div className="info-steps">
              <div className="info-step"><span className="info-step-num">1</span>{t('sourcePanel.step1')}</div>
              <div className="info-step"><span className="info-step-num">2</span>{t('sourcePanel.step2')}</div>
              <div className="info-step"><span className="info-step-num">3</span>{t('sourcePanel.step3')}</div>
            </div>
          </div>
          <div className="info-card">
            <div className="info-card-title">
              <span className="info-card-title-icon"><FileText size={14} strokeWidth={1.75} /></span>
              {t('sourcePanel.whatGetsLoadedTitle')}
            </div>
            <div className="info-card-body">
              {t('sourcePanel.whatGetsLoadedBody')}
            </div>
            <div className="info-tag">
              <Lock size={10} strokeWidth={2} />
              {t('sourcePanel.readOnly')}
            </div>
          </div>
          <div className="info-card">
            <div className="info-card-title">
              <span className="info-card-title-icon"><Shield size={14} strokeWidth={1.75} /></span>
              {t('sourcePanel.reviewModeTitle')}
            </div>
            <div className="info-card-body">
              {t('sourcePanel.reviewModeBody')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build`

- [ ] **Step 3: Manual verification**

View the empty-state source panel in both languages, confirm the input label/placeholder, Load button, the three info cards, and (by fetching a bad ID and a good ID) the error/success alerts all switch.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/SourcePanel.tsx src/i18n/locales/en.json src/i18n/locales/ru.json
git commit -m "feat: localize SourcePanel"
```

---

## Task 18: `App.tsx` (including the `FALLBACK_CONFIG` duplicate of backend rule labels)

**Files:**
- Modify: `frontend/src/App.tsx` (full file — 174 lines, shown below)

**Interfaces:**
- Consumes: `useTranslation()`, `i18n` default export from `./i18n` (to pick the right `FALLBACK_CONFIG` variant), and `api.getReviewConfig()` (Task 12, already language-aware).
- Produces: `FALLBACK_CONFIG` becomes a function `buildFallbackConfig(language)` instead of a static constant — this only matters inside this file, nothing downstream depends on the old constant name.

- [ ] **Step 1: Add the keys**

`en.json`:
```json
"app": {
  "reviewImproveTitle": "Review & Improve test cases"
}
```

`ru.json`:
```json
"app": {
  "reviewImproveTitle": "Ревью и улучшение тест-кейсов"
}
```

(`FALLBACK_CONFIG`'s own strings — profile/rule labels and descriptions — are NOT new i18n keys; they're plain data built per-language in Step 2, mirroring the `_TEXT`/`_build_config` split done in Task 6's `review_config.py`, since this is only ever shown when the backend is unreachable and doesn't need the full `t()` machinery.)

- [ ] **Step 2: Rewrite the component**

```tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, humanizeFetchError } from './api'
import { Sidebar } from './components/Sidebar'
import { RunnerView } from './components/RunnerView'
import { ModeButton } from './components/ModeButton'
import { SectionHeader } from './components/SectionHeader'
import { SourcePanel } from './components/SourcePanel'
import { Workbench } from './components/Workbench'
import { ProgressBar } from './components/ProgressBar'
import type { FetchResult, ReviewConfig, ReviewRuleId } from './types'

const DEFAULT_RULES: ReviewRuleId[] = [
  'title', 'description', 'preconditions', 'steps', 'postconditions',
  'priority', 'expected_results', 'test_data', 'tags',
  'atomicity', 'independence', 'reproducibility',
]

function buildFallbackConfig(language: string): ReviewConfig {
  const isRu = language === 'ru'
  const rule = (id: string, en: [string, string], ru: [string, string], group: string, order: number) => ({
    id, label: isRu ? ru[0] : en[0], description: isRu ? ru[1] : en[1], group, enabled: true, order,
  })
  return {
    sources: [{ id: 'testit', label: 'TestIT', enabled: true }],
    profiles: [
      {
        id: 'standard',
        label: isRu ? 'Базовая проверка' : 'Standard review',
        description: isRu ? 'Базовые проверки' : 'Basic checks',
        rules: ['title', 'description', 'preconditions', 'steps', 'expected_results', 'test_data', 'reproducibility'],
      },
      {
        id: 'strict',
        label: isRu ? 'Строгая проверка' : 'Strict review',
        description: isRu ? 'Включены все проверки' : 'All checks enabled',
        rules: DEFAULT_RULES,
      },
    ],
    rules: [
      rule('title', ['Title', 'Title is readable, not in snake_case/kebab-case, reflects the scenario.'], ['Заголовок', 'Заголовок читаем, не в snake_case/kebab-case, отражает сценарий.'], 'Case quality', 10),
      rule('description', ['Description', 'Description is present, does not duplicate the title or contradict the steps.'], ['Описание', 'Описание присутствует, не дублирует заголовок и не противоречит шагам.'], 'Case quality', 12),
      rule('preconditions', ['Preconditions', 'Preconditions describe system state, not actions. No references to other test cases.'], ['Предусловия', 'Предусловия описывают состояние системы, а не действия. Нет ссылок на другие тест-кейсы.'], 'Case quality', 15),
      rule('steps', ['Steps', 'Each step contains one action. The order of steps is logically possible.'], ['Шаги', 'Каждый шаг содержит одно действие. Порядок шагов логически возможен.'], 'Case quality', 17),
      rule('postconditions', ['Postconditions', 'The final system state after the test is described.'], ['Постусловия', 'Описано конечное состояние системы после теста.'], 'Case quality', 18),
      rule('priority', ['Priority', 'Priority matches the criticality of the scenario.'], ['Приоритет', 'Приоритет соответствует критичности сценария.'], 'Metadata', 19),
      rule('expected_results', ['Expected results', 'Each significant step has a specific expected result.'], ['Ожидаемые результаты', 'У каждого значимого шага есть конкретный ожидаемый результат.'], 'Case quality', 20),
      rule('test_data', ['Test data', 'Data is explicitly specified in a separate field, not embedded in the action text.'], ['Тестовые данные', 'Данные явно указаны в отдельном поле, а не встроены в текст действия.'], 'Case quality', 30),
      rule('tags', ['Tags', 'Tags match the case content: type, level, module.'], ['Теги', 'Теги соответствуют содержанию кейса: тип, уровень, модуль.'], 'Metadata', 40),
      rule('atomicity', ['Atomicity', 'One case contains one verification goal.'], ['Атомарность', 'Один кейс содержит одну цель проверки.'], 'Case quality', 60),
      rule('independence', ['Independence', 'Case runs in any order without dependency on other tests.'], ['Независимость', 'Кейс выполняется в любом порядке без зависимости от других тестов.'], 'Case quality', 70),
      rule('reproducibility', ['Reproducibility', 'Case can be run without verbal explanations from the author.'], ['Воспроизводимость', 'Кейс можно выполнить без устных пояснений автора.'], 'Case quality', 90),
    ],
    defaults: { testit: DEFAULT_RULES },
  }
}

export default function App() {
  const { t, i18n } = useTranslation()
  const [reviewConfig, setReviewConfig] = useState<ReviewConfig>(() => buildFallbackConfig(i18n.language))
  const [selectedPreset, setSelectedPreset] = useState('strict')
  const [enabledRules, setEnabledRules] = useState<ReviewRuleId[]>(DEFAULT_RULES)

  const [testItId, setTestItId] = useState('')
  const [fetchLoading, setFetchLoading] = useState(false)
  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeTool, setActiveTool] = useState<'review' | 'runner'>('review')

  useEffect(() => {
    api.getReviewConfig()
      .then(config => {
        setReviewConfig(config)
        setEnabledRules(config.defaults['testit'] ?? DEFAULT_RULES)
      })
      .catch(() => {
        setReviewConfig(buildFallbackConfig(i18n.language))
      })
  }, [i18n.language])

  async function handleFetch() {
    const id = testItId.trim()
    if (!id) return
    setFetchLoading(true)
    setFetchError(null)
    setFetchResult(null)
    try {
      const data = await api.fetchWorkItem(id)
      setFetchResult(data)
    } catch (err) {
      setFetchError(humanizeFetchError((err as Error).message))
    } finally {
      setFetchLoading(false)
    }
  }

  function handleTestItIdChange(v: string) {
    setTestItId(v)
    if (fetchResult || fetchError) {
      setFetchResult(null)
      setFetchError(null)
    }
  }

  const presetLabel = selectedPreset === 'custom'
    ? t('modeButton.custom')
    : (reviewConfig.profiles.find(p => p.id === selectedPreset)?.label ?? reviewConfig.profiles.find(p => p.id === 'strict')?.label ?? '')

  if (activeTool === 'runner') {
    return (
      <>
        <ProgressBar active={false} />
        <div className="app">
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed(v => !v)}
            activeTool={activeTool}
            onToolChange={tool => { setActiveTool(tool); setFetchResult(null); setFetchError(null) }}
          />
          <RunnerView />
        </div>
      </>
    )
  }

  if (fetchResult) {
    return (
      <>
        <ProgressBar active={false} />
        <div className="app">
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed(v => !v)}
            activeTool={activeTool}
            onToolChange={tool => { setActiveTool(tool); setFetchResult(null); setFetchError(null) }}
          />
          <main className="workspace workspace-wb">
            <Workbench
            fetchResult={fetchResult}
            reviewConfig={reviewConfig}
            selectedPreset={selectedPreset}
            enabledRules={enabledRules}
            onApply={(preset, rules) => { setSelectedPreset(preset); setEnabledRules(rules) }}
            onBack={() => { setFetchResult(null); setFetchError(null) }}
          />
          </main>
        </div>
      </>
    )
  }

  return (
    <>
      <ProgressBar active={fetchLoading} />
      <div className="app">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(v => !v)}
          activeTool={activeTool}
          onToolChange={tool => { setActiveTool(tool); setFetchResult(null); setFetchError(null) }}
        />
      <main className="workspace">
        <div className="workspace-inner">
          <div className="workspace-col">
            <SectionHeader
              title={t('app.reviewImproveTitle')}
              actions={
                <ModeButton
                  reviewConfig={reviewConfig}
                  selectedPreset={selectedPreset}
                  enabledRules={enabledRules}
                  onApply={(preset, rules) => { setSelectedPreset(preset); setEnabledRules(rules) }}
                />
              }
            />
            <SourcePanel
              testItId={testItId}
              onTestItIdChange={handleTestItIdChange}
              fetchLoading={fetchLoading}
              fetchResult={fetchResult}
              fetchError={fetchError}
              onFetch={handleFetch}
              presetLabel={presetLabel}
              enabledRulesCount={enabledRules.length}
            />
          </div>
        </div>
      </main>
    </div>
    </>
  )
}
```

Note the `useEffect` dependency array changed from `[]` to `[i18n.language]` — this deliberately re-fetches `/review-config` (now with the new `language` query param, per Task 12) whenever the user toggles language, so `reviewConfig.rules[].label` updates without needing a page reload. The `.catch()` fallback also rebuilds `buildFallbackConfig` with the current language for the same reason.

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build`

- [ ] **Step 3: Manual verification**

Toggle the Sidebar language on the initial (source-panel) screen — confirm the page title, and (open the mode dropdown) the profile/rule labels switch without a page reload. Stop the backend, reload, confirm the fallback config also renders in the currently-selected language.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/App.tsx src/i18n/locales/en.json src/i18n/locales/ru.json
git commit -m "feat: localize App shell, re-fetch review config on language change"
```

---

## Task 19: `Workbench.tsx` (large file — 1762 lines)

**Files:**
- Modify: `frontend/src/components/Workbench.tsx`

**Interfaces:**
- Consumes: `useTranslation()`, following the exact same `t('workbench.<key>')` pattern established in Tasks 11-18.

This file is far too large to transcribe in full here (unlike Tasks 11-18, which included complete file rewrites). Follow this procedure instead — it's the same mechanical transformation as every prior component task, just applied file-by-file rather than pasted in full:

- [ ] **Step 1: Enumerate every hardcoded UI string in the file**

Run: `cd frontend && grep -noE '>[A-Za-zА-Яа-яЁё][^<{}]{1,80}<' src/components/Workbench.tsx | head -100`

This finds JSX text nodes (text directly between tags). Also check for hardcoded strings in these positions, which the grep above won't catch:
- `placeholder="..."`, `title="..."`, `aria-label="..."` JSX attributes
- String literals passed to `setXError(...)`/similar state setters as fallback/static messages (not ones that just pass through a caught error's `.message`)
- Button/label text built via template literals or ternaries (e.g. `condition ? 'Foo' : 'Bar'`)

Run: `cd frontend && grep -noE '(placeholder|title|aria-label)="[^"]+"' src/components/Workbench.tsx`

- [ ] **Step 2: Add every found string to both locale files under a new `"workbench"` section**

Follow the exact naming convention from Tasks 13-18: one key per string, camelCase, grouped by the UI area it belongs to (e.g. `workbench.tabs.review`, `workbench.tabs.improved`, `workbench.actions.createDraft`, `workbench.actions.applyToOriginal`, `workbench.issues.severityHigh`, etc. — the precise names depend on what Step 1 finds; pick names that describe the string's UI role, not its English text). Add the Russian translation for each in the same commit — an English-only key with no Russian counterpart is a defect per this plan's Global Constraints.

For any string that's built with a count or a dynamic value (matching the `{{count}}`/`{{sectionName}}` pattern from Tasks 13/17), use i18next's `{{variable}}` interpolation exactly as in those tasks, not string concatenation.

- [ ] **Step 3: Add `const { t } = useTranslation()` at the top of the component function, and replace every string found in Step 1 with `t('workbench.<key>')` (or `t('workbench.<key>', { ...vars })` for interpolated ones)**

If `Workbench.tsx` defines more than one component in the file (check — some files in this codebase, like `ActionBanner.tsx`, define a helper component below the main export), each function component that renders translated text needs its own `useTranslation()` call — hooks can't be shared across separate function components, each call is cheap and reads from the same global i18next instance.

- [ ] **Step 4: Verify no hardcoded UI text remains**

Run: `cd frontend && grep -noE '>[A-Za-zА-Яа-яЁё][^<{}]{1,80}<' src/components/Workbench.tsx`

Expected: empty output, or only matches that are clearly not user-facing (e.g. a `console.log` string, a CSS class name that happens to look like a word, code-block content that's meant to stay literal like a JSON example — inspect any remaining match and confirm it's not something a user reads in the rendered UI before leaving it as-is).

- [ ] **Step 5: Verify it builds**

Run: `cd frontend && npm run build`
Expected: build succeeds with no TypeScript errors

- [ ] **Step 6: Manual verification**

Run: `cd frontend && npm run dev`. Load a test case, run Review, run Improve, open every tab/panel/dropdown/modal reachable from this component, in both RU and EN — confirm every piece of visible text switches language and no text reads as a raw `workbench.someKey` (that would mean a key exists in code but is missing from one of the two JSON files — check both `en.json` and `ru.json` have it).

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/components/Workbench.tsx src/i18n/locales/en.json src/i18n/locales/ru.json
git commit -m "feat: localize Workbench"
```

---

## Task 20: `RunnerView.tsx` (large file — 644 lines)

**Files:**
- Modify: `frontend/src/components/RunnerView.tsx`

**Interfaces:**
- Consumes: `useTranslation()`, same pattern as Task 19.

- [ ] **Step 1: Enumerate every hardcoded UI string**

Run: `cd frontend && grep -noE '>[A-Za-zА-Яа-яЁё][^<{}]{1,80}<' src/components/RunnerView.tsx`
Run: `cd frontend && grep -noE '(placeholder|title|aria-label)="[^"]+"' src/components/RunnerView.tsx`

- [ ] **Step 2: Add every found string to both locale files under a new `"runnerView"` section**

Same convention as Task 19 — camelCase keys grouped by UI area, both languages added in the same commit.

- [ ] **Step 3: Add `useTranslation()` and replace every found string with `t('runnerView.<key>', ...)`**

- [ ] **Step 4: Verify no hardcoded UI text remains**

Run: `cd frontend && grep -noE '>[A-Za-zА-Яа-яЁё][^<{}]{1,80}<' src/components/RunnerView.tsx`
Expected: empty, or only clearly-non-user-facing matches.

- [ ] **Step 5: Verify it builds**

Run: `cd frontend && npm run build`

- [ ] **Step 6: Manual verification**

Switch to the Test Runner tool in the Sidebar, in both languages, confirm every visible string switches. Note: per this plan's Global Constraints, the runner's *backend* error messages are NOT localized in this pass (they come from `/runner/*` endpoints, out of scope) — this task only translates the static UI chrome around them (labels, buttons, headers); a raw English error message surfacing from the runner backend while the UI is set to RU is expected and correct per scope, not a bug to chase here.

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/components/RunnerView.tsx src/i18n/locales/en.json src/i18n/locales/ru.json
git commit -m "feat: localize RunnerView"
```

---

## Task 21: `RunnerSessionView.tsx` (large file — 1176 lines)

**Files:**
- Modify: `frontend/src/components/RunnerSessionView.tsx`

**Interfaces:**
- Consumes: `useTranslation()`, same pattern as Tasks 19-20.

- [ ] **Step 1: Enumerate every hardcoded UI string**

Run: `cd frontend && grep -noE '>[A-Za-zА-Яа-яЁё][^<{}]{1,80}<' src/components/RunnerSessionView.tsx`
Run: `cd frontend && grep -noE '(placeholder|title|aria-label)="[^"]+"' src/components/RunnerSessionView.tsx`

- [ ] **Step 2: Add every found string to both locale files under a new `"runnerSession"` section**

Same convention as Tasks 19-20.

- [ ] **Step 3: Add `useTranslation()` and replace every found string with `t('runnerSession.<key>', ...)`**

If this file streams live text from the backend (step descriptions, agent reasoning, log lines over the WebSocket) — check for this — that streamed content is backend-generated runtime data, not static UI copy, and is explicitly out of scope (runner subsystem) per the Global Constraints; only this file's own static labels/headers/buttons get translated, not data flowing through the WebSocket.

- [ ] **Step 4: Verify no hardcoded UI text remains**

Run: `cd frontend && grep -noE '>[A-Za-zА-Яа-яЁё][^<{}]{1,80}<' src/components/RunnerSessionView.tsx`
Expected: empty, or only clearly-non-user-facing matches, or matches that are confirmed backend-streamed runtime data (not static copy) per Step 3's note.

- [ ] **Step 5: Verify it builds**

Run: `cd frontend && npm run build`

- [ ] **Step 6: Manual verification**

Start a runner session (manual or against a TestIT test case), watch it live, in both languages — confirm all static UI chrome (headers, buttons, status labels, tab names) switches language while the live agent/step content itself is unaffected (expected, per scope).

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/components/RunnerSessionView.tsx src/i18n/locales/en.json src/i18n/locales/ru.json
git commit -m "feat: localize RunnerSessionView"
```

---

## Final check: full-project verification

- [ ] **Step 1: Full backend test suite**

Run: `cd backend && source venv/bin/activate && python -m pytest`
Expected: all tests pass (231 original + new tests added across Tasks 1-9)

- [ ] **Step 2: Full frontend build**

Run: `cd frontend && npm run build`
Expected: succeeds with no TypeScript errors

- [ ] **Step 3: End-to-end manual pass**

With both backend and frontend running (`make dev` or `docker compose up`):
1. Load the app fresh (clear `localStorage` first) — confirm it defaults to Russian.
2. Toggle to English in the Sidebar — confirm the whole shell (Sidebar, SourcePanel, ModeButton, RulesModal) is in English.
3. Load a Russian-language test case by ID, run Review — confirm the summary/issues come back in English (translated, not source-matched).
4. Run Improve with the found issues selected — confirm the improved test case's title/steps/preconditions are translated to English, and `manual_notes`/`improvement_notes` are in English.
5. Deliberately break the TestIT token (e.g. temporarily point `TESTIT_PRIVATE_TOKEN` at a bad value and restart the backend) and trigger a fetch — confirm the error banner is in English.
6. Toggle back to Russian, reload the page — confirm the choice persisted and everything (including a fresh Review/Improve run and a fresh error) is now in Russian.
7. Switch to the Test Runner tool, confirm its UI chrome matches the selected language in both directions.

- [ ] **Step 4: Update CLAUDE.md if the localization approach introduces a pattern worth documenting for future TMS work**

Check `CLAUDE.md`'s "TMS integrations" section (added during the earlier `app/tms/` refactor) — if a second TMS is added later, its error messages will need the same `errors_i18n.py` code+params pattern; add one sentence noting this convention exists, in the same section, so it isn't rediscovered from scratch.
