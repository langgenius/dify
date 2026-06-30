from __future__ import annotations

from typing import ClassVar

from fastapi import FastAPI

import dify_agent.server.observability as observability
from dify_agent.server.observability import configure_server_observability


class FakeLogfireModule:
    configure_calls: ClassVar[list[dict[str, object]]] = []
    fastapi_calls: ClassVar[list[dict[str, object]]] = []
    httpx_calls: ClassVar[list[dict[str, object]]] = []
    redis_calls: ClassVar[list[dict[str, object]]] = []
    pydantic_ai_calls: ClassVar[list[dict[str, object]]] = []

    @classmethod
    def reset(cls) -> None:
        cls.configure_calls.clear()
        cls.fastapi_calls.clear()
        cls.httpx_calls.clear()
        cls.redis_calls.clear()
        cls.pydantic_ai_calls.clear()

    @classmethod
    def configure(cls, **kwargs: object) -> None:
        cls.configure_calls.append(kwargs)

    @classmethod
    def instrument_fastapi(cls, app: FastAPI, **kwargs: object) -> None:
        cls.fastapi_calls.append({"app": app, **kwargs})

    @classmethod
    def instrument_httpx(cls, **kwargs: object) -> None:
        cls.httpx_calls.append(kwargs)

    @classmethod
    def instrument_redis(cls, **kwargs: object) -> None:
        cls.redis_calls.append(kwargs)

    @classmethod
    def instrument_pydantic_ai(cls, **kwargs: object) -> None:
        cls.pydantic_ai_calls.append(kwargs)


def test_configure_server_observability_keeps_remote_export_token_gated_by_logfire_env(monkeypatch) -> None:
    FakeLogfireModule.reset()
    monkeypatch.setattr(observability, "logfire", FakeLogfireModule)
    monkeypatch.setattr(observability, "_global_instrumentation_ready", False)
    app = FastAPI()

    configure_server_observability(app)

    assert FakeLogfireModule.configure_calls == [
        {
            "send_to_logfire": "if-token-present",
            "inspect_arguments": False,
        }
    ]


def test_configure_server_observability_instruments_server_boundaries_once(monkeypatch) -> None:
    FakeLogfireModule.reset()
    monkeypatch.setattr(observability, "logfire", FakeLogfireModule)
    monkeypatch.setattr(observability, "_global_instrumentation_ready", False)
    first_app = FastAPI()
    second_app = FastAPI()

    configure_server_observability(first_app)
    configure_server_observability(second_app)

    assert FakeLogfireModule.httpx_calls == [{}]
    assert FakeLogfireModule.redis_calls == [{}]
    assert FakeLogfireModule.pydantic_ai_calls == [{}]
    assert FakeLogfireModule.fastapi_calls == [
        {"app": first_app},
        {"app": second_app},
    ]
    assert first_app.state.dify_agent_logfire_instrumented is True
    assert second_app.state.dify_agent_logfire_instrumented is True
