# AGENTS.md

QA AI Tool — локальный инструмент для QA: ревью/улучшение тест-кейсов (из TestIT) + запуск браузерных тестов (browser-use).

## Структура

```
qa-ai-tool/
├── backend/           # FastAPI (port 8000) — review/improve, gateway к TestIT и runner
├── frontend/          # Vite + React 18 + Tailwind (port 3000)
├── browser-use-runner/# FastAPI (port 8008) — web-агент на browser-use
└── docker-compose.yml # 3 сервиса: backend, browser-use-runner, frontend
```

Каталога `stagehand-runner/` в репозитории нет — он есть только в Makefile.

## Переменные окружения

- **Корневой `.env`** — главный, используется backend и browser-use-runner.
- `backend/app/core/config.py` грузит `["../.env", ".env"]` — сначала корень, потом `backend/.env` (для оверрайдов).
- `browser-use-runner/main.py` грузит `parent/.env` потом `local .env` с `override=True`.
- **`.env.example`** лежит ТОЛЬКО в корне. В `backend/.env.example` — пустой/комментарии.
- `RUNNER_URL` в Docker автоматически меняется на `http://browser-use-runner:8008` (см. `docker-compose.yml`).

## Запуск

```bash
# Dev (hot-reload, bind-mounts):
docker compose up --build

# Prod (собранный фронтенд, без mount'ов):
docker compose -f docker-compose.yml up --build

# Без Docker:
cd backend && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

cd browser-use-runner && uv sync && uv run uvicorn main:app --host 0.0.0.0 --port 8008 --reload

cd frontend && npm install && npm run dev
# Или: make dev / make stop / make restart / make status
```

## Тесты

**Только backend.** Browser-use-runner тестов не имеет.

```bash
cd backend && python -m pytest
# Один файл:
cd backend && python -m pytest tests/test_llm_client.py
# Один тест:
cd backend && python -m pytest tests/test_llm_client.py -k test_name
```

Конфиг: `backend/pytest.ini` — `python_classes = *Tests *Suite`, `testpaths = tests`. Pytest режим asyncio в backend **не включён** (в отличие от runner — `pyproject.toml` → `asyncio_mode = "auto"`).

## Пакетные менеджеры

- **backend**: `pip` → `requirements.txt` (Python 3.10+)
- **browser-use-runner**: `uv` → `pyproject.toml` + `uv.lock` (Python 3.11+)
- **frontend**: `npm` → `package.json` + `package-lock.json` (Node 18+)

## Ключевые неочевидные моменты

1. **`websockets` в requirements.txt**: `backend/app/api/routes.py:267` импортирует `from websockets.asyncio.client import connect as ws_connect`, но в `requirements.txt` пакета `websockets` нет. Он может тянуться транзитивно через `uvicorn[standard]`.

2. **Docker vs локальный запуск**: При локальном запуске вне Docker нужен `RUNNER_RUNS_DIR` для отдачи скриншотов — абсолютный путь к `browser-use-runner/runs/`.

3. **Browser-use — git-зависимость**: `browser-use-runner/pyproject.toml` тянет `browser-use @ git+https://github.com/browser-use/browser-use.git@main`.

4. **LLM через instructor**: Backend использует библиотеку `instructor` для structured JSON output (review/improve). Runner использует нативный `browser_use.llm.openai.chat.ChatOpenAI`.

5. **Сквозная нумерация в .env**: `LLM_MODEL` — для backend, `RUNNER_LLM_MODEL` — для runner. Если `RUNNER_LLM_MODEL` не задан, runner фоллбэчится на `LLM_MODEL`.

6. **Фронтенд Docker-образ**: Два target'а — `dev` (vite hot-reload, используется в docker-compose.override.yml) и `prod` (nginx + статика).

7. **Evidence verdict**: Runner переопределяет статус теста на основе проверки evidence (наличие email/phone/checkbox в финальном состоянии браузера). Статус может измениться с `passed` на `failed` после сохранения артефактов.

8. **Prompts в Markdown**: Правила ревью и промпты лежат в `backend/app/core/prompts/` как `.md` файлы. Изменения в них влияют на качество ревью без пересборки.
