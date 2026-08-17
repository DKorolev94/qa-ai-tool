# Chromium + OS-level deps for Playwright are baked into this image already;
# git/curl are preinstalled too. Version pin must match the `playwright` pip
# package pinned below.
FROM mcr.microsoft.com/playwright/python:v1.62.0-noble
WORKDIR /app

RUN pip install --no-cache-dir uv

# Install Python dependencies. browser-use is pulled from git `main` on every
# build (see pyproject.toml) so upstream fixes land on rebuild; --upgrade-package
# re-resolves + re-fetches that one git source while the rest stays locked.
COPY pyproject.toml uv.lock ./
RUN uv sync --extra all --upgrade-package browser-use

# Pinned to match the base image's bundled browser build
RUN uv pip install "playwright==1.62.0"

COPY . .
ENV PYTHONPATH=/app
# --no-sync: the host's uv.lock is a stale floor, don't let `uv run` re-sync the
# image's freshly-upgraded venv back down to it at startup.
CMD ["uv", "run", "--no-sync", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8008"]
