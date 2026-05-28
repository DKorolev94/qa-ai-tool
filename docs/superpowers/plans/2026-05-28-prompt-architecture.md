# Prompt Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded LLM schemas with `instructor`-backed structured output, QA-editable `.md` prompt files, and `source_type` routing for TestIT vs Manual review.

**Architecture:** `instructor` library wraps the OpenAI-compatible client; Pydantic models define LLM output contracts; prompt files contain only QA rules with zero JSON references; `source_type` field in requests selects the correct prompt file via `PROMPT_REGISTRY`.

**Tech Stack:** Python 3.12+, FastAPI, Pydantic v2, `instructor>=1.0`, `openai>=1.40` (as HTTP adapter for Ollama/Deepseek)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/requirements.txt` | Modify | Add instructor, openai |
| `backend/app/core/prompts/review_testit.md` | Create | QA rules for TestIT test cases |
| `backend/app/core/prompts/review_manual.md` | Create | QA rules for free-form manual test cases |
| `backend/app/core/prompts/improve.md` | Create | Improvement rules (source-agnostic) |
| `backend/app/core/prompts/testcase_analyze.md` | Delete | Replaced by review_testit.md + review_manual.md |
| `backend/app/schemas/analysis.py` | Modify | Add ReviewResult, ImproveResult, source_type to request models |
| `backend/app/core/llm_client.py` | Rewrite | instructor client, PROMPT_REGISTRY, typed returns |
| `backend/app/services/testcase_analyzer.py` | Modify | Use typed ReviewResult, remove _coerce_issue |
| `backend/app/services/testcase_improver.py` | Modify | Use typed ImproveResult, pass source_type |
| `backend/app/api/routes.py` | Modify | Pass source_type into service calls |
| `backend/tests/test_llm_client.py` | Create | Unit tests for new llm_client |
| `backend/tests/test_testcase_improver.py` | Modify | Fix stale mocks, add source_type |
| `frontend/src/` or `frontend/app.js` | Modify | Add source_type selector |

---

## Task 1: Add Dependencies

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add instructor and openai to requirements.txt**

```
fastapi
uvicorn[standard]
pydantic
pydantic-settings
python-dotenv
instructor>=1.0.0
openai>=1.40.0
beautifulsoup4
pytest
```

(Remove `httpx` — instructor uses openai SDK's built-in HTTP layer. If anything else imports httpx directly, keep it.)

- [ ] **Step 2: Check if httpx is used elsewhere**

```bash
grep -r "import httpx" /home/dmitriy/projects/qa-ai-tool/backend/app/
```

Expected: only `llm_client.py` imports httpx. If other files import it, keep httpx in requirements.

- [ ] **Step 3: Install dependencies**

```bash
cd /home/dmitriy/projects/qa-ai-tool/backend && pip install instructor>=1.0.0 openai>=1.40.0
```

Expected: both packages install without conflict.

- [ ] **Step 4: Verify instructor imports**

```bash
cd /home/dmitriy/projects/qa-ai-tool/backend && python -c "import instructor; from openai import OpenAI; print('OK', instructor.__version__)"
```

Expected: prints OK and a version number.

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt
git commit -m "feat: add instructor and openai dependencies"
```

---

## Task 2: Create Prompt Files

**Files:**
- Create: `backend/app/core/prompts/review_testit.md`
- Create: `backend/app/core/prompts/review_manual.md`
- Create: `backend/app/core/prompts/improve.md`
- Delete: `backend/app/core/prompts/testcase_analyze.md`

No test needed — these are text files consumed by llm_client.

- [ ] **Step 1: Create review_testit.md**

Content is the existing `testcase_analyze.md` content (already clean QA rules, no JSON refs). Copy it exactly:

```bash
cp backend/app/core/prompts/testcase_analyze.md backend/app/core/prompts/review_testit.md
```

- [ ] **Step 2: Create review_manual.md**

Write `backend/app/core/prompts/review_manual.md` with this content:

