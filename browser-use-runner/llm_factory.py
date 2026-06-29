from __future__ import annotations

import os
from typing import Any


def create_llm(model: str, llm_timeout_sec: int = 90, max_tokens: int | None = None) -> Any:
    """OpenAI-compatible LLM client. Works with OpenAI, DeepSeek, Ollama (v1 endpoint), vLLM."""
    from browser_use.llm.openai.chat import ChatOpenAI as BrowserUseOpenAI
    api_key = os.getenv('LLM_API_KEY', '')
    if not api_key:
        raise RuntimeError('LLM_API_KEY is not set')
    kwargs: dict[str, Any] = {'model': model, 'api_key': api_key}
    base_url = os.getenv('LLM_BASE_URL')
    if base_url:
        kwargs['base_url'] = base_url
    if max_tokens is not None:
        kwargs['max_tokens'] = max_tokens
    return BrowserUseOpenAI(**kwargs)
