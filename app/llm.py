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
client = httpx.AsyncClient(
    timeout=httpx.Timeout(60, connect=10), limits=httpx.Limits(max_connections=200),
    headers={"User-Agent": "chatbot-saas/1.0"},  # some providers sit behind bot filters that dislike default library agents
)


class LLMError(Exception):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


def _detail(body: str) -> str:
    try:
        j = json.loads(body)
        e = j.get("error", j) if isinstance(j, dict) else j
        return str(e.get("message") if isinstance(e, dict) and e.get("message") else e)[:200]
    except ValueError:
        return body.strip()[:200]


def explain(provider: str, model: str, e: Exception) -> str:
    """Plain-English reason a model call failed, for the bot owner (never shown to website visitors)."""
    st, d = getattr(e, "status", 0), str(e)[:200]
    if st in (401, 403):
        why = f"{provider} rejected the API key. Check that it is active, copied fully, and added under the right provider."
    elif st == 404:
        why = f"{provider} has no model called '{model}' for this key. Pick another model (use 'Load my models')."
    elif st == 429:
        why = f"{provider} says rate limit or credit/quota reached. Wait a minute, or check billing and free-tier limits on your provider account."
    elif st == 400:
        why = f"{provider} refused the request for model '{model}'."
    elif st >= 500:
        why = f"{provider} is having an outage right now. Try again shortly."
    else:
        why = f"Could not reach {provider}."
    return f"{why} Details: {d}" if d else why


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
    for attempt in (1, 2):
        async with client.stream("POST", url, headers=headers, json=body) as r:
            if r.status_code >= 400:
                text = (await r.aread()).decode(errors="replace")
                # Newer OpenAI models reject max_tokens and want max_completion_tokens: retry once.
                if attempt == 1 and r.status_code == 400 and "max_completion_tokens" in text and "max_tokens" in body:
                    body["max_completion_tokens"] = body.pop("max_tokens")
                    continue
                raise LLMError(_detail(text), r.status_code)
            async for chunk in _events(provider, r):
                yield chunk
            return


async def _events(provider: str, r):
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
                raise LLMError(str((ev.get("error") or {}).get("message", ev.get("error")))[:200], 500)
        else:
            ch = ev.get("choices") or []
            if ch:
                t = (ch[0].get("delta") or {}).get("content")
                if t:
                    yield t