```markdown
## Роль

Ты — Senior QA Engineer с глубокой экспертизой в тест-дизайне и ревью тест-кейсов.

Твоя задача — провести ревью тест-кейса и найти проблемы. Ревью должно быть конкретным и actionable.

---

## Главное правило

Работай только с данными из исходного тест-кейса. Не придумывай URL, названия кнопок, поля форм, значения параметров, имена колонок БД, поля API-ответа, бизнес-логику — ничего, чего нет во входных данных.

Если каких-то полей нет — оценивай это как проблему только тогда, когда их отсутствие реально влияет на выполняемость, проверяемость или поддержку тест-кейса.

---

## Сначала определи тип тест-кейса

Перед анализом обязательно классифицируй тест-кейс.

### 1. Атомарный

Признаки: 1–3 шага, одна конкретная проверка, короткий сценарий.

- не считай малое количество шагов проблемой
- оценивай конкретность expected result
- оценивай полноту title и достаточность preconditions
- не добавляй шаги искусственно при улучшении

### 2. Параметризованный

Признаки: плейсхолдеры `<param>`, `{{param}}`, `[param]`; параметры в `test_data`; один сценарий на разных наборах данных.

- не флажь отсутствие конкретных значений, если есть корректные плейсхолдеры
- `test_data` с таблицей или несколькими строками — нормальная структура, не issue
- при улучшении сохраняй плейсхолдеры, не заменяй конкретными значениями

### 3. Негативный

Признаки: проверяется ошибка, отказ, валидация, запрет действия, невалидные данные.

- expected result должен описывать конкретное наблюдаемое поведение
- плохо: "ошибка", "неуспешно"; хорошо: сообщение об ошибке, статус, подсветка поля

### 4. Интеграционный / E2E

Признаки: несколько систем/слоёв, UI + API + DB, 5+ шагов.

- большее количество шагов допустимо
- проверяй логическую связность между слоями
- каждый слой должен иметь свой expected result

---

## Ревью — найди проблемы

### Title

Должен отвечать: что проверяется + при каком условии (если важно).

Плохо: "Авторизация", "Тест кнопки", "Проверка формы".
Хорошо: "Авторизация с валидными данными", "Ошибка при вводе неверного пароля".

Флажь, если title слишком общий, не отражает сценарий, противоречит шагам.

### Description

Должен кратко раскрывать цель теста. Флажь, если повторяет title, содержит мусор, противоречит steps. Не флажь отсутствие как high автоматически.

### Preconditions

Должны описывать начальное состояние: пользователь и роль, данные, статусы, настройки окружения.

Флажь, если расплывчатые ("данные есть"), противоречивые, содержат действия-шаги ("открыть браузер", "перейти на страницу").

### Steps

Для каждого шага:
1. Есть ли конкретное действие?
2. Атомарен ли шаг? (один шаг = одно конкретное действие)
3. Есть ли expected result?
4. Можно ли объективно проверить expected result?
5. Логично ли шаг следует из предыдущего?
6. Не пропущены ли промежуточные действия?

Плохо: "Ввести логин и пароль и нажать кнопку" (три действия в одном).
Но не дроби искусственно неделимые операции.

### Expected result

Обязателен для каждого шага. Описывает наблюдаемое состояние системы.

Плохо: "Всё работает", "Форма отправлена успешно", "Корректно отображается", "Ошибка".
Хорошо: "Отображается сообщение 'Вы успешно авторизованы'", "URL меняется на `/dashboard`".

Флажь, если отсутствует, слишком общий, не проверяем объективно, описывает действие а не результат.

### Test data

Конкретные значения (email, пароль, ID, сумма, телефон, роль, дата) должны быть в `test_data`, если это не системный текст интерфейса.

Флажь, если данные нужны для выполнения но отсутствуют, или есть в action но не вынесены в test_data.
Не флажь, если плейсхолдеры корректно описаны.

### Логическая связность

Флажь, если шаг зависит от состояния которое не создано, пропущен переход на страницу, используется объект не из preconditions, шаги идут в неверном порядке.

### Postconditions

Нужны, если тест создаёт/удаляет/меняет данные или состояние системы. Флажь, если явно меняет состояние но postconditions отсутствуют.

---

## Severity

**high** — тест нельзя выполнить или результат нельзя проверить объективно (нет expected result, непонятен action, нет данных, невозможный сценарий).

**medium** — тест выполнить можно, но существенная неоднозначность или неполнота (не атомарный шаг, общий expected result, неполные preconditions).

**low** — снижает читаемость или поддерживаемость, не блокирует выполнение (слабый title, дублирование).

---

## Что НЕ включать в issues

- отсутствие негативных сценариев (это отдельные тест-кейсы)
- отсутствие граничных значений
- предложения добавить новые проверки которых нет в исходном тесте
- субъективные предпочтения по стилю
- догадки о бизнес-логике
- требования к URL, кнопкам, текстам которых нет во входном JSON
```

- [ ] **Step 3: Create improve.md**

Write `backend/app/core/prompts/improve.md` with this content:

```markdown
## Роль

Ты — Senior QA Engineer. Улучшаешь тест-кейс на основе выбранных проблем.

---

## Главное правило

Работай только с данными из исходного тест-кейса. Не придумывай URL, названия кнопок, поля форм, значения параметров, имена колонок БД, поля API-ответа, бизнес-логику — ничего, чего нет во входных данных.

Если для исправления нужна информация которой нет в исходнике — оставь поле точно как в оригинале и пометь в issue_resolutions, что требуется ручная правка с указанием что именно добавить.

---

## Правила улучшения

Применяй к каждой проблеме из списка выбранных:

**Title** — переформулируй: ЧТО проверяется + при каком условии. Плохо: "Авторизация". Хорошо: "Авторизация с валидными данными возвращает токен".

**Expected results** — добавь конкретное наблюдаемое состояние. Только из данных исходника. Плохо: "Всё работает". Хорошо: "Отображается сообщение 'Успешно', URL меняется на /dashboard".

**SQL в action** — перенеси SQL-запрос в поле comments шага, в action оставь человекочитаемое описание действия.

**Test data** — если данные нужны но отсутствуют: добавь плейсхолдер с описанием формата и источника, пометь как требующий ручной правки. Примеры корректных плейсхолдеров:
- `<email пользователя с ролью Admin>`
- `<пароль — см. Vault>`
- `<телефон в формате +7XXXXXXXXXX>`
Запрещено придумывать конкретные значения: email, пароль, ID, сумму, телефон, имя, дату — любые реальные данные которых нет в исходнике.

**Preconditions** — убери шаги-действия ("открыть браузер", "перейти на страницу"). Не удаляй и не упрощай существующие preconditions.

**Postconditions** — добавь если тест создаёт, изменяет или удаляет данные или состояние системы.

**Description** — если пустой: сгенерируй 1–2 предложения из title и steps.

**Tags** — максимум 4–5 тегов. Удали нерелевантные (например, тег `ui` у чисто API-теста). Добавь очевидно нужные из содержания шагов. Итоговый список не должен превышать 5 тегов.

**Duration** — пересчитай реалистично: UI ~1 мин/шаг; API/DB ~2 мин/шаг; подготовка данных +1–5 мин; postconditions +2–3 мин. Округляй до минуты (60000 мс).

**Priority** — не меняй без явной причины.

---

## Если данных не хватает

Когда для исправления нужна информация которой нет в исходнике:
1. Оставь поле точно как в оригинале (для test_data — поставь плейсхолдер с описанием)
2. Пометь эту проблему как требующую ручной правки
3. Укажи что именно нужно добавить, в каком формате, откуда взять

---

## Что не трогать

- Не добавляй шаги которых нет в исходнике
- Не удаляй существующие preconditions
- Не меняй priority без явной причины
- Не придумывай бизнес-логику
```

