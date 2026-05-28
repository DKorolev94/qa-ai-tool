# Prompt Architecture: Review & Improvement Redesign

## Context

Current state has critical problems:
- `_REVIEW_SCHEMA` and `_IMPROVE_SCHEMA` — 117 lines of business rules + JSON instructions hardcoded in Python
- `improve_testcase_with_llm` loads the analysis prompt file (wrong responsibility)
- No `source_type` — one prompt for TestIT and Manual
- No `instructor` — manual httpx, manual JSON parsing, no retry on bad output

## Goal

- QA-editable `.md` prompt files with zero JSON field references
- `source_type: "testit" | "manual"` routes to different review prompts
- `instructor` library handles structured output, validation, and retry
- Anti-hallucination via Pydantic schema enforcement + automatic retry

---

## Architecture

### Request Flow

```
Frontend
  { source_type: "testit"|"manual", raw_content|work_item }
       ↓
  POST /api/analyze-testcase
  POST /api/improve-testcase
       ↓
  routes.py → service layer (analyzer / improver)
       ↓
  llm_client.py
    ├── PROMPT_REGISTRY[operation][source_type] → load .md file
    ├── instructor.chat.completions.create(
    │     response_model=ReviewResult | ImproveResult,
    │     max_retries=2
    │   )
    └── instructor validates Pydantic → auto-retry with error on failure
       ↓
  ReviewResult / ImproveResult (Pydantic model)
```

### File Changes

```
backend/
  requirements.txt
    + instructor>=1.0
    + openai>=1.0            # instructor depends on openai SDK for Ollama compat

  app/core/prompts/
    review_testit.md          NEW  — QA review rules for TestIT work items
    review_manual.md          NEW  — QA review rules for free-form manual test cases
    improve.md                NEW  — improvement rules (source-agnostic)
    testcase_analyze.md       DELETE — split into review_testit.md + review_manual.md

  app/schemas/
    analysis.py               MOD  — add source_type to request models
    improvement.py            DELETE (was already deleted) — models live in analysis.py

  app/core/
    llm_client.py             REWRITE — instructor-based, PROMPT_REGISTRY, no hardcoded schemas

  app/api/
    routes.py                 MOD  — pass source_type into service calls

  app/services/
    testcase_analyzer.py      MOD  — accept + forward source_type
    testcase_improver.py      MOD  — accept + forward source_type
```

---

## Pydantic Schemas (output models — LLM must conform)

Existing `analysis.py` models are well-structured. Changes:

```python
# AnalyzeTestCaseRequest — add source_type
class AnalyzeTestCaseRequest(BaseModel):
    raw_content: str | None = None
    work_item: dict | None = None
    source_type: Literal["testit", "manual"] = "testit"

# ImproveTestCaseRequest — add source_type
class ImproveTestCaseRequest(BaseModel):
    raw_content: str | None = None
    work_item: dict | None = None
    selected_issues: list[dict] = []
    source_type: Literal["testit", "manual"] = "testit"

# LLM output models (used by instructor, not in HTTP response directly)
class ReviewResult(BaseModel):
    summary: str
    issues: list[AnalysisIssue]
    warnings: list[str] = []

class ImproveResult(BaseModel):
    improved_testcase: AnalyzedTestCase
    issue_resolutions: list[IssueResolution]
    improvement_notes: list[str] = []
    manual_notes: list[str] = []
    warnings: list[str] = []
```

---

## LLM Client Design

### PROMPT_REGISTRY

```python
_PROMPTS_DIR = Path(__file__).parent / "prompts"

PROMPT_REGISTRY: dict[str, dict[str, Path]] = {
    "review": {
        "testit": _PROMPTS_DIR / "review_testit.md",
        "manual": _PROMPTS_DIR / "review_manual.md",
    },
    "improve": {
        "testit": _PROMPTS_DIR / "improve.md",
        "manual": _PROMPTS_DIR / "improve.md",
    },
}
```

Extensible: adding a new source type = add one key per operation. No code changes to call sites.

### instructor Client Init

```python
import instructor
from openai import OpenAI

def _get_instructor_client() -> instructor.Instructor:
    openai_client = OpenAI(
        base_url=settings.LLM_BASE_URL,
        api_key=settings.LLM_API_KEY or "no-key",
    )
    # Mode.JSON works with any OpenAI-compatible API (Ollama, Deepseek, Azure)
    return instructor.from_openai(openai_client, mode=instructor.Mode.JSON)
```

### analyze_testcase

