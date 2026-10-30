"""Streaming chat for Anthropic + any OpenAI-compatible provider. Plain httpx: no SDK weight, one code path."""
import json

import httpx

PROVIDERS = {
    "anthropic": "https://api.anthropic.com/v1",
    "openai": "https://api.openai.com/v1",
    "groq": "https://api.groq.com/openai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
}
client = httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10), limits=httpx.Limits(max_connections=200))


class LLMError(Exception):
    pass


async def stream(provider: str, model: str, key: str, system: str, messages: list[dict], max_tokens: int = 700):
    if provider == "anthropic":
        url = PROVIDERS[provider] + "/messages"
        headers = {"x-api-key": key, "anthropic-version": "2023-06-01"}
        body = {"model": model, "max_tokens": max_tokens, "system": system, "messages": messages, "stream": True}
    else:
        url = PROVIDERS[provider] + "/chat/completions"
        headers = {"Authorization": f"Bearer {key}"}
        body = {
            "model": model, "max_tokens": max_tokens, "stream": True,
            "messages": [{"role": "system", "content": system}] + messages,
        }
    async with client.stream("POST", url, headers=headers, json=body) as r:
        if r.status_code >= 400:
            detail = (await r.aread()).decode(errors="replace")[:300]
            raise LLMError(f"{provider} {r.status_code}: {detail}")
        async for line in r.aiter_lines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            try:
                ev = json.loads(data)
            except ValueError:
                continue
            if provider == "anthropic":
                if ev.get("type") == "content_block_delta" and ev.get("delta", {}).get("type") == "text_delta":
                    yield ev["delta"]["text"]
                elif ev.get("type") == "error":
                    raise LLMError(f"anthropic stream error: {ev.get('error')}")
            else:
                ch = ev.get("choices") or []
                if ch:
                    t = (ch[0].get("delta") or {}).get("content")
                    if t:
                        yield t
