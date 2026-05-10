"""Integration tests for ``POST /v1/chat/completions`` (streaming mode)."""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi import FastAPI

from tests.conftest import FakeDifyClient


def _parse_data_lines(body_text: str) -> list[dict | str]:
    out: list[dict | str] = []
    for line in body_text.splitlines():
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


@pytest.mark.asyncio
async def test_streaming_yields_openai_chunks(
    app: FastAPI, fake_dify: FakeDifyClient
) -> None:
    fake_dify.streaming_lines = [
        'data: {"event":"message","answer":"He"}',
        "",
        'data: {"event":"message","answer":"llo"}',
        "",
        'data: {"event":"message_end","conversation_id":"c-9","metadata":{'
        '"retriever_resources":[{"content":"a chunk","score":0.7,"document_name":"d1"}]}}',
        "",
    ]

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as cli:
        async with cli.stream(
            "POST",
            "/v1/chat/completions",
            headers={"Authorization": "Bearer bsa_test_a"},
            json={
                "model": "m1",
                "messages": [{"role": "user", "content": "Hi"}],
                "stream": True,
            },
        ) as r:
            assert r.status_code == 200
            assert r.headers["content-type"].startswith("text/event-stream")
            text = await r.aread()
            body = text.decode("utf-8")

    payloads = _parse_data_lines(body)

    # First non-DONE: role=assistant, content="He"
    first = payloads[0]
    assert first["object"] == "chat.completion.chunk"  # type: ignore[index]
    assert first["choices"][0]["delta"]["role"] == "assistant"  # type: ignore[index]
    assert first["choices"][0]["delta"]["content"] == "He"  # type: ignore[index]

    # Second: content="llo", no role
    assert payloads[1]["choices"][0]["delta"]["content"] == "llo"  # type: ignore[index]

    # Final non-DONE: finish_reason=stop, references in metadata
    final = payloads[-2]
    assert final["choices"][0]["finish_reason"] == "stop"  # type: ignore[index]
    assert final["choices"][0]["delta"]["metadata"]["conversation_id"] == "c-9"  # type: ignore[index]
    assert len(final["choices"][0]["delta"]["metadata"]["references"]) == 1  # type: ignore[index]

    # Terminator
    assert payloads[-1] == "[DONE]"


@pytest.mark.asyncio
async def test_streaming_unknown_model_returns_404_json(app: FastAPI) -> None:
    """Unknown model errors before streaming begins → standard JSON error."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as cli:
        r = await cli.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer bsa_test_a"},
            json={
                "model": "nope",
                "messages": [{"role": "user", "content": "hi"}],
                "stream": True,
            },
        )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "model_not_found"


@pytest.mark.asyncio
async def test_streaming_passes_conversation_id_to_dify(
    app: FastAPI, fake_dify: FakeDifyClient
) -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as cli:
        async with cli.stream(
            "POST",
            "/v1/chat/completions",
            headers={"Authorization": "Bearer bsa_test_a"},
            json={
                "model": "m1",
                "messages": [{"role": "user", "content": "Hi"}],
                "stream": True,
                "conversation_id": "conv-passed-in",
            },
        ) as r:
            await r.aread()

    sent = fake_dify.calls["streaming"][0]
    assert sent["conversation_id"] == "conv-passed-in"
