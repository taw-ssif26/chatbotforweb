"""Runs the real app on :8099 with Voyage/Tavily/LLM faked, for tests/ui_test.cjs (needs an empty pgvector DB via .env)."""
import os
os.environ["PUBLIC_BASE_URL"] = "http://localhost:8099"
import asyncio, hashlib
import uvicorn
from app import rag, llm
from app.main import app


async def fake_embed(texts, input_type):
    out = []
    for t in texts:
        v = [0.0] * 1024
        for w in t.lower().split():
            v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 1024] += 1
        n = sum(x * x for x in v) ** 0.5 or 1
        out.append([x / n for x in v])
    return out


async def fake_stream(provider, model, key, system, messages, max_tokens=700):
    for part in ["Hello ", "from ", "the bot."]:
        await asyncio.sleep(0.05)
        yield part

async def fake_list(provider, key):
    return ["gpt-4o", "gpt-4o-mini", "my-custom-model"]

rag.embed, llm.stream, llm.list_models = fake_embed, fake_stream, fake_list
if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8099, log_level="warning")
