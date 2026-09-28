from __future__ import annotations

import dify_agent.agent_stub.server.cli as cli_module


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