```python
def analyze_testcase_with_llm(clean_testcase: dict, source_type: str = "testit") -> ReviewResult:
    prompt = _load_prompt(PROMPT_REGISTRY["review"][source_type])
    client = _get_instructor_client()
    try:
        return client.chat.completions.create(
            model=settings.LLM_MODEL,
            response_model=ReviewResult,
            max_retries=2,
            temperature=settings.LLM_TEMPERATURE,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": f"Тест-кейс:\n\n{json.dumps(clean_testcase, ensure_ascii=False, indent=2)}"},
            ],
        )
    except Exception as exc:
        logger.warning("LLM analyze failed: %s", exc)
        return _FALLBACK_REVIEW
```

### improve_testcase

```python
def improve_testcase_with_llm(
    testcase: dict,
    selected_issues: list[dict],
    source_type: str = "testit",
) -> ImproveResult:
    prompt = _load_prompt(PROMPT_REGISTRY["improve"][source_type])
    client = _get_instructor_client()
    user_content = (
        f"Тест-кейс:\n{json.dumps(testcase, ensure_ascii=False, indent=2)}\n\n"
        f"Проблемы для исправления:\n{json.dumps(selected_issues, ensure_ascii=False, indent=2)}"
    )
    try:
        return client.chat.completions.create(
            model=settings.LLM_MODEL,
            response_model=ImproveResult,
            max_retries=2,
            temperature=settings.LLM_TEMPERATURE,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_content},
            ],
        )
    except Exception as exc:
        logger.warning("LLM improve failed: %s", exc)
        return _FALLBACK_IMPROVE
```

**What instructor eliminates:**
- Manual `httpx` call
- `response_format: {"type": "json_object"}` in payload
- `json.loads(raw_content)` + JSONDecodeError handling
- "JSON синтаксически валидный" in prompts
- All JSON format instructions in prompts

---

## Prompt File Design

### review_testit.md

Content: current `testcase_analyze.md` content (already well-written, QA rules only).
Add: TestIT-specific checks — priority field, tags validation against TestIT taxonomy, work item attributes.
Remove: nothing (already clean of JSON refs).

### review_manual.md

Content: same base rules as `review_testit.md`.
Difference: no TestIT metadata checks (no priority/tags/duration enforcement since Manual input may lack these). Focus on step quality, expected results, test data.

### improve.md

Content: improvement rules extracted from `_IMPROVE_SCHEMA` — rewritten as QA language, zero JSON refs.
Rules to carry over:
- Title: reformulate as WHAT + under WHAT condition
- Expected results: add observable state only from source data
- SQL in action: move to comments field
- Test data: use placeholders with source description if real values unknown
- Preconditions: remove action-steps, don't simplify existing
- Postconditions: add if test creates/modifies/deletes data
- Tags: max 4–5, remove irrelevant, add obvious missing
- Duration: recalculate realistically (UI ~1 min/step, API/DB ~2 min/step)
- Do NOT invent values not present in source

---

## Frontend Changes

Add `source_type` selector (radio: TestIT / Manual) to analyze and improve forms.
Default: `"testit"`.
Sent as field in request body alongside `raw_content` or `work_item`.

---

## What Gets Deleted

| File / Code | Why |
|---|---|
| `llm_client.py: _REVIEW_SCHEMA` (lines 15–44) | Moved to prompt file |
| `llm_client.py: _IMPROVE_SCHEMA` (lines 46–132) | Moved to prompt file |
| `llm_client.py: _post_chat()` | Replaced by instructor |
| `prompts/testcase_analyze.md` | Split into review_testit.md + review_manual.md |
| Manual `json.loads` + JSONDecodeError | instructor handles this |
| "JSON валидный" instructions in prompts | instructor enforces schema |

---

## Anti-Hallucination Strategy

1. **Pydantic schema** — instructor generates JSON Schema from `ReviewResult`/`ImproveResult`, passes to LLM as output contract
2. **Validation** — instructor validates every response against schema
3. **Retry** — on validation failure, instructor sends error back to LLM: "field X is required", "value must be low|medium|high" → LLM self-corrects
4. **max_retries=2** — enough for transient errors, not infinite
5. **Fallback** — after 2 failed retries, return safe fallback object (no crash)
6. **Prompt rules** — "work only with data from the source test case, never invent values"

---

## Dependencies

```
instructor>=1.0.0
openai>=1.40.0   # instructor needs openai SDK; works as HTTP adapter for any OpenAI-compatible API
```

Ollama compatibility: `instructor.Mode.JSON` uses `response_format: {"type": "json_object"}` — supported by Ollama with any model that has JSON mode.
Deepseek: same — OpenAI-compatible, `json_object` mode supported.
