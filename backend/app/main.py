from __future__ import annotations

import logging
import logging.handlers
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router

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
    yield
    app_logger.removeHandler(_file_handler)


app = FastAPI(title="QA AI Tool", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
