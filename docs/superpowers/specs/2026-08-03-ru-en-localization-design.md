# RU/EN Localization — Design

## Goal

Add an explicit RU/EN language toggle to qa-ai-tool. When EN is selected, everything the
user sees is in English — UI chrome, LLM-generated review/improve content, and backend
error messages. When RU is selected, everything is in Russian. This replaces the current
behavior where LLM output language is auto-detected from the source test case.

## Scope

In scope:
- A `language: "ru" | "en"` setting, chosen in the UI, persisted in `localStorage`,
  default `"ru"` on first visit.
- Backend `analyze`/`improve` LLM output (summary, issue title/description/recommendation,
  improvement_notes, manual_notes) follows the selected language, not the source
  test case's language.
- Improve translates the test case content itself (title, description, steps,
  preconditions, postconditions) into the selected language when it differs from the
  source language. This is a deliberate behavior change from today's "preserve source
  language."
- Backend error messages surfaced to the user (TestIT client errors, config errors,
  service-level errors on the analyze/improve/fetch/create-draft/update-original paths)
  are localized.
- Full frontend UI chrome (buttons, labels, headers, toasts) across all 13 components.

Out of scope (explicit):
- `/runner/*` endpoints (start/run/streaming for browser-use-runner) — a separate
  subsystem with WebSocket streaming errors that don't fit the same request/response
  error model. Error messages there stay English-only in this pass.
- FastAPI's own native validation errors (malformed JSON, missing required fields —
  automatic 422 responses) are not localized; overriding FastAPI's global exception
  handler for this is disproportionate to the feature.
- `clean-testcase` / `parse_testcase_with_llm` (parsing arbitrary pasted text into a
  test case) keeps preserving the source language — it's structural extraction, not
  the tool's own commentary, and translating pasted content isn't something the user
  asked for here.
- No frontend test framework is introduced. Verification is manual.

## Backend design

### Request schemas

Add `language: Literal["ru", "en"] = "ru"` to:
- `AnalyzeTestCaseRequest`
- `ImproveTestCaseRequest`
- `FetchTestItWorkItemRequest`
- `CreateDraftRequest`
- `UpdateOriginalRequest`

Default `"ru"` keeps existing callers (tests, any external script) working unchanged.

### LLM content

- `app/core/prompt_builder.py`: `build_review_prompt` / `build_improve_prompt` gain a
  `language` parameter. The `## Language` section is no longer static file content —
  it's built at call time: "Write everything in {LANG}, regardless of the source test
  case's language" replaces the current "match the source language" instruction in
  both `review_base.md` and `improve_base.md`.
- `app/core/llm_client.py`: `analyze_testcase_with_llm` / `improve_testcase_with_llm`
  take `language` and pass it to `build_review_prompt` / `build_improve_prompt`.
- The existing language-mismatch safety net (`_source_is_russian` /
  `_rewrite_summary_language`, which currently checks the LLM's `summary` against the
  *source*'s detected language and retries once on mismatch) is repointed to check
  against the *selected* language instead. Scope stays the same as today (summary
  only) — extending the retry to every issue field individually would multiply LLM
  calls for a low-probability failure mode; the prompt instruction covers those
  fields, same as it covers the rest of `summary` today.
- `improve_testcase_with_llm`'s prompt change means Improve will now translate
  test case field content when the selected language differs from the source. This
  is intentional per user decision — the improved test case pushed back to TestIT
  should match the operator's selected language.

### Error messages

New `app/core/errors_i18n.py`:

```python
ERROR_MESSAGES: dict[str, dict[str, str]] = {
    "testit_auth_failed": {
        "en": "TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.",
        "ru": "Ошибка авторизации в TestIT. Проверьте TESTIT_PRIVATE_TOKEN.",
    },
    "testit_not_found": {
        "en": "TestIT work item not found: {id}",
        "ru": "Тест-кейс не найден в TestIT: {id}",
    },
    # ... one entry per distinct error raised on the in-scope paths
}

def localize(code: str, language: str, **params) -> str:
    """Falls back to English, then to the raw code, if a translation is missing."""
```

Existing exception classes (`TestItAuthError`, `TestItNotFoundError`,
`TestItConnectionError`, `TestItResponseError`, `TestItApiError`, `TestItConfigError`)
gain a `code: str | None = None` and `params: dict` alongside their current English
`message` (kept for logs). Raise sites in `app/tms/testit/client.py` and the
`app/tms/testit/*_service.py` files pass a code and any dynamic values (e.g.
`work_item_id`) instead of only a hardcoded English string. A raise site that isn't
updated (or a class-level default `code`, one per exception class) still works —
`localize()` falls back to the English `message` already on the exception when no
code is set, so nothing breaks mid-migration.

Translation happens at the API boundary in `app/api/routes.py`, the one place that
already has `body.language` on every in-scope request:

```python
except TestItAuthError as exc:
    raise HTTPException(status_code=401, detail=localize(exc.code, body.language, **exc.params))
```

`ValueError`/`RuntimeError` raised directly by services (e.g. "Provide raw_content or
work_item", "LLM improve unavailable: {root_cause}") get the same treatment for their
static portion; a raw upstream exception message appended for debugging (e.g. the LLM
provider's own error text) stays as-is since it's not ours to translate.

## Frontend design

- Add `i18next` + `react-i18next` (only two new deps; no language-detector plugin —
  default is a fixed `"ru"`, not browser locale).
- `src/i18n/index.ts` initializes i18next with `lng: localStorage.getItem("qa-ai-tool:language") || "ru"`,
  resources loaded from `src/i18n/locales/en.json` and `src/i18n/locales/ru.json`.
- All ~51 hardcoded strings across the 13 components move into the two JSON files;
  components switch to `useTranslation()` / `t("key")`.
- A language toggle (RU/EN) lives in `Sidebar.tsx`. On click: `i18n.changeLanguage(lng)`
  + `localStorage.setItem("qa-ai-tool:language", lng)`.
- `api.ts` reads `i18n.language` and attaches it as `language` on every request body for
  analyze/improve/fetch/create-draft/update-original calls, so components don't have to
  thread it through manually.
- Backend error `detail` strings arrive already localized (per above) — the frontend
  just displays `err.message` as it does today, no client-side translation needed for
  those.

## Testing / verification

- Backend: unit tests for `prompt_builder`'s language directive construction, for
  `errors_i18n.localize()` (known code/language, unknown code fallback to English,
  unknown language fallback to English), and for the schema defaults (`language="ru"`
  when omitted). All 231 existing tests must keep passing unchanged (new field is
  optional with a default).
- Frontend: no test framework is introduced. Manual verification: toggle RU↔EN, run
  Review and Improve on a test case in each, confirm all visible text (including a
  deliberately triggered TestIT auth/config error) switches language.
