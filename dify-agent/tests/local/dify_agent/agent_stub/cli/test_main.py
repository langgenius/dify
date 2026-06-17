from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from dify_agent.agent_stub.cli.main import main
from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubDriveCommitResponse,
    AgentStubDriveItem,
    AgentStubDriveManifestResponse,
)
from dify_agent.agent_stub.protocol.agent_stub import AgentStubConnectResponse


def _reference(record_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"record_id": record_id}, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{payload}"


def test_cli_connect_reports_missing_environment_variables(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(["connect"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "DIFY_AGENT_STUB_URL" in captured.err
    assert "DIFY_AGENT_STUB_AUTH_JWE" in captured.err


def test_cli_connect_supports_json_output(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    def fake_connect_from_environment(*, argv: list[str]) -> AgentStubConnectResponse:
        assert argv == ["echo", "hello"]
        return AgentStubConnectResponse(connection_id="conn-1", status="connected")

    monkeypatch.setattr("dify_agent.agent_stub.cli.main.connect_from_environment", fake_connect_from_environment)

    main(["connect", "--json", "--", "echo", "hello"])

    captured = capsys.readouterr()
    assert json.loads(captured.out) == {"connection_id": "conn-1", "status": "connected"}


def test_cli_unknown_command_auto_forwards_when_agent_stub_env_is_present(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    def fake_connect_from_environment(*, argv: list[str]) -> AgentStubConnectResponse:
        assert argv == ["run", "--target", "prod"]
        return AgentStubConnectResponse(connection_id="conn-1", status="connected")

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
    assert "DIFY_AGENT_STUB_URL" in captured.err
    assert "DIFY_AGENT_STUB_AUTH_JWE" in captured.err


def test_cli_connect_help_routes_to_typer_help(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(["connect", "--help"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert "Establish one Agent Stub connection" in captured.out
    assert "--json" in captured.out


def test_cli_reports_invalid_agent_stub_url_environment_value(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_URL", "https://agent.example.com/agent-stub?x=1")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    with pytest.raises(SystemExit) as exc_info:
        main(["connect"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "invalid DIFY_AGENT_STUB_URL" in captured.err
    assert "query string or fragment" in captured.err


@pytest.mark.parametrize(
    ("invalid_url", "expected_message"),
    [
        ("not-a-url", "http, https, or grpc"),
        ("ftp://agent.example.com/agent-stub", "http, https, or grpc"),
        ("https:///agent-stub", "include a host"),
        ("grpc://agent.example.com", "explicit port"),
    ],
)
def test_cli_reports_structurally_invalid_agent_stub_url_environment_value(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    invalid_url: str,
    expected_message: str,
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_URL", invalid_url)
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    with pytest.raises(SystemExit) as exc_info:
        main(["connect"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "invalid DIFY_AGENT_STUB_URL" in captured.err
    assert expected_message in captured.err


def test_cli_connect_accepts_grpc_agent_stub_url(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_URL", "grpc://agent.example.com:9091")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    def fake_connect_from_environment(*, argv: list[str]) -> AgentStubConnectResponse:
        assert argv == ["echo", "hello"]
        return AgentStubConnectResponse(connection_id="conn-1", status="connected")

    monkeypatch.setattr("dify_agent.agent_stub.cli.main.connect_from_environment", fake_connect_from_environment)

    main(["connect", "echo", "hello"])

    captured = capsys.readouterr()
    assert captured.out.strip() == "connected conn-1"


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


def test_cli_drive_list_prints_manifest_json(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli.main.list_drive_from_environment",
        lambda *, prefix, json_output: AgentStubDriveManifestResponse(
            items=[
                AgentStubDriveItem(
                    key=prefix + "example/SKILL.md",
                    size=12,
                    hash="sha256:abc",
                    mime_type="text/markdown",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                )
            ]
        ),
    )

    with pytest.raises(SystemExit) as exc_info:
        main(["drive", "list", "skills/", "--json"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert json.loads(captured.out)["items"][0]["key"] == "skills/example/SKILL.md"


def test_cli_drive_list_prints_human_readable_listing(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli.main.list_drive_from_environment",
        lambda *, prefix, json_output: f"12\ttext/markdown\t-\t{prefix}example/SKILL.md",
    )

    with pytest.raises(SystemExit) as exc_info:
        main(["drive", "list", "skills/"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert captured.out.strip() == "12\ttext/markdown\t-\tskills/example/SKILL.md"


def test_cli_drive_pull_prints_downloaded_paths(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli.main.pull_drive_from_environment",
        lambda *, prefix, drive_base: [Path(drive_base) / prefix / "SKILL.md", Path(drive_base) / prefix / "helper.py"],
    )

    with pytest.raises(SystemExit) as exc_info:
        main(["drive", "pull", "skills/example", "--drive-base", "/tmp/drive"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert captured.out.strip().splitlines() == [
        "/tmp/drive/skills/example/SKILL.md",
        "/tmp/drive/skills/example/helper.py",
    ]


def test_cli_drive_push_prints_commit_json(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli.main.push_drive_from_environment",
        lambda *, local_path, drive_path, recursive: AgentStubDriveCommitResponse(
            items=[
                AgentStubDriveItem(
                    key=drive_path,
                    size=12,
                    hash=None,
                    mime_type="text/markdown",
                    file_kind="tool_file",
                    file_id=Path(local_path).name,
                    value_owned_by_drive=recursive is False,
                )
            ]
        ),
    )

    with pytest.raises(SystemExit) as exc_info:
        main(["drive", "push", "/tmp/report.md", "skills/example/SKILL.md"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert json.loads(captured.out)["items"][0]["key"] == "skills/example/SKILL.md"