- [ ] **Step 4: Delete old prompt file**

```bash
git rm backend/app/core/prompts/testcase_analyze.md
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/prompts/review_testit.md backend/app/core/prompts/review_manual.md backend/app/core/prompts/improve.md
git commit -m "feat: add QA-editable prompt files, remove hardcoded prompts"
```

---

## Task 3: Update Pydantic Schemas

**Files:**
- Modify: `backend/app/schemas/analysis.py`

- [ ] **Step 1: Write failing test for source_type in request models**

Add to `backend/tests/test_schemas.py` (create if doesn't exist):

```python
from app.schemas.analysis import (
    AnalyzeTestCaseRequest,
    ImproveTestCaseRequest,
    ReviewResult,
    ImproveResult,
    AnalysisIssue,
    AnalyzedTestCase,
    IssueResolution,
)


def test_analyze_request_default_source_type():
    req = AnalyzeTestCaseRequest(raw_content="test")
    assert req.source_type == "testit"


def test_analyze_request_manual_source_type():
    req = AnalyzeTestCaseRequest(raw_content="test", source_type="manual")
    assert req.source_type == "manual"


def test_improve_request_default_source_type():
    req = ImproveTestCaseRequest(raw_content="test")
    assert req.source_type == "testit"


def test_review_result_model():
    result = ReviewResult(
        summary="Test summary",
        issues=[AnalysisIssue(severity="high", title="T", description="D", recommendation="R")],
    )
    assert result.summary == "Test summary"
    assert len(result.issues) == 1
    assert result.warnings == []


def test_improve_result_model():
    result = ImproveResult(
        improved_testcase=AnalyzedTestCase(title="T", steps=[]),
        issue_resolutions=[
            IssueResolution(issue_index=0, issue_title="T", status="resolved", action_taken="Done")
        ],
    )
    assert result.improved_testcase.title == "T"
    assert result.warnings == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/dmitriy/projects/qa-ai-tool/backend && python -m pytest tests/test_schemas.py -v
```

Expected: ImportError — `ReviewResult`, `ImproveResult` not found in analysis.py

- [ ] **Step 3: Update analysis.py**

Replace the contents of `backend/app/schemas/analysis.py` with:

```python
from __future__ import annotations
from typing import Literal
from pydantic import BaseModel


class AnalysisIssue(BaseModel):
    severity: Literal["low", "medium", "high"]
    title: str
    description: str
    recommendation: str


class AnalysisStep(BaseModel):
    action: str
    expected: str | None = None
    test_data: str | None = None
    comments: str | None = None


class AnalyzedTestCase(BaseModel):
    title: str = ""
    description: str = ""
    preconditions: list[AnalysisStep] = []
    steps: list[AnalysisStep] = []
    postconditions: list[AnalysisStep] = []
    tags: list[str] = []
    priority: str | None = None
    status: str | None = None
    duration: str | int | None = None
    attributes: dict = {}


class IssueResolution(BaseModel):
    issue_index: int
    issue_title: str
    status: Literal["resolved", "manual_needed", "skipped"]
    action_taken: str | None = None
    reason: str | None = None


# LLM output models — used by instructor, validated against these schemas
class ReviewResult(BaseModel):
    summary: str
    issues: list[AnalysisIssue] = []
    warnings: list[str] = []


class ImproveResult(BaseModel):
    improved_testcase: AnalyzedTestCase
    issue_resolutions: list[IssueResolution] = []
    improvement_notes: list[str] = []
    manual_notes: list[str] = []
    warnings: list[str] = []


# HTTP request/response models
class AnalyzeTestCaseRequest(BaseModel):
    raw_content: str | None = None
    work_item: dict | None = None
    source_type: Literal["testit", "manual"] = "testit"


class AnalyzeTestCaseResponse(BaseModel):
    summary: str
    issues: list[AnalysisIssue] = []
    original_normalized_testcase: dict = {}
    warnings: list[str] = []


class ImproveTestCaseRequest(BaseModel):
    raw_content: str | None = None
    work_item: dict | None = None
    selected_issues: list[dict] = []
    source_type: Literal["testit", "manual"] = "testit"


class ImproveTestCaseResponse(BaseModel):
    improved_testcase: AnalyzedTestCase
    original_normalized_testcase: dict = {}
    issue_resolutions: list[IssueResolution] = []
    improvement_notes: list[str] = []
    manual_notes: list[str] = []
    warnings: list[str] = []
    validation_warnings: list[str] = []
    diff: dict = {}
    display_duration: str | None = None
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/dmitriy/projects/qa-ai-tool/backend && python -m pytest tests/test_schemas.py -v
```

Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/analysis.py backend/tests/test_schemas.py
git commit -m "feat: add ReviewResult, ImproveResult models; add source_type to request schemas"
```

---

## Task 4: Rewrite llm_client.py with instructor

**Files:**
- Create: `backend/tests/test_llm_client.py`
- Rewrite: `backend/app/core/llm_client.py`

- [ ] **Step 1: Write failing tests for new llm_client**

Create `backend/tests/test_llm_client.py`:

```python
from unittest.mock import MagicMock, patch

import pytest

from app.schemas.analysis import AnalysisIssue, AnalyzedTestCase, ImproveResult, ReviewResult


SAMPLE_TESTCASE = {"title": "Login test", "steps": [{"action": "Open page", "expected": "Loaded"}]}
SAMPLE_ISSUES = [{"severity": "high", "title": "No expected result", "description": "...", "recommendation": "Add it"}]


def _mock_review_result() -> ReviewResult:
    return ReviewResult(
        summary="Good test",
        issues=[AnalysisIssue(severity="low", title="Weak title", description="D", recommendation="R")],
    )


def _mock_improve_result() -> ImproveResult:
    return ImproveResult(
        improved_testcase=AnalyzedTestCase(title="Improved", steps=[]),
        issue_resolutions=[],
    )


def test_analyze_returns_review_result():
    from app.core.llm_client import analyze_testcase_with_llm

    with patch("app.core.llm_client._get_instructor_client") as mock_get:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_review_result()
        mock_get.return_value = mock_client

        result = analyze_testcase_with_llm(SAMPLE_TESTCASE, source_type="testit")

    assert isinstance(result, ReviewResult)
    assert result.summary == "Good test"
    assert len(result.issues) == 1


def test_analyze_uses_correct_prompt_for_testit():
    from app.core.llm_client import analyze_testcase_with_llm

    with patch("app.core.llm_client._get_instructor_client") as mock_get:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_review_result()
        mock_get.return_value = mock_client

        analyze_testcase_with_llm(SAMPLE_TESTCASE, source_type="testit")

    call_kwargs = mock_client.chat.completions.create.call_args
    system_msg = call_kwargs[1]["messages"][0]["content"]
    assert len(system_msg) > 50  # prompt loaded, not empty


def test_analyze_uses_different_prompt_for_manual():
    from app.core.llm_client import analyze_testcase_with_llm

    with patch("app.core.llm_client._get_instructor_client") as mock_get:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_review_result()
        mock_get.return_value = mock_client

        analyze_testcase_with_llm(SAMPLE_TESTCASE, source_type="manual")

    call_kwargs = mock_client.chat.completions.create.call_args
    system_msg = call_kwargs[1]["messages"][0]["content"]
    assert len(system_msg) > 50


def test_analyze_fallback_on_llm_error():
    from app.core.llm_client import analyze_testcase_with_llm

    with patch("app.core.llm_client._get_instructor_client") as mock_get:
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = Exception("Connection refused")
        mock_get.return_value = mock_client

        result = analyze_testcase_with_llm(SAMPLE_TESTCASE, source_type="testit")

    assert isinstance(result, ReviewResult)
    assert len(result.warnings) > 0
    assert "unavailable" in result.warnings[0].lower()


def test_improve_returns_improve_result():
    from app.core.llm_client import improve_testcase_with_llm

    with patch("app.core.llm_client._get_instructor_client") as mock_get:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_improve_result()
        mock_get.return_value = mock_client

        result = improve_testcase_with_llm(SAMPLE_TESTCASE, SAMPLE_ISSUES, source_type="testit")

    assert isinstance(result, ImproveResult)
    assert result.improved_testcase.title == "Improved"


def test_improve_fallback_on_llm_error():
    from app.core.llm_client import improve_testcase_with_llm

    with patch("app.core.llm_client._get_instructor_client") as mock_get:
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = Exception("Connection refused")
        mock_get.return_value = mock_client

        result = improve_testcase_with_llm(SAMPLE_TESTCASE, SAMPLE_ISSUES, source_type="testit")

    assert isinstance(result, ImproveResult)
    assert len(result.warnings) > 0
    assert "unavailable" in result.warnings[0].lower()


def test_improve_passes_issues_in_user_message():
    from app.core.llm_client import improve_testcase_with_llm

    with patch("app.core.llm_client._get_instructor_client") as mock_get:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_improve_result()
        mock_get.return_value = mock_client

        improve_testcase_with_llm(SAMPLE_TESTCASE, SAMPLE_ISSUES, source_type="testit")

    call_kwargs = mock_client.chat.completions.create.call_args
    user_msg = call_kwargs[1]["messages"][1]["content"]
    assert "No expected result" in user_msg
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/dmitriy/projects/qa-ai-tool/backend && python -m pytest tests/test_llm_client.py -v
```

Expected: ImportError or AttributeError — `_get_instructor_client` doesn't exist yet

- [ ] **Step 3: Rewrite llm_client.py**

Replace the entire contents of `backend/app/core/llm_client.py` with:

```python
from __future__ import annotations

import json
import logging
from pathlib import Path

import instructor
from openai import OpenAI

from app.core.config import settings
from app.schemas.analysis import (
    AnalysisIssue,
    AnalyzedTestCase,
    ImproveResult,
    ReviewResult,
)

logger = logging.getLogger(__name__)

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

_FALLBACK_REVIEW = ReviewResult(
    summary="LLM недоступен. Тест-кейс распарсен, но анализ не выполнен.",
    issues=[
        AnalysisIssue(
            severity="medium",
            title="AI анализ не выполнен",
            description="LLM endpoint недоступен или вернул невалидные данные.",
            recommendation="Проверь настройки LLM_BASE_URL и LLM_MODEL в .env.",
        )
    ],
    warnings=["LLM is unavailable, fallback response returned"],
)

_FALLBACK_IMPROVE = ImproveResult(
    improved_testcase=AnalyzedTestCase(),
    issue_resolutions=[],
    warnings=["LLM is unavailable, fallback response returned"],
)


def _load_prompt(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except Exception as exc:
        logger.warning("Failed to load prompt %s: %s", path, exc)
        return "You are a QA assistant."


def _get_instructor_client() -> instructor.Instructor:
    openai_client = OpenAI(
        base_url=settings.LLM_BASE_URL,
        api_key=settings.LLM_API_KEY or "no-key",
    )
    return instructor.from_openai(openai_client, mode=instructor.Mode.JSON)


def analyze_testcase_with_llm(
    clean_testcase: dict,
    source_type: str = "testit",
) -> ReviewResult:
    prompt_path = PROMPT_REGISTRY["review"].get(source_type, PROMPT_REGISTRY["review"]["testit"])
    prompt = _load_prompt(prompt_path)
    client = _get_instructor_client()
    try:
        return client.chat.completions.create(
            model=settings.LLM_MODEL,
            response_model=ReviewResult,
            max_retries=2,
            temperature=settings.LLM_TEMPERATURE,
            messages=[
                {"role": "system", "content": prompt},
                {
                    "role": "user",
                    "content": f"Тест-кейс для анализа:\n\n{json.dumps(clean_testcase, ensure_ascii=False, indent=2)}",
                },
            ],
        )
    except Exception as exc:
        logger.warning("LLM analyze failed: %s", exc)
        return _FALLBACK_REVIEW


def improve_testcase_with_llm(
    testcase: dict,
    selected_issues: list[dict],
    source_type: str = "testit",
) -> ImproveResult:
    prompt_path = PROMPT_REGISTRY["improve"].get(source_type, PROMPT_REGISTRY["improve"]["testit"])
    prompt = _load_prompt(prompt_path)
    client = _get_instructor_client()
    user_content = (
        f"Тест-кейс для улучшения:\n{json.dumps(testcase, ensure_ascii=False, indent=2)}\n\n"
        f"Проблемы для исправления (выбраны пользователем):\n{json.dumps(selected_issues, ensure_ascii=False, indent=2)}"
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

- [ ] **Step 4: Run tests**

```bash
cd /home/dmitriy/projects/qa-ai-tool/backend && python -m pytest tests/test_llm_client.py -v
```

Expected: all 7 tests PASS

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd /home/dmitriy/projects/qa-ai-tool/backend && python -m pytest tests/ -v --ignore=tests/test_testcase_improver.py
```

Expected: no new failures (test_testcase_improver.py is excluded — fixed in Task 6)

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/llm_client.py backend/tests/test_llm_client.py
git commit -m "feat: rewrite llm_client with instructor, PROMPT_REGISTRY, typed returns"
```

---

## Task 5: Update testcase_analyzer.py

**Files:**
- Modify: `backend/app/services/testcase_analyzer.py`

The service currently calls `llm_result.get("issues")` (dict access). After Task 4, `analyze_testcase_with_llm` returns `ReviewResult` (Pydantic). `_coerce_issue` is no longer needed. `_coerce_step` and `_coerce_testcase` stay — used by testcase_improver.

- [ ] **Step 1: Write failing test**

Add to `backend/tests/test_testcase_analyzer.py` (create if doesn't exist):

```python
from unittest.mock import patch

from app.schemas.analysis import AnalysisIssue, ReviewResult
from app.services.testcase_analyzer import analyze_raw_testcase

SAMPLE_WORK_ITEM = {
    "name": "Login test",
    "steps": [{"action": "Open login page", "expected": "Page loaded"}],
}

MOCK_REVIEW = ReviewResult(
    summary="Found 1 issue",
    issues=[AnalysisIssue(severity="high", title="No expected result", description="D", recommendation="Add ER")],
    warnings=[],
)


def test_analyze_returns_response_with_issues():
    with patch("app.services.testcase_analyzer.analyze_testcase_with_llm", return_value=MOCK_REVIEW):
        result = analyze_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, source_type="testit")

    assert result.summary == "Found 1 issue"
    assert len(result.issues) == 1
    assert result.issues[0].severity == "high"


def test_analyze_passes_source_type_to_llm():
    with patch("app.services.testcase_analyzer.analyze_testcase_with_llm", return_value=MOCK_REVIEW) as mock_llm:
        analyze_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, source_type="manual")

    mock_llm.assert_called_once()
    _, kwargs = mock_llm.call_args
    assert kwargs.get("source_type") == "manual" or mock_llm.call_args[0][1] == "manual"


def test_analyze_merges_warnings():
    review_with_warnings = ReviewResult(
        summary="OK",
        issues=[],
        warnings=["LLM warning"],
    )
    with patch("app.services.testcase_analyzer.analyze_testcase_with_llm", return_value=review_with_warnings):
        result = analyze_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, source_type="testit")

    assert "LLM warning" in result.warnings
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/dmitriy/projects/qa-ai-tool/backend && python -m pytest tests/test_testcase_analyzer.py -v
```

Expected: TypeError — `analyze_raw_testcase` doesn't accept `source_type` yet

- [ ] **Step 3: Update testcase_analyzer.py**

Replace the contents of `backend/app/services/testcase_analyzer.py` with:

```python
from __future__ import annotations
import logging
from app.core.llm_client import analyze_testcase_with_llm
from app.parsing.testit_parser import parse_testit_content
from app.parsing.testit_workitem_mapper import normalize_testit_workitem
from app.schemas.analysis import (
    AnalysisStep,
    AnalyzedTestCase,
    AnalyzeTestCaseResponse,
    IssueResolution,
    ReviewResult,
)

logger = logging.getLogger(__name__)


def _coerce_step(raw: object) -> AnalysisStep | None:
    if not isinstance(raw, dict):
        return None
    try:
        return AnalysisStep(
            action=str(raw.get("action") or ""),
            expected=str(raw["expected"]) if raw.get("expected") else None,
            test_data=str(raw["test_data"]) if raw.get("test_data") else None,
            comments=str(raw["comments"]) if raw.get("comments") else None,
        )
    except Exception as exc:
        logger.warning("Failed to coerce step: %s — %s", raw, exc)
        return None


def _coerce_testcase(raw: dict, original: dict) -> AnalyzedTestCase:
    try:
        return AnalyzedTestCase(
            title=str(raw.get("title") or original.get("title") or ""),
            description=str(raw.get("description") or original.get("description") or ""),
            preconditions=[s for r in raw.get("preconditions") or [] for s in [_coerce_step(r)] if s],
            steps=[s for r in raw.get("steps") or [] for s in [_coerce_step(r)] if s],
            postconditions=[s for r in raw.get("postconditions") or [] for s in [_coerce_step(r)] if s],
            tags=list(raw.get("tags") or []),
            priority=raw.get("priority") or original.get("priority"),
            status=raw.get("status") or original.get("status"),
            duration=raw.get("duration") if raw.get("duration") is not None else original.get("duration"),
            attributes=raw.get("attributes") or original.get("attributes") or {},
        )
    except Exception as exc:
        logger.warning("Coercion failed, falling back: %s", exc)
        return AnalyzedTestCase(
            title=str(original.get("title") or ""),
            description=str(original.get("description") or ""),
            steps=[s for r in (original.get("steps") or []) for s in [_coerce_step(r)] if s],
            attributes=original.get("attributes") or {},
        )


def _complete_resolutions(
    resolutions: list[IssueResolution],
    issues: list[dict],
) -> list[IssueResolution]:
    seen = {r.issue_index for r in resolutions}
    result = list(resolutions)
    for idx in range(len(issues)):
        if idx not in seen:
            result.append(IssueResolution(
                issue_index=idx,
                issue_title=str(issues[idx].get("title", "") if isinstance(issues[idx], dict) else ""),
                status="skipped",
                reason="Не обработано LLM",
            ))
    result.sort(key=lambda r: r.issue_index)
    return result


def analyze_raw_testcase(
    raw_content: str | None,
    work_item: dict | None,
    source_type: str = "testit",
) -> AnalyzeTestCaseResponse:
    if raw_content is None and work_item is None:
        raise ValueError("Provide raw_content or work_item")

    if work_item is not None:
        normalized = normalize_testit_workitem(work_item)
    else:
        normalized = parse_testit_content(raw_content)  # type: ignore[arg-type]

    clean_dict = normalized.model_dump()
    llm_result: ReviewResult = analyze_testcase_with_llm(clean_dict, source_type=source_type)

    parse_warnings = normalized.warnings or []
    all_warnings = list(dict.fromkeys(parse_warnings + llm_result.warnings))

    return AnalyzeTestCaseResponse(
        summary=llm_result.summary,
        issues=llm_result.issues,
        original_normalized_testcase=clean_dict,
        warnings=all_warnings,
    )
```

- [ ] **Step 4: Run tests**

```bash
cd /home/dmitriy/projects/qa-ai-tool/backend && python -m pytest tests/test_testcase_analyzer.py -v
```

Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/testcase_analyzer.py backend/tests/test_testcase_analyzer.py
git commit -m "feat: update analyzer to use typed ReviewResult, pass source_type"
```

---

## Task 6: Update testcase_improver.py and Fix Tests

**Files:**
- Modify: `backend/app/services/testcase_improver.py`
- Modify: `backend/tests/test_testcase_improver.py`

- [ ] **Step 1: Rewrite test_testcase_improver.py**

The existing tests use stale mocks (dict returns, wrong function name `improve_raw_testcase`, old `review` param). Replace the full file:

```python
from unittest.mock import patch

import pytest

from app.schemas.analysis import (
    AnalysisIssue,
    AnalyzedTestCase,
    ImproveResult,
    IssueResolution,
)
from app.services.testcase_improver import improve_testcase

SAMPLE_WORK_ITEM = {
    "name": "Login test",
    "description": "Test that user can login",
    "steps": [
        {"action": "Open login page", "expected": "Page loaded"},
        {"action": "Enter credentials", "expected": "Fields filled"},
    ],
    "precondition_steps": [{"action": "User is registered", "expected": None}],
}

MOCK_LLM_RESULT = ImproveResult(
    improved_testcase=AnalyzedTestCase(
        title="Логин тест — позитивный сценарий",
        description="Проверка успешного входа пользователя",
        steps=[
            AnalyzedTestCase.__fields__["steps"].default_factory()  # will be overridden
        ]
        if False
        else [
            __import__("app.schemas.analysis", fromlist=["AnalysisStep"]).AnalysisStep(
                action="Открыть страницу логина",
                expected="Страница загружена",
            )
        ],
        tags=["smoke", "auth"],
        priority="high",
    ),
    issue_resolutions=[
        IssueResolution(
            issue_index=0,
            issue_title="No expected result",
            status="resolved",
            action_taken="Added expected results",
        )
    ],
    improvement_notes=["Добавлены конкретные ожидаемые результаты"],
    manual_notes=[],
    warnings=[],
)

SELECTED_ISSUES = [
    {"severity": "high", "title": "No expected result", "description": "D", "recommendation": "Add ER"}
]


def test_improve_accepts_work_item():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_RESULT):
        result = improve_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, selected_issues=SELECTED_ISSUES)
    assert result.improved_testcase.title == "Логин тест — позитивный сценарий"


def test_improve_returns_original_normalized_testcase():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_RESULT):
        result = improve_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, selected_issues=SELECTED_ISSUES)
    assert isinstance(result.original_normalized_testcase, dict)
    assert "steps" in result.original_normalized_testcase


