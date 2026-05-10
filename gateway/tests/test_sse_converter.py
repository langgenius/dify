"""Tests for Dify SSE → OpenAI chunk conversion."""

from __future__ import annotations

import json
from collections.abc import AsyncIterable, AsyncIterator

import pytest

from gateway.streaming.converter import dify_to_openai_chunks, parse_dify_sse_line


async def _alines(lines: list[str]) -> AsyncIterator[str]:
    for line in lines:
        yield line


def _data_payloads(chunks: list[str]) -> list[dict | str]:
    """Parse SSE chunks into JSON payloads (or '[DONE]')."""
    out: list[dict | str] = []
    for chunk in chunks:
        for line in chunk.splitlines():
            if not line.startswith("data:"):
                continue
            payload = line[len("data:") :].strip()
            if not payload:
                continue
            if payload == "[DONE]":
                out.append("[DONE]")
            else:
                out.append(json.loads(payload))
    return out


class TestParseDifySseLine:
    def test_data_json_returns_dict(self) -> None:
        assert parse_dify_sse_line('data: {"event":"message"}') == {"event": "message"}

    def test_blank_returns_none(self) -> None:
        assert parse_dify_sse_line("") is None
        assert parse_dify_sse_line("\n") is None

    def test_done_returns_none(self) -> None:
        assert parse_dify_sse_line("data: [DONE]") is None

    def test_invalid_json_returns_none(self) -> None:
        assert parse_dify_sse_line("data: not json {") is None

    def test_non_data_line_returns_none(self) -> None:
        assert parse_dify_sse_line("event: ping") is None

    def test_array_json_returns_none(self) -> None:
        # Defensive: only dict events are forwarded.
        assert parse_dify_sse_line("data: [1,2]") is None


@pytest.mark.asyncio
async def test_message_chunks_translated_to_openai_chunks() -> None:
    dify_stream = [
        'data: {"event":"message","answer":"He"}',
        "",
        'data: {"event":"message","answer":"llo"}',
        "",
        'data: {"event":"message_end","metadata":{},"conversation_id":"c-1"}',
        "",
    ]
    chunks = [c async for c in dify_to_openai_chunks(_alines(dify_stream), request_id="req-1", model_id="m1")]
    payloads = _data_payloads(chunks)

    # First payload: role=assistant + content="He"
    first = payloads[0]
    assert first["object"] == "chat.completion.chunk"  # type: ignore[index]
    assert first["model"] == "m1"  # type: ignore[index]
    assert first["choices"][0]["delta"]["role"] == "assistant"  # type: ignore[index]
    assert first["choices"][0]["delta"]["content"] == "He"  # type: ignore[index]

    # Second payload: content="llo", no role
    second = payloads[1]
    assert "role" not in second["choices"][0]["delta"]  # type: ignore[index]
    assert second["choices"][0]["delta"]["content"] == "llo"  # type: ignore[index]

    # Final non-DONE: finish_reason=stop, conversation_id in metadata
    final = payloads[-2]
    assert final["choices"][0]["finish_reason"] == "stop"  # type: ignore[index]
    assert final["choices"][0]["delta"]["metadata"]["conversation_id"] == "c-1"  # type: ignore[index]

    # Last payload: [DONE]
    assert payloads[-1] == "[DONE]"


@pytest.mark.asyncio
async def test_references_attached_to_final_chunk() -> None:
    dify_stream = [
        'data: {"event":"message","answer":"hi"}',
        'data: {"event":"message_end","conversation_id":"c-9","metadata":{"retriever_resources":['
        '{"content":"chunk one","score":0.81,"document_name":"d1","document_id":"d-1","segment_id":"s-1"}'
        "]}}",
    ]
    chunks = [c async for c in dify_to_openai_chunks(_alines(dify_stream), request_id="req-1", model_id="m1")]
    payloads = _data_payloads(chunks)
    final = payloads[-2]

    refs = final["choices"][0]["delta"]["metadata"]["references"]  # type: ignore[index]
    assert len(refs) == 1
    assert refs[0]["content"] == "chunk one"
    assert refs[0]["score"] == 0.81
    assert refs[0]["document_name"] == "d1"


@pytest.mark.asyncio
async def test_error_event_short_circuits_with_content_filter_finish() -> None:
    dify_stream = [
        'data: {"event":"message","answer":"part"}',
        'data: {"event":"error","code":"unknown","message":"boom"}',
    ]
    chunks = [c async for c in dify_to_openai_chunks(_alines(dify_stream), request_id="req-1", model_id="m1")]
    payloads = _data_payloads(chunks)
    final = payloads[-2]
    assert final["choices"][0]["finish_reason"] == "content_filter"  # type: ignore[index]
    assert payloads[-1] == "[DONE]"


@pytest.mark.asyncio
async def test_ping_events_ignored() -> None:
    dify_stream = [
        'data: {"event":"ping"}',
        'data: {"event":"message","answer":"x"}',
        'data: {"event":"ping"}',
        'data: {"event":"message_end","metadata":{}}',
    ]
    chunks = [c async for c in dify_to_openai_chunks(_alines(dify_stream), request_id="req-1", model_id="m1")]
    payloads = _data_payloads(chunks)
    # 1 message chunk + 1 final + DONE
    assert len(payloads) == 3
    assert payloads[0]["choices"][0]["delta"]["content"] == "x"  # type: ignore[index]


@pytest.mark.asyncio
async def test_empty_answer_chunks_skipped() -> None:
    dify_stream = [
        'data: {"event":"message","answer":""}',
        'data: {"event":"message","answer":"real"}',
        'data: {"event":"message_end","metadata":{}}',
    ]
    chunks = [c async for c in dify_to_openai_chunks(_alines(dify_stream), request_id="req-1", model_id="m1")]
    payloads = _data_payloads(chunks)
    # Only the "real" chunk + final + DONE
    assert len(payloads) == 3
    assert payloads[0]["choices"][0]["delta"]["content"] == "real"  # type: ignore[index]
