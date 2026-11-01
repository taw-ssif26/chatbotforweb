"""Streaming chat for Anthropic + any OpenAI-compatible provider. Plain httpx: no SDK weight, one code path."""
import json

import httpx

PROVIDERS = {
    "anthropic": "https://api.anthropic.com/v1",
    "openai": "https://api.openai.com/v1",
    "groq": "https://api.groq.com/openai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "xai": "https://api.x.ai/v1",   # xAI Grok (not to be confused with Groq)
}
KEY_PREFIXES = {"xai-": "xai", "gsk_": "groq", "sk-ant-": "anthropic", "sk-or-": "openrouter"}  # unambiguous prefixes
client = httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10), limits=httpx.Limits(max_connections=200))


class LLMError(Exception):
    pass


class LLMAuthError(LLMError):
    pass


def provider_for_key(key: str) -> str | None:
    return next((p for pre, p in KEY_PREFIXES.items() if key.startswith(pre)), None)


async def list_models(provider: str, key: str) -> list[str]:
    """Models this key can use (also proves the key is valid). Filters out non-chat models."""
    url = PROVIDERS[provider] + "/models" + ("?limit=100" if provider == "anthropic" else "")
    headers = {"x-api-key": key, "anthropic-version": "2023-06-01"} if provider == "anthropic" else {"Authorization": f"Bearer {key}"}
    r = await client.get(url, headers=headers, timeout=15)
    if r.status_code in (401, 403):
        raise LLMAuthError(f"{provider} rejected this key")
    if r.status_code >= 400:
        raise LLMError(f"{provider} {r.status_code}")
    skip = ("whisper", "tts", "embed", "guard", "moderation", "dall-e", "image", "audio", "realtime", "transcribe", "vision-preview")
    return sorted(m["id"] for m in r.json().get("data", []) if "id" in m and not any(x in m["id"].lower() for x in skip))


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