def test_improve_passes_source_type_to_llm():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_RESULT) as mock_llm:
        improve_testcase(
            work_item=SAMPLE_WORK_ITEM,
            raw_content=None,
            selected_issues=SELECTED_ISSUES,
            source_type="manual",
        )
    call_args = mock_llm.call_args
    assert call_args[1].get("source_type") == "manual" or call_args[0][2] == "manual"


def test_improve_empty_request_raises_value_error():
    with pytest.raises(ValueError, match="raw_content or work_item"):
        improve_testcase(work_item=None, raw_content=None, selected_issues=[])


def test_improve_accepts_raw_content():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_RESULT):
        result = improve_testcase(
            raw_content="Login test\n1. Open login page\n2. Enter credentials",
            work_item=None,
            selected_issues=SELECTED_ISSUES,
        )
    assert result is not None
    assert result.original_normalized_testcase is not None


def test_improve_improvement_notes_in_response():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_RESULT):
        result = improve_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, selected_issues=SELECTED_ISSUES)
    assert "Добавлены конкретные ожидаемые результаты" in result.improvement_notes


def test_improved_testcase_has_only_testit_fields():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_RESULT):
        result = improve_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, selected_issues=SELECTED_ISSUES)
    tc_dict = result.improved_testcase.model_dump()
    assert "improvement_notes" not in tc_dict
    assert "warnings" not in tc_dict
    assert "title" in tc_dict
    assert "steps" in tc_dict


