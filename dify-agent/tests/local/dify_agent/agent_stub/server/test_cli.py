from __future__ import annotations

import asyncio
from typing import cast

import dify_agent.agent_stub.server.cli as cli_module
from dify_agent.server.settings import ServerSettings


def test_stub_server_cli_uses_default_uvicorn_settings(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_run(app: str, *, host: str, port: int, reload: bool) -> None:
        captured.update(app=app, host=host, port=port, reload=reload)

    monkeypatch.setattr(cli_module.uvicorn, "run", fake_run)

    cli_module.main([])

    assert captured == {
        "app": "dify_agent.agent_stub.server.app:app",
        "host": "127.0.0.1",
        "port": 8001,
        "reload": False,
    }


def test_stub_server_cli_passes_explicit_uvicorn_settings(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_run(app: str, *, host: str, port: int, reload: bool) -> None:
        captured.update(app=app, host=host, port=port, reload=reload)

    monkeypatch.setattr(cli_module.uvicorn, "run", fake_run)

    cli_module.main(["--host", "0.0.0.0", "--port", "9000", "--reload"])

    assert captured == {
        "app": "dify_agent.agent_stub.server.app:app",
        "host": "0.0.0.0",
        "port": 9000,
        "reload": True,
    }


def test_stub_server_cli_switches_to_grpc_when_agent_stub_api_base_url_uses_grpc(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def fake_serve_grpc(*, settings, host, port) -> None:
        captured.update(settings=settings, host=host, port=port)

    monkeypatch.setattr(cli_module, "_serve_grpc", fake_serve_grpc)
    monkeypatch.setattr(
        cli_module, "ServerSettings", lambda: type("Settings", (), {"agent_stub_api_base_url": "grpc://agent:9091"})()
    )

    cli_module.main(["--host", "0.0.0.0", "--port", "9092"])

    assert captured["host"] == "0.0.0.0"
    assert captured["port"] == 9092


def test_serve_grpc_derives_default_bind_target_and_closes_server(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeServer:
        def __init__(self) -> None:
            self.closed = False

        async def aclose(self) -> None:
            self.closed = True

    fake_server = FakeServer()

    async def fake_start_agent_stub_grpc_server(**kwargs):
        captured.update(kwargs)
        return fake_server

    class FakeEvent:
        async def wait(self) -> None:
            return None

    settings = type(
        "Settings",
        (),
        {
            "agent_stub_api_base_url": "grpc://agent.example.com:9091",
            "agent_stub_grpc_bind_address": None,
            "create_agent_stub_token_codec": lambda self: "token-codec",
            "create_agent_stub_file_request_handler": lambda self: "file-handler",
        },
    )()

    monkeypatch.setattr(cli_module, "start_agent_stub_grpc_server", fake_start_agent_stub_grpc_server)
    monkeypatch.setattr(cli_module.asyncio, "Event", FakeEvent)

    asyncio.run(cli_module._serve_grpc(settings=cast(ServerSettings, cast(object, settings)), host=None, port=None))

    assert captured == {
        "public_url": "grpc://agent.example.com:9091",
        "bind_address": "0.0.0.0:9091",
        "token_codec": "token-codec",
        "file_request_handler": "file-handler",
    }
    assert fake_server.closed is True


def test_serve_grpc_applies_cli_host_port_overrides(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeServer:
        async def aclose(self) -> None:
            return None

    async def fake_start_agent_stub_grpc_server(**kwargs):
        captured.update(kwargs)
        return FakeServer()

    class FakeEvent:
        async def wait(self) -> None:
            return None

    settings = type(
        "Settings",
        (),
        {
            "agent_stub_api_base_url": "grpc://agent.example.com:9091",
            "agent_stub_grpc_bind_address": "127.0.0.1:9191",
            "create_agent_stub_token_codec": lambda self: None,
            "create_agent_stub_file_request_handler": lambda self: None,
        },
    )()

    monkeypatch.setattr(cli_module, "start_agent_stub_grpc_server", fake_start_agent_stub_grpc_server)
    monkeypatch.setattr(cli_module.asyncio, "Event", FakeEvent)

    asyncio.run(
        cli_module._serve_grpc(settings=cast(ServerSettings, cast(object, settings)), host="0.0.0.0", port=9292)
    )

    assert captured["bind_address"] == "0.0.0.0:9292"
