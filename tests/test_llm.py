import asyncio, json
import httpx
import pytest
from app import llm


def run_stream(handler, provider="openai", model="m"):
    llm.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    async def go():
        return "".join([t async for t in llm.stream(provider, model, "k", "sys", [{"role": "user", "content": "hi"}])])
    return asyncio.run(go())


def test_retries_with_max_completion_tokens():
    calls = []
    def handler(req):
        body = json.loads(req.content); calls.append(body)
        if "max_tokens" in body:
            return httpx.Response(400, json={"error": {"message": "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead."}})
        return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n')
    assert run_stream(handler) == "Hi" and "max_completion_tokens" in calls[1] and "max_tokens" not in calls[1]


@pytest.mark.parametrize("status,needle", [(401, "rejected the API key"), (404, "no model called"), (429, "quota"), (500, "outage"), (400, "refused")])
def test_errors_are_explained(status, needle):
    handler = lambda req: httpx.Response(status, json={"error": {"message": "provider said no"}})
    with pytest.raises(llm.LLMError) as e:
        run_stream(handler, "groq", "llama-x")
    assert e.value.status == status and needle in llm.explain("groq", "llama-x", e.value) and "provider said no" in llm.explain("groq", "llama-x", e.value)


def test_anthropic_stream_parsing():
    sse = ('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n'
           'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n')
    assert run_stream(lambda req: httpx.Response(200, text=sse), "anthropic") == "Hello"


def test_provider_user_agent_is_set():
    seen = {}
    def handler(req):
        seen["ua"] = req.headers.get("user-agent"); return httpx.Response(200, text="data: [DONE]\n\n")
    client_headers = {"User-Agent": "chatbot-saas/1.0"}
    llm.client = httpx.AsyncClient(transport=httpx.MockTransport(handler), headers=client_headers)
    async def go():
        async for _ in llm.stream("groq", "m", "k", "s", [{"role": "user", "content": "x"}]): pass
    asyncio.run(go()); assert seen["ua"] == "chatbot-saas/1.0"
