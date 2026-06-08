from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from dify_agent.agent_stub.cli.main import main
from dify_agent.agent_stub.protocol.back_proxy import BackProxyConnectResponse


def _reference(record_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"record_id": record_id}, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{payload}"


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

    monkeypatch.setattr("dify_agent.agent_stub.cli.main.connect_from_environment", fake_connect_from_environment)

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

    monkeypatch.setattr("dify_agent.agent_stub.cli.main.connect_from_environment", fake_connect_from_environment)

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


def test_cli_file_upload_prints_uploaded_tool_file_json(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli.main.upload_file_from_environment",
        lambda *, path: type(
            "Response",
            (),
            {
                "model_dump_json": lambda self: json.dumps(
                    {
                        "transfer_method": "tool_file",
                        "reference": _reference(Path(path).name),
                    }
                )
            },
        )(),
    )

    with pytest.raises(SystemExit) as exc_info:
        main(["file", "upload", "/tmp/report.pdf"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert json.loads(captured.out) == {
        "transfer_method": "tool_file",
        "reference": _reference("report.pdf"),
    }


def test_cli_file_download_prints_saved_path(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli.main.download_file_from_environment",
        lambda **_kwargs: type("Response", (), {"path": Path("/tmp/report.pdf")})(),
    )

    with pytest.raises(SystemExit) as exc_info:
        main(["file", "download", "tool_file", _reference("tool-file-1"), "/tmp"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert captured.out.strip() == "/tmp/report.pdf"
