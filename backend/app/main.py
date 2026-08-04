from __future__ import annotations

import logging
import logging.handlers
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import settings

_LOG_DIR = Path(__file__).parent.parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)

_fmt = logging.Formatter("%(asctime)s %(levelname)-8s %(name)s: %(message)s")

_file_handler = logging.handlers.RotatingFileHandler(
    _LOG_DIR / "app.log",
    maxBytes=10 * 1024 * 1024,
    backupCount=5,
    encoding="utf-8",
)
_file_handler.setFormatter(_fmt)
_file_handler.setLevel(logging.DEBUG)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Add file handler after uvicorn finishes its own logging setup
    app_logger = logging.getLogger("app")
    app_logger.setLevel(logging.DEBUG)
    app_logger.addHandler(_file_handler)
    # Surface the active LLM config at startup — a misconfigured .env
    # otherwise only shows up as a generic "LLM unavailable" deep inside the
    # first analyze/improve request, with /health still reporting ok.
    app_logger.info("LLM config: base_url=%s model=%s", settings.LLM_BASE_URL, settings.LLM_MODEL)
    if not settings.TESTIT_BASE_URL or not settings.TESTIT_PRIVATE_TOKEN:
        app_logger.warning("TestIT is not configured (TESTIT_BASE_URL/TESTIT_PRIVATE_TOKEN) — TestIT-backed endpoints will fail")
    yield
    app_logger.removeHandler(_file_handler)


app = FastAPI(title="QA AI Tool", version="0.1.0", lifespan=lifespan)

_cors_origins = ["*"] if settings.CORS_ORIGINS.strip() == "*" else [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
