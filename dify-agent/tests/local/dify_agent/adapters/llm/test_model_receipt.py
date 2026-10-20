"""Exercise protected receipts through the actual SDK SSE provider."""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from graphon.model_runtime.entities.llm_entities import LLMResultChunk
from graphon.model_runtime.entities.message_entities import UserPromptMessage
from pydantic_ai.exceptions import UnexpectedModelBehavior

from dify_agent.adapters.llm.provider import DifyApiLLMClient
from dify_agent.runtime.native_continuation import NativePolicyStopped
from ._test_support import build_stream_response, single_text_chunk
from .test_api_provider import _execution_context


class ReceiptBoundary:
    def __init__(self, recorded=None):
        self.continuation = SimpleNamespace(operation_cursor=0)
        self.recorded = recorded
        self.saved = None

    async def stage(self, *, invoke, **_kwargs):
        if self.recorded is not None:
            return self.recorded
        self.saved = await invoke(None)
        return self.saved


def run_provider(chunks, boundary, monkeypatch):
    # Only the policy boundary is controlled; SDK HTTP/SSE parsing stays real.
    monkeypatch.setattr(
        "dify_agent.runtime.native_effects.current_native_dispatch", lambda: SimpleNamespace(wire=lambda: {})
    )
    requests = []

    async def handler(request):
        requests.append(request)
        return build_stream_response(*chunks)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = DifyApiLLMClient(
                plugin_id="test/plugin",
                inner_api_url="http://api",
                inner_api_key="secret",
                execution_context=_execution_context(),
                agent_run_id="run",
                http_client=http,
                native_effects=boundary,
            )
            return [
                c
                async for c in client.iter_llm_result_chunks(
                    provider="model",
                    model="test",
                    prompt_messages=[UserPromptMessage(content="input")],
                    model_parameters={},
                    tools=None,
                    stop=None,
                    stream=True,
                )
            ]

    return asyncio.run(run()), requests


def streamed_chunks():
    chunks = []
    for i in range(80):
        chunk = single_text_chunk(str(i))[0].model_dump(mode="json")
        chunk["prompt_messages"] = [
            UserPromptMessage(content="repeated prompt " + ("x" * 18000)).model_dump(mode="json")
        ]
        chunk["system_fingerprint"] = "fp-" + str(i % 2)
        chunk["delta"]["index"] = i
        chunk["delta"]["finish_reason"] = "stop" if i == 79 else None
        if i == 30:
            chunk["delta"]["message"]["tool_calls"] = [
                {"id": "call", "type": "function", "function": {"name": "parse", "arguments": '{"x":1}'}}
            ]
        if i == 40:
            chunk["prompt_messages"] = [UserPromptMessage(content="different prompt").model_dump(mode="json")]
        chunks.append(LLMResultChunk.model_validate(chunk))
    return chunks


def test_repeated_prompts_fit_receipt_with_exact_stream_and_recorded_replay(monkeypatch):
    chunks = streamed_chunks()
    assert len(json.dumps([c.model_dump(mode="json") for c in chunks]).encode()) > 1024 * 1024
    boundary = ReceiptBoundary()
    emitted, requests = run_provider(chunks, boundary, monkeypatch)
    assert [c.model_dump(mode="json") for c in emitted] == [c.model_dump(mode="json") for c in chunks]
    assert len(requests) == 1
    assert len(json.dumps(boundary.saved, ensure_ascii=False).encode()) < 1024 * 1024
    replay, requests = run_provider([], ReceiptBoundary(boundary.saved), monkeypatch)
    assert [c.model_dump(mode="json") for c in replay] == [c.model_dump(mode="json") for c in chunks]
    assert requests == []


def test_legacy_list_replay_remains_exact_without_http(monkeypatch):
    chunks = single_text_chunk("legacy")
    replay, requests = run_provider([], ReceiptBoundary([c.model_dump(mode="json") for c in chunks]), monkeypatch)
    assert replay == chunks and requests == []


def test_distinct_large_output_still_stops(monkeypatch):
    chunks = [single_text_chunk("x" * 300000 + str(i))[0] for i in range(4)]
    with pytest.raises(NativePolicyStopped, match="native_model_result_too_large"):
        run_provider(chunks, ReceiptBoundary(), monkeypatch)


@pytest.mark.parametrize("ref", [-1, 1, True, "0", None])
def test_invalid_prompt_reference_is_rejected(monkeypatch, ref):
    chunk = single_text_chunk("x")[0].model_dump(mode="json")
    chunk.pop("prompt_messages")
    receipt = {"format": "dify-model-chunks-v1", "prompts": [[]], "chunks": [{"prompt_ref": ref, "chunk": chunk}]}
    with pytest.raises(UnexpectedModelBehavior, match="Invalid protected model result"):
        run_provider([], ReceiptBoundary(receipt), monkeypatch)


def test_non_native_stream_is_unchanged(monkeypatch):
    chunks = streamed_chunks()
    emitted, requests = run_provider(chunks, None, monkeypatch)
    assert emitted == chunks and len(requests) == 1
