# QA AI Tool

Локальный инструмент для QA

## Структура

- backend: FastAPI API (порт 8000)
- frontend: Vite + React UI (порт 3000)

## Быстрый старт

Требования:
- Python 3.10+
- Node.js 18+
- npm 9+

1. Склонировать репозиторий и перейти в корень проекта.
2. Настроить backend-переменные окружения (см. раздел "Переменные окружения").
3. Запустить backend.
4. Запустить frontend.
5. Открыть UI в браузере: http://localhost:3000

## Запуск backend

Из корня проекта:

- cd backend
- python -m venv .venv
- source .venv/bin/activate (Linux/macOS) или .venv\\Scripts\\activate (Windows)
- pip install -r requirements.txt
- uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

Проверка backend:
- http://localhost:8000/health
- Ожидаемый ответ: {"status":"ok"}

Примечание:
- В некоторых Linux/WSL окружениях Python может быть "externally managed" (PEP 668).
- Если установка через pip блокируется, используйте виртуальное окружение (рекомендуется) или установку в user-site/с флагом вашей платформы.

## Запуск frontend

Из корня проекта:

- cd frontend
- npm install
- npm run dev

Открыть:
- http://localhost:3000

Важно:
- Во frontend API-запросы идут на путь /api.
- В dev-режиме Vite проксирует /api на backend: http://localhost:8000.

## Переменные окружения

Переменные читаются backend из файла backend/.env.

1. Создайте backend/.env на основе шаблона:
- cp backend/.env.example backend/.env
- или в PowerShell: Copy-Item backend/.env.example backend/.env

2. Заполните значения в backend/.env.

### Обязательные для LLM

- LLM_BASE_URL
- LLM_MODEL
- LLM_API_KEY

### Основные для TestIT

- TESTIT_BASE_URL
- TESTIT_PRIVATE_TOKEN
- TESTIT_AUTH_SCHEME (обычно PrivateToken)
- TESTIT_PROJECT_UUID

### Дополнительные

- LLM_TEMPERATURE
- LLM_TEMPERATURE_REVIEW
- LLM_TEMPERATURE_IMPROVE
- LLM_TIMEOUT_SECONDS
- TESTIT_TIMEOUT_SECONDS
- TESTIT_VERIFY_SSL
- TESTIT_DRAFT_SECTION_UUID (опционально; если пусто, секция для драфтов создается автоматически)

## Пример минимального backend/.env

LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=gemma3:4b
LLM_API_KEY=ollama
TESTIT_BASE_URL=https://testit.example.com
TESTIT_PRIVATE_TOKEN=your_private_token_here
TESTIT_AUTH_SCHEME=PrivateToken
TESTIT_PROJECT_UUID=your_project_uuid_here

## Где смотреть полный шаблон

- backend/.env.example
