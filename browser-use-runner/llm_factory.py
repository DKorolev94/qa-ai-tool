from __future__ import annotations

import os
from typing import Any


def _temperature() -> float:
    return float(os.getenv('LLM_TEMPERATURE', '0') or 0)


def _is_reasoner(model: str) -> bool:
    return 'reasoner' in model.lower() or 'r1' in model.lower()


def create_llm(model: str, llm_timeout_sec: int = 90, max_tokens: int | None = None) -> Any:
    """OpenAI-compatible LLM client. Works with OpenAI, DeepSeek, Ollama (v1 endpoint), vLLM.

    DeepSeek routing notes:
    - deepseek-chat: function calling is flaky, so it gets a low temperature.
    - deepseek-reasoner (R1): rejects function calling entirely ("Thinking mode
      does not support this tool_choice"), so it uses response_format=json_object
      instead, which DeepSeek supports for structured output.
    """
    api_key = os.getenv('LLM_API_KEY', '')
    if not api_key:
        raise RuntimeError('LLM_API_KEY is not set')
    base_url = os.getenv('LLM_BASE_URL')

    is_deepseek = 'deepseek' in model.lower() or 'deepseek' in (base_url or '').lower()

    if not is_deepseek:
        from browser_use.llm.openai.chat import ChatOpenAI

        kwargs: dict[str, Any] = {
            'model': model,
            'api_key': api_key,
            'timeout': llm_timeout_sec,
            'temperature': _temperature(),
        }
        if base_url:
            kwargs['base_url'] = base_url
        if max_tokens is not None:
            kwargs['max_completion_tokens'] = max_tokens
        return ChatOpenAI(**kwargs)

    from browser_use.llm.deepseek.chat import ChatDeepSeek

    if _is_reasoner(model):
        from browser_use.llm.deepseek.serializer import DeepSeekMessageSerializer
        from browser_use.llm.exceptions import ModelProviderError
        from browser_use.llm.views import ChatInvokeCompletion

        class DeepSeekReasonerChat(ChatDeepSeek):
            async def ainvoke(self, messages, output_format=None, tools=None, stop=None, **kwargs):
                if output_format is None or not hasattr(output_format, 'model_json_schema'):
                    return await super().ainvoke(messages, output_format=output_format, tools=tools, stop=stop, **kwargs)

                client = self._client()
                ds_messages = DeepSeekMessageSerializer.serialize_messages(messages)
                common: dict[str, Any] = {}
                if self.max_tokens is not None:
                    common['max_tokens'] = self.max_tokens

                try:
                    resp = await client.chat.completions.create(
                        model=self.model,
                        messages=ds_messages,
                        response_format={'type': 'json_object'},
                        **common,
                    )
                except Exception as e:
                    raise ModelProviderError(str(e), model=self.name) from e

                content = resp.choices[0].message.content
                if not content:
                    raise ModelProviderError('Empty JSON content in DeepSeek response', model=self.name)

                text = content.strip()
                if text.startswith('```'):
                    text = text.strip('`')
                    if text.lower().startswith('json'):
                        text = text[4:]
                    text = text.strip()

                try:
                    parsed = output_format.model_validate_json(text)
                except Exception as e:
                    raise ModelProviderError(f'Failed to parse DeepSeek JSON output: {e}', model=self.name) from e

                return ChatInvokeCompletion(completion=parsed, usage=None)

        cls = DeepSeekReasonerChat
        kwargs = {'model': model, 'api_key': api_key, 'timeout': llm_timeout_sec}
    else:
        cls = ChatDeepSeek
        kwargs = {'model': model, 'api_key': api_key, 'timeout': llm_timeout_sec, 'temperature': _temperature()}

    if base_url:
        kwargs['base_url'] = base_url
    if max_tokens is not None:
        kwargs['max_tokens'] = max_tokens
    return cls(**kwargs)