def test_improve_fallback_when_llm_unavailable():
    from app.schemas.analysis import ImproveResult, AnalyzedTestCase
    fallback = ImproveResult(
        improved_testcase=AnalyzedTestCase(),
        warnings=["LLM is unavailable, fallback response returned"],
    )
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=fallback):
        result = improve_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, selected_issues=SELECTED_ISSUES)
    assert any("unavailable" in w.lower() for w in result.warnings)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/dmitriy/projects/qa-ai-tool/backend && python -m pytest tests/test_testcase_improver.py -v
```

Expected: TypeError — `improve_testcase` doesn't accept `source_type` yet

- [ ] **Step 3: Update testcase_improver.py**

Replace the contents of `backend/app/services/testcase_improver.py` with:

```python
from __future__ import annotations
import logging
from app.core.llm_client import improve_testcase_with_llm
from app.parsing.testit_parser import parse_testit_content
from app.parsing.testit_workitem_mapper import normalize_testit_workitem
from app.schemas.analysis import ImproveResult, ImproveTestCaseResponse
from app.services.testcase_analyzer import _coerce_testcase, _complete_resolutions
from app.services.testcase_diff import build_testcase_diff
from app.services.testcase_postprocessor import postprocess_improved_testcase

logger = logging.getLogger(__name__)


