FROM python:3.11-slim
WORKDIR /app

# git required for browser-use git dependency; curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends git curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

# Install Python dependencies (uses uv.lock for reproducibility)
COPY pyproject.toml uv.lock ./
RUN uv sync --extra all --frozen

# Install Chromium + OS-level dependencies for Playwright
RUN uv pip install playwright && uv run python -m playwright install chromium --with-deps

COPY . .
ENV PYTHONPATH=/app
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8008"]
