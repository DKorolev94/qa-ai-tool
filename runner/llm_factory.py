from __future__ import annotations

import os
from typing import Any

from browser_use.llm import ChatDeepSeek
from browser_use.llm.views import ChatInvokeUsage


class _DeepSeekCompletionsCapture:
    def __init__(self, completions: Any, on_response: Any) -> None:
        self._completions = completions
        self._on_response = on_response

    async def create(self, *args: Any, **kwargs: Any) -> Any:
        response = await self._completions.create(*args, **kwargs)
        self._on_response(response)
        return response

    def __getattr__(self, name: str) -> Any:
        return getattr(self._completions, name)


class DeepSeekWithUsage(ChatDeepSeek):
    def _usage_from_response(self, response: Any) -> ChatInvokeUsage | None:
        usage = getattr(response, 'usage', None)
        if usage is None:
            return None
        prompt_tokens = int(getattr(usage, 'prompt_tokens', 0) or 0)
        completion_tokens = int(getattr(usage, 'completion_tokens', 0) or 0)
        total_tokens = int(getattr(usage, 'total_tokens', 0) or 0) or prompt_tokens + completion_tokens
        prompt_details = getattr(usage, 'prompt_tokens_details', None)
        cached_tokens = getattr(prompt_details, 'cached_tokens', None) if prompt_details is not None else None
        return ChatInvokeUsage(
            prompt_tokens=prompt_tokens,
            prompt_cached_tokens=cached_tokens,
            prompt_cache_creation_tokens=None,
            prompt_image_tokens=None,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
        )

    def _client(self) -> Any:
        client = super()._client()
        if not isinstance(client.chat.completions, _DeepSeekCompletionsCapture):
            client.chat.completions = _DeepSeekCompletionsCapture(
                client.chat.completions,
                lambda r: object.__setattr__(self, '_last_raw_response', r),
            )
        return client

    async def ainvoke(self, *args: Any, **kwargs: Any) -> Any:
        object.__setattr__(self, '_last_raw_response', None)
        result = await super().ainvoke(*args, **kwargs)
        captured = getattr(self, '_last_raw_response', None)
        if result.usage is None and captured is not None:
            result.usage = self._usage_from_response(captured)
        return result


def create_llm(model: str, llm_timeout_sec: int = 90) -> Any:
    """Return a LangChain-compatible chat model for the configured LLM_PROVIDER."""
    provider = os.getenv('LLM_PROVIDER', 'deepseek').lower()

    if provider == 'deepseek':
        api_key = os.getenv('DEEPSEEK_API_KEY', '')
        if not api_key:
            raise RuntimeError('DEEPSEEK_API_KEY is not set')
        return DeepSeekWithUsage(model=model, api_key=api_key, timeout=llm_timeout_sec + 15)

    if provider == 'openai':
        from langchain_openai import ChatOpenAI
        api_key = os.getenv('OPENAI_API_KEY', '')
        if not api_key:
            raise RuntimeError('OPENAI_API_KEY is not set')
        kwargs: dict[str, Any] = {'model': model, 'api_key': api_key}
        base_url = os.getenv('OPENAI_BASE_URL')
        if base_url:
            kwargs['base_url'] = base_url
        return ChatOpenAI(**kwargs)

    if provider == 'claude':
        from langchain_anthropic import ChatAnthropic
        api_key = os.getenv('ANTHROPIC_API_KEY', '')
        if not api_key:
            raise RuntimeError('ANTHROPIC_API_KEY is not set')
        return ChatAnthropic(model=model, api_key=api_key)

    if provider == 'ollama':
        from langchain_ollama import ChatOllama
        base_url = os.getenv('OLLAMA_BASE_URL', 'http://localhost:11434')
        return ChatOllama(model=model, base_url=base_url)

    raise RuntimeError(f'Unknown LLM_PROVIDER: {provider!r}. Choose: deepseek, openai, claude, ollama')