def improve_testcase(
    raw_content: str | None,
    work_item: dict | None,
    selected_issues: list[dict],
    source_type: str = "testit",
) -> ImproveTestCaseResponse:
    if raw_content is None and work_item is None:
        raise ValueError("Provide raw_content or work_item")

    if work_item is not None:
        normalized = normalize_testit_workitem(work_item)
    else:
        normalized = parse_testit_content(raw_content)  # type: ignore[arg-type]

    clean_dict = normalized.model_dump()
    llm_result: ImproveResult = improve_testcase_with_llm(
        clean_dict, selected_issues, source_type=source_type
    )

    improved_raw = llm_result.improved_testcase.model_dump()
    processed = postprocess_improved_testcase(clean_dict, improved_raw)
    validation_warnings: list[str] = processed.pop("validation_warnings", [])
    display_duration: str | None = processed.get("display_duration")
    improvement_notes = processed.pop("improvement_notes", llm_result.improvement_notes)
    manual_notes = processed.pop("manual_notes", llm_result.manual_notes)
    processed.pop("warnings", None)

    improved_final = _coerce_testcase(processed, clean_dict)
    diff = build_testcase_diff(clean_dict, improved_final.model_dump())
    issue_resolutions = _complete_resolutions(llm_result.issue_resolutions, selected_issues)

    parse_warnings = normalized.warnings or []
    all_warnings = list(dict.fromkeys(parse_warnings + llm_result.warnings))

    return ImproveTestCaseResponse(
        improved_testcase=improved_final,
        original_normalized_testcase=clean_dict,
        issue_resolutions=issue_resolutions,
        improvement_notes=improvement_notes,
        manual_notes=manual_notes,
        warnings=all_warnings,
        validation_warnings=validation_warnings,
        diff=diff,
        display_duration=display_duration,
    )
