# QA AI Tools

Внутренняя платформа AI-инструментов для QA-инженеров.

## Что умеет

**Ревью и улучшение тест-кейсов** — загружаешь кейс из TestIT или вставляешь текст/JSON, LLM находит проблемы, ты выбираешь что исправить, LLM генерирует улучшенную версию. Готово - отправляешь черновик обратно в TestIT.

---

## Быстрый старт

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # заполни .env (см. ниже)
uvicorn app.main:app --reload --port 8000
```

Проверка: http://localhost:8000/health → `{"status":"ok"}`

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Открывай: http://localhost:5173

---

## Настройка .env

### LLM (обязательно)

Поддерживается любой OpenAI-совместимый API - Ollama, DeepSeek, удалённый GPU-хост.

```env
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=llama3.3:latest
LLM_API_KEY=ollama
LLM_TEMPERATURE=0.2
```

Ollama:
```bash
ollama pull llama3.3 && ollama serve
```

### TestIT (для загрузки кейсов и создания черновиков)

```env
TESTIT_BASE_URL=https://yourteam.testit.software
TESTIT_PRIVATE_TOKEN=your_private_token
TESTIT_PROJECT_UUID=your_project_uuid
TESTIT_DRAFT_SECTION_UUID=          # опционально — если пусто, создаётся раздел "AI Review / Drafts" в корне проекта
```

Токен хранится только на бэкенде, фронтенд его не видит.

---

## Как использовать ревью тест-кейсов

### Источник: TestIT

1. Введи числовой ID тест-кейса (например `3995`) в поле «ID тест-кейса»
2. Нажми **Загрузить** — кейс подтянется из TestIT
3. Нажми **Анализировать** — LLM найдёт проблемы и покажет список замечаний

### Источник: текст или JSON

1. Вставь тест-кейс в поле ввода — любой формат:
   - Свободный текст с заголовками (Заголовок:, Шаги:, ОР: и т.д.)
   - JSON (структура TestIT work item или произвольный объект)
2. Нажми **Анализировать**

### Улучшение

1. После анализа отметь галками замечания которые хочешь исправить
2. Нажми **Улучшить** — LLM исправит выбранные проблемы
3. Отредактируй поля прямо в интерфейсе — JSON обновляется в реальном времени
4. Нажми **Создать черновик в TestIT** — кейс попадёт в раздел «AI Review / Drafts»

### История изменений

В нижней части улучшенного кейса — раскрываемый блок **«История изменений»** со списком что именно LLM поменял (поле, было → стало).

---

## Тесты

```bash
cd backend && pytest
```

---

## API

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/health` | Health check |
| POST | `/api/analyze-testcase` | LLM анализ + список замечаний |
| POST | `/api/improve-testcase` | LLM улучшение + история изменений |
| POST | `/api/testit/workitem/fetch` | Загрузить кейс из TestIT |
| POST | `/api/testit/workitem/create-draft` | Создать черновик в TestIT |

Поле `source_type` в запросах: `"testit"` (по умолчанию) или `"manual"` — выбирает промпт для ревью.
