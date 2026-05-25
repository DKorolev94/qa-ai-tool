# QA AI Tools

Internal platform of AI-powered tools for QA engineers.

## Available tools

| Tool | Description | Status |
|------|-------------|--------|
| **Test Case Review & Improve** | LLM review of test cases, inline improvement, AI draft creation in TestIT | 🧪 Beta |

## Flow

1. **Fetch** test case from TestIT by ID — or paste JSON / plain text in Manual Input
2. **Review** — LLM finds issues, select which to fix
3. **Improve** — LLM produces fixed version with diff, edit inline in real-time
4. **Create AI Draft** — pushes improved test case to TestIT as a draft in "AI Review / Drafts" section

---

## Setup

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# fill in .env — see comments inside
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Backend: http://localhost:8000  
Health check: http://localhost:8000/health

### Frontend

Open `frontend/index.html` in browser. No build step, no server needed.

---

## LLM setup

Any OpenAI-compatible API works — local Ollama, remote GPU host, DeepSeek, etc.

```env
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=gemma3:4b
LLM_API_KEY=ollama
LLM_TEMPERATURE=0.2
```

Ollama quick start:
```bash
ollama pull gemma3:4b && ollama serve
```

---

## TestIT setup

```env
TESTIT_BASE_URL=https://testit.example.com
TESTIT_PRIVATE_TOKEN=your_token
TESTIT_PROJECT_ID=your_project_uuid
TESTIT_DRAFT_SECTION_ID=   # optional — auto-created if empty
```

Token never leaves the backend. Frontend never sees `TESTIT_PRIVATE_TOKEN`.

Supported input: numeric ID (`6109`) or UUID (`3fa85f64-...`).

---

## Tests

```bash
cd backend && pytest
```

---

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/review-testcase` | LLM review |
| POST | `/api/improve-testcase` | LLM improvement + diff |
| POST | `/api/testit/workitem/fetch` | Fetch work item from TestIT |
| POST | `/api/testit/workitem/create-draft` | Create AI draft in TestIT |

---

## Not implemented

- Jira / other TMS integrations
- Run history / database
- Authentication
- Batch processing