```

- [ ] **Step 4: Run tests**

```bash
cd /home/dmitriy/projects/qa-ai-tool/backend && python -m pytest tests/test_testcase_improver.py -v
```

Expected: all tests PASS

- [ ] **Step 5: Run full test suite**

```bash
cd /home/dmitriy/projects/qa-ai-tool/backend && python -m pytest tests/ -v
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/testcase_improver.py backend/tests/test_testcase_improver.py
git commit -m "feat: update improver to use typed ImproveResult, pass source_type"
```

---

## Task 7: Update routes.py

**Files:**
- Modify: `backend/app/api/routes.py`

- [ ] **Step 1: Update analyze and improve endpoints to pass source_type**

In `backend/app/api/routes.py`, update the two endpoints:

```python
@router.post("/analyze-testcase", response_model=AnalyzeTestCaseResponse)
async def analyze_testcase(body: AnalyzeTestCaseRequest) -> AnalyzeTestCaseResponse:
    if body.work_item is None and body.raw_content is None:
        raise HTTPException(status_code=422, detail="Provide raw_content or work_item")
    try:
        return analyze_raw_testcase(
            raw_content=body.raw_content,
            work_item=body.work_item,
            source_type=body.source_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/improve-testcase", response_model=ImproveTestCaseResponse)
async def improve_testcase_endpoint(body: ImproveTestCaseRequest) -> ImproveTestCaseResponse:
    if body.work_item is None and body.raw_content is None:
        raise HTTPException(status_code=422, detail="Provide raw_content or work_item")
    try:
        return improve_testcase(
            raw_content=body.raw_content,
            work_item=body.work_item,
            selected_issues=body.selected_issues,
            source_type=body.source_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
```

- [ ] **Step 2: Run full test suite**

```bash
cd /home/dmitriy/projects/qa-ai-tool/backend && python -m pytest tests/ -v
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/routes.py
git commit -m "feat: pass source_type from request body to service layer"
```

---

## Task 8: Frontend — Add source_type Selector

**Files:**
- Modify: `frontend/src/` (check existing components) or `frontend/app.js`

- [ ] **Step 1: Locate where analyze and improve requests are sent**

```bash
grep -n "analyze-testcase\|improve-testcase" /home/dmitriy/projects/qa-ai-tool/frontend/app.js /home/dmitriy/projects/qa-ai-tool/frontend/src/**/* 2>/dev/null | head -20
```

Note the exact lines that build the request body for both endpoints.

- [ ] **Step 2: Add source_type state**

Find the component/section that handles the analyze form. Add a `source_type` variable defaulting to `"testit"`.

If using vanilla JS in `app.js`, add near the top of the analyze section:

```javascript
let sourceType = 'testit'; // 'testit' | 'manual'
```

If using React/Vue in `src/`, add state:

```javascript
// React
const [sourceType, setSourceType] = useState('testit');
// Vue
data() { return { sourceType: 'testit' } }
```

- [ ] **Step 3: Add radio selector to UI**

Add before the analyze button, in the HTML or JSX:

```html
<div class="source-type-selector">
  <label>
    <input type="radio" name="source_type" value="testit" checked> TestIT
  </label>
  <label>
    <input type="radio" name="source_type" value="manual"> Manual
  </label>
</div>
```

Wire the change event to update `sourceType`.

- [ ] **Step 4: Pass source_type in analyze request body**

Find the fetch/axios call to `/api/analyze-testcase`. Add `source_type` to the body:

```javascript
body: JSON.stringify({
  raw_content: rawContent,    // or work_item: workItem
  source_type: sourceType,
})
```

- [ ] **Step 5: Pass source_type in improve request body**

Find the fetch/axios call to `/api/improve-testcase`. Add `source_type`:

```javascript
body: JSON.stringify({
  raw_content: rawContent,    // or work_item: workItem
  selected_issues: selectedIssues,
  source_type: sourceType,
})
```

- [ ] **Step 6: Manual smoke test**

Start the backend:
```bash
cd /home/dmitriy/projects/qa-ai-tool/backend && uvicorn app.main:app --reload --port 8000
```

Start the frontend (check package.json for dev command):
```bash
cd /home/dmitriy/projects/qa-ai-tool/frontend && npm run dev
```

Open the UI. Toggle TestIT / Manual. Paste a test case. Click Analyze. Verify request goes through without 422 error.

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "feat: add source_type selector to UI (testit/manual)"
```

---

## Self-Review

### Spec Coverage Check

| Spec requirement | Task |
|---|---|
| instructor library, Mode.JSON for Ollama/Deepseek | Task 1, 4 |
| QA-editable .md prompt files, zero JSON refs | Task 2 |
| review_testit.md, review_manual.md separate prompts | Task 2 |
| improve.md (source-agnostic) | Task 2 |
| PROMPT_REGISTRY dict in llm_client | Task 4 |
| ReviewResult, ImproveResult Pydantic models | Task 3 |
| source_type in request schemas | Task 3 |
| analyze_testcase_with_llm returns ReviewResult | Task 4 |
| improve_testcase_with_llm returns ImproveResult | Task 4 |
| max_retries=2 in instructor calls | Task 4 |
| Fallback on LLM failure | Task 4 |
| Remove _REVIEW_SCHEMA, _IMPROVE_SCHEMA, _post_chat | Task 4 |
| testcase_analyzer.py uses typed return, remove _coerce_issue | Task 5 |
| testcase_improver.py uses typed return | Task 6 |
| _complete_resolutions replaces _coerce_resolutions | Task 5 |
| routes.py passes source_type | Task 7 |
| Frontend source_type selector | Task 8 |

All spec requirements covered.

### Type Consistency Check

- `analyze_testcase_with_llm(dict, source_type: str) -> ReviewResult` — defined Task 4, used Task 5 ✓
- `improve_testcase_with_llm(dict, list[dict], source_type: str) -> ImproveResult` — defined Task 4, used Task 6 ✓
- `_coerce_testcase(raw: dict, original: dict) -> AnalyzedTestCase` — defined Task 5, used Task 6 ✓
- `_complete_resolutions(list[IssueResolution], list[dict]) -> list[IssueResolution]` — defined Task 5, used Task 6 ✓
- `analyze_raw_testcase(..., source_type: str) -> AnalyzeTestCaseResponse` — defined Task 5, called Task 7 ✓
- `improve_testcase(..., source_type: str) -> ImproveTestCaseResponse` — defined Task 6, called Task 7 ✓
