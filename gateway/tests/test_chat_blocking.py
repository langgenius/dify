"""Integration tests for ``POST /v1/chat/completions`` (blocking mode)."""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI

from tests.conftest import FakeDifyClient


@pytest.mark.asyncio
async def test_blocking_happy_path(app: FastAPI, fake_dify: FakeDifyClient) -> None:
    fake_dify.blocking_response = {
        "id": "msg-1",
        "answer": "Hello there!",
        "conversation_id": "conv-x",
        "metadata": {
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            "retriever_resources": [
                {"content": "ref one", "score": 0.9, "document_name": "d1"},
            ],
        },
    }

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as cli:
        r = await cli.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer bsa_test_a"},
            json={
                "model": "m1",
                "messages": [{"role": "user", "content": "Hi"}],
            },
        )

    assert r.status_code == 200
    body = r.json()
    assert body["object"] == "chat.completion"
    assert body["model"] == "m1"
    assert body["choices"][0]["message"]["content"] == "Hello there!"

    # Metadata: references + conversation_id surfaced (R6).
    md = body["choices"][0]["message"]["metadata"]
    assert md["conversation_id"] == "conv-x"
    assert len(md["references"]) == 1
    assert md["references"][0]["content"] == "ref one"
    assert md["references"][0]["score"] == 0.9

    # Usage echoed.
    assert body["usage"]["prompt_tokens"] == 10
    assert body["usage"]["completion_tokens"] == 5
    assert body["usage"]["total_tokens"] == 15


@pytest.mark.asyncio
async def test_blocking_unknown_sdk_key_returns_401(app: FastAPI) -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as cli:
        r = await cli.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer wrong"},
            json={"model": "m1", "messages": [{"role": "user", "content": "hi"}]},
        )
    assert r.status_code == 401
    body = r.json()
    assert body["error"]["code"] == "invalid_sdk_key"


@pytest.mark.asyncio
async def test_blocking_missing_authorization_returns_401(app: FastAPI) -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as cli:
        r = await cli.post(
            "/v1/chat/completions",
            json={"model": "m1", "messages": [{"role": "user", "content": "hi"}]},
        )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_blocking_unknown_model_returns_404(app: FastAPI) -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as cli:
        r = await cli.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer bsa_test_a"},
            json={"model": "m_doesnt_exist", "messages": [{"role": "user", "content": "hi"}]},
        )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "model_not_found"


@pytest.mark.asyncio
async def test_blocking_no_user_message_returns_400(app: FastAPI) -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as cli:
        r = await cli.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer bsa_test_a"},
            json={
                "model": "m1",
                "messages": [{"role": "system", "content": "no user message here"}],
            },
        )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_request"


@pytest.mark.asyncio
async def test_blocking_forwards_history_and_conversation_id(
    app: FastAPI, fake_dify: FakeDifyClient
) -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as cli:
        await cli.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer bsa_test_a"},
            json={
                "model": "m1",
                "messages": [
                    {"role": "system", "content": "Be concise."},
                    {"role": "user", "content": "Q1"},
                    {"role": "assistant", "content": "A1"},
                    {"role": "user", "content": "Q2"},
                ],
                "conversation_id": "conv-from-client",
            },
        )

    sent = fake_dify.calls["blocking"][0]
    assert sent["query"] == "Q2"
    assert sent["conversation_id"] == "conv-from-client"
    assert "history" in sent["inputs"]
    assert "system: Be concise." in sent["inputs"]["history"]
    assert "user: Q1" in sent["inputs"]["history"]
    assert "assistant: A1" in sent["inputs"]["history"]


@pytest.mark.asyncio
async def test_extra_body_llm_model_overrides_app_selection(
    app: FastAPI, fake_dify: FakeDifyClient
) -> None:
    """Regression for review-3 P2: clients passing extra_body={'llm_model':...} via
    the OpenAI SDK get the override field at the JSON top level. The router
    must use that value (not body.model) for App selection, and echo it in
    the response.
    """
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as cli:
        r = await cli.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer bsa_test_a"},
            json={
                "model": "placeholder-ignored",
                "llm_model": "m2",  # the registry has m1 and m2
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
    assert r.status_code == 200
    body = r.json()
    # Response model echoes the *override*, not the placeholder.
    assert body["model"] == "m2"


@pytest.mark.asyncio
async def test_extra_body_llm_model_unknown_returns_404(
    app: FastAPI,
) -> None:
    """When extra_body.llm_model points to a model the customer is not
    enabled for, return 404 (not 200 from the placeholder ``model`` field)."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as cli:
        r = await cli.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer bsa_test_a"},
            json={
                "model": "m1",  # valid, would have succeeded
                "llm_model": "m_does_not_exist",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "model_not_found"


@pytest.mark.asyncio
async def test_request_id_echoed_in_response_header(app: FastAPI) -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as cli:
        r = await cli.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer bsa_test_a", "X-Request-Id": "trace-9"},
            json={"model": "m1", "messages": [{"role": "user", "content": "hi"}]},
        )
    assert r.headers.get("x-request-id") == "trace-9"
