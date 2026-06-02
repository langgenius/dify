from __future__ import annotations

import json

import pytest

from dify_agent.cli.main import main
from dify_agent.protocol.back_proxy import BackProxyConnectResponse


def test_cli_connect_reports_missing_environment_variables(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(["connect"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "DIFY_AGENT_BACK_PROXY_URL" in captured.err
    assert "DIFY_AGENT_BACK_PROXY_AUTH_JWE" in captured.err


def test_cli_connect_supports_json_output(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_URL", "https://agent.example.com/back-proxy")
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_AUTH_JWE", "test-jwe")

    def fake_connect_from_environment(*, argv: list[str]) -> BackProxyConnectResponse:
        assert argv == ["echo", "hello"]
        return BackProxyConnectResponse(connection_id="conn-1", status="connected")

    monkeypatch.setattr("dify_agent.cli.main.connect_from_environment", fake_connect_from_environment)

    main(["connect", "--json", "--", "echo", "hello"])

    captured = capsys.readouterr()
    assert json.loads(captured.out) == {"connection_id": "conn-1", "status": "connected"}


def test_cli_unknown_command_auto_forwards_when_back_proxy_env_is_present(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_URL", "https://agent.example.com/back-proxy")
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_AUTH_JWE", "test-jwe")

    def fake_connect_from_environment(*, argv: list[str]) -> BackProxyConnectResponse:
        assert argv == ["run", "--target", "prod"]
        return BackProxyConnectResponse(connection_id="conn-1", status="connected")

    monkeypatch.setattr("dify_agent.cli.main.connect_from_environment", fake_connect_from_environment)

    main(["run", "--target", "prod"])

    captured = capsys.readouterr()
    assert captured.out.strip() == "connected conn-1"


def test_cli_unknown_command_reports_missing_environment_variables(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(["run", "--target", "prod"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "Usage: dify-agent" in captured.out
    assert "connect" in captured.out
    assert "DIFY_AGENT_BACK_PROXY_URL" in captured.err
    assert "DIFY_AGENT_BACK_PROXY_AUTH_JWE" in captured.err


def test_cli_connect_help_routes_to_typer_help(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(["connect", "--help"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert "Establish one shell back proxy connection" in captured.out
    assert "--json" in captured.out


def test_cli_reports_invalid_back_proxy_url_environment_value(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_URL", "https://agent.example.com/back-proxy?x=1")
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_AUTH_JWE", "test-jwe")

    with pytest.raises(SystemExit) as exc_info:
        main(["connect"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "invalid DIFY_AGENT_BACK_PROXY_URL" in captured.err
    assert "query string or fragment" in captured.err


@pytest.mark.parametrize(
    ("invalid_url", "expected_message"),
    [
        ("not-a-url", "http or https"),
        ("ftp://agent.example.com/back-proxy", "http or https"),
        ("https:///back-proxy", "include a host"),
    ],
)
def test_cli_reports_structurally_invalid_back_proxy_url_environment_value(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    invalid_url: str,
    expected_message: str,
) -> None:
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_URL", invalid_url)
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_AUTH_JWE", "test-jwe")

    with pytest.raises(SystemExit) as exc_info:
        main(["connect"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "invalid DIFY_AGENT_BACK_PROXY_URL" in captured.err
    assert expected_message in captured.err
