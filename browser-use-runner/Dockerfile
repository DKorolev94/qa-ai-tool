# Chromium + OS-level deps for Playwright are baked into this image already;
# git/curl are preinstalled too. Version pin must match the `playwright` pip
# package pinned below.
FROM mcr.microsoft.com/playwright/python:v1.62.0-noble
WORKDIR /app

RUN pip install --no-cache-dir uv

# Install Python dependencies (uses uv.lock for reproducibility)
COPY pyproject.toml uv.lock ./
RUN uv sync --extra all --frozen

# Pinned to match the base image's bundled browser build
RUN uv pip install "playwright==1.62.0"

COPY . .
ENV PYTHONPATH=/app
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8008"]
