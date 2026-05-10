"""Shared pytest fixtures for gateway tests."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi import FastAPI

from gateway.config import Settings
from gateway.dify.client import DifyClient
from gateway.main import create_app
from gateway.registry import CustomerEntry, CustomerRegistry, DifyConnection, ModelEntry


def make_customer(
    sdk_key: str = "bsa_test_a",
    customer_id: str = "test-a",
    model_ids: tuple[str, ...] = ("m1",),
    knowledge_bases: list[str] | None = None,
) -> CustomerEntry:
    return CustomerEntry(
        sdk_key=sdk_key,
        customer_id=customer_id,
        dify=DifyConnection(
            base_url="http://dify.test",
            console_email="admin@x",
            console_password="pw",
            dataset_api_key="ds-x",
        ),
        models=[
            ModelEntry(id=mid, provider="prov", name="n", completion_params={})
            for mid in model_ids
        ],
        knowledge_bases=knowledge_bases or [],
    )


class FakeDifyClient:
    """Async fake DifyClient: scriptable for chat-messages flows.

    Tests assign:
        * ``blocking_response``: dict returned by ``chat_messages_blocking``.
        * ``streaming_lines``: list of SSE lines yielded by
          ``chat_messages_streaming``.
        * ``console_token``: returned by ``console_login``.
        * ``import_app_ids`` / ``api_key_tokens``: deque of values.
    """

    def __init__(self) -> None:
        self.blocking_response: dict[str, Any] = {
            "id": "msg-1",
            "answer": "default reply",
            "conversation_id": "conv-1",
            "metadata": {"usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}},
        }
        self.streaming_lines: list[str] = [
            'data: {"event":"message","answer":"hi"}',
            'data: {"event":"message_end","metadata":{},"conversation_id":"conv-s"}',
        ]
        self.console_token = "jwt-1"
        self.import_app_ids = ["app-id-1", "app-id-2", "app-id-3"]
        self.api_key_tokens = ["app-key-1", "app-key-2", "app-key-3"]

        self.calls: dict[str, list[Any]] = {
            "blocking": [],
            "streaming": [],
            "login": [],
            "import": [],
            "api_key": [],
            "delete": [],
        }

    async def chat_messages_blocking(self, **kwargs: Any) -> dict[str, Any]:
        self.calls["blocking"].append(kwargs)
        return self.blocking_response

    async def chat_messages_streaming(self, **kwargs: Any) -> AsyncIterator[str]:
        self.calls["streaming"].append(kwargs)
        for line in self.streaming_lines:
            yield line

    async def console_login(self, email: str, password: str) -> str:
        self.calls["login"].append((email, password))
        return self.console_token

    async def console_import_app(self, jwt: str, yaml_content: str) -> str:
        self.calls["import"].append((jwt, yaml_content))
        return self.import_app_ids.pop(0)

    async def console_create_app_api_key(self, jwt: str, app_id: str) -> str:
        self.calls["api_key"].append((jwt, app_id))
        return self.api_key_tokens.pop(0)

    async def console_delete_app(self, jwt: str, app_id: str) -> None:
        self.calls["delete"].append((jwt, app_id))

    async def aclose(self) -> None:
        return None


@pytest.fixture
def fake_dify() -> FakeDifyClient:
    return FakeDifyClient()


@pytest.fixture
def registry() -> CustomerRegistry:
    return CustomerRegistry.from_entries([make_customer(model_ids=("m1", "m2"))])


@pytest.fixture
def settings() -> Settings:
    # Defaults are fine; tests don't need a real registry path because the
    # ``create_app`` factory accepts an injected registry.
    return Settings(registry_path="unused.yaml", log_json=False)


@pytest.fixture
def app(
    settings: Settings,
    registry: CustomerRegistry,
    fake_dify: FakeDifyClient,
) -> FastAPI:
    """Build a test FastAPI app with the FakeDifyClient injected."""
    application = create_app(settings=settings, registry=registry)

    # Override the client factory so all customers share the FakeDifyClient.
    def factory(_: CustomerEntry) -> DifyClient:  # type: ignore[return-value]
        return fake_dify  # type: ignore[return-value]

    application.state.dify_client_factory = factory
    application.state.app_manager._client_factory = factory  # noqa: SLF001
    return application
