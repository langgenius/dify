from __future__ import annotations

import base64
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from dify_agent.agent_stub.cli._drive import DrivePullResult
from dify_agent.agent_stub.cli.main import main
from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubConfigFileItemsResponse,
    AgentStubConfigFileItem,
    AgentStubConfigManifestResponse,
    AgentStubConfigSkillItemsResponse,
    AgentStubConfigSkillItem,
    AgentStubConfigVersionInfo,
    AgentStubDriveCommitResponse,
    AgentStubDriveItem,
    AgentStubDriveManifestResponse,
)
from dify_agent.agent_stub.protocol.agent_stub import AgentStubConnectResponse


def _reference(record_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"record_id": record_id}, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{payload}"


def _config_manifest_response() -> AgentStubConfigManifestResponse:
    return AgentStubConfigManifestResponse(
        agent_id="agent-1",
        config_version=AgentStubConfigVersionInfo(id="cfg-1", kind="build_draft", writable=True),
        skills=AgentStubConfigSkillItemsResponse(items=[]),
        files=AgentStubConfigFileItemsResponse(items=[]),
        env_keys=[],
        note="Runtime note.",
    )


def _patch_cli_module(monkeypatch: pytest.MonkeyPatch, accessor_name: str, **attrs: object) -> None:
    monkeypatch.setattr(
        f"dify_agent.agent_stub.cli.main.{accessor_name}",
        lambda: SimpleNamespace(**attrs),
    )


def test_cli_connect_reports_missing_environment_variables(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(["connect"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "DIFY_AGENT_STUB_API_BASE_URL" in captured.err
    assert "DIFY_AGENT_STUB_AUTH_JWE" in captured.err


def test_cli_connect_supports_json_output(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    def fake_connect_from_environment(*, argv: list[str]) -> AgentStubConnectResponse:
        assert argv == ["echo", "hello"]
        return AgentStubConnectResponse(connection_id="conn-1", status="connected")

    _patch_cli_module(monkeypatch, "_agent_stub_module", connect_from_environment=fake_connect_from_environment)

    main(["connect", "--json", "--", "echo", "hello"])

    captured = capsys.readouterr()
    assert json.loads(captured.out) == {"connection_id": "conn-1", "status": "connected"}


def test_cli_unknown_command_auto_forwards_when_agent_stub_env_is_present(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    def fake_connect_from_environment(*, argv: list[str]) -> AgentStubConnectResponse:
        assert argv == ["run", "--target", "prod"]
        return AgentStubConnectResponse(connection_id="conn-1", status="connected")

    _patch_cli_module(monkeypatch, "_agent_stub_module", connect_from_environment=fake_connect_from_environment)

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
    assert "DIFY_AGENT_STUB_API_BASE_URL" in captured.err
    assert "DIFY_AGENT_STUB_AUTH_JWE" in captured.err


def test_cli_connect_help_routes_to_typer_help(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(["connect", "--help"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert "Establish one Agent Stub connection" in captured.out
    assert "--json" in captured.out
    assert "╭" not in captured.out
    assert "─" not in captured.out


def test_cli_config_push_is_not_a_valid_command(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(["config", "push"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "No such command 'push'" in captured.err
    assert "╭" not in captured.err
    assert "─" not in captured.err


def test_cli_config_help_lists_plural_groups_and_no_root_push(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(["config", "--help"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert "Usage: dify-agent config" in captured.out
    assert "manifest" in captured.out
    assert "files" in captured.out
    assert "skills" in captured.out
    assert "env" in captured.out
    assert "note" in captured.out


@pytest.mark.parametrize("argv", [["config", "files", "--help"], ["config", "skills", "--help"]])
def test_cli_plural_config_groups_expose_pull_push_and_delete(
    capsys: pytest.CaptureFixture[str],
    argv: list[str],
) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(argv)

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert "pull" in captured.out
    assert "push" in captured.out
    assert "delete" in captured.out


@pytest.mark.parametrize("argv", [["config", "file", "--help"], ["config", "skill", "--help"]])
def test_cli_hidden_singular_alias_help_exposes_pull_only(
    capsys: pytest.CaptureFixture[str],
    argv: list[str],
) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(argv)

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert "pull" in captured.out
    assert "push" not in captured.out
    assert "delete" not in captured.out


def test_cli_reports_invalid_agent_stub_api_base_url_environment_value(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub?x=1")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    with pytest.raises(SystemExit) as exc_info:
        main(["connect"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "invalid DIFY_AGENT_STUB_API_BASE_URL" in captured.err
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
def test_cli_reports_structurally_invalid_agent_stub_api_base_url_environment_value(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    invalid_url: str,
    expected_message: str,
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", invalid_url)
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    with pytest.raises(SystemExit) as exc_info:
        main(["connect"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "invalid DIFY_AGENT_STUB_API_BASE_URL" in captured.err
    assert expected_message in captured.err


def test_cli_connect_accepts_grpc_agent_stub_api_base_url(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "grpc://agent.example.com:9091")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    def fake_connect_from_environment(*, argv: list[str]) -> AgentStubConnectResponse:
        assert argv == ["echo", "hello"]
        return AgentStubConnectResponse(connection_id="conn-1", status="connected")

    _patch_cli_module(monkeypatch, "_agent_stub_module", connect_from_environment=fake_connect_from_environment)

    main(["connect", "echo", "hello"])

    captured = capsys.readouterr()
    assert captured.out.strip() == "connected conn-1"


def test_cli_config_manifest_omits_hash_fields(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _patch_cli_module(
        monkeypatch,
        "_config_module",
        manifest_from_environment=lambda: AgentStubConfigManifestResponse(
            agent_id="agent-1",
            config_version=AgentStubConfigVersionInfo(id="cfg-1", kind="build_draft", writable=True),
            skills=AgentStubConfigSkillItemsResponse(
                items=[
                    AgentStubConfigSkillItem(
                        name="alpha",
                        description="Alpha skill.",
                        size=12,
                        hash="sha256:skill",
                        mime_type="application/zip",
                    )
                ]
            ),
            files=AgentStubConfigFileItemsResponse(
                items=[
                    AgentStubConfigFileItem(
                        name="guide.txt",
                        size=34,
                        hash="sha256:file",
                        mime_type="text/plain",
                    )
                ]
            ),
            env_keys=["RUNTIME_KEY"],
            note="Runtime note.",
        ),
    )

    with pytest.raises(SystemExit) as exc_info:
        main(["config", "manifest"])

    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert exc_info.value.code == 0
    assert payload["skills"] == {
        "items": [
            {
                "name": "alpha",
                "description": "Alpha skill.",
                "size": 12,
                "mime_type": "application/zip",
            }
        ]
    }
    assert payload["files"] == {
        "items": [
            {
                "name": "guide.txt",
                "size": 34,
                "mime_type": "text/plain",
            }
        ]
    }


@pytest.mark.parametrize(
    ("argv", "helper_name", "expected_kwargs"),
    [
        (["config", "note", "push"], "push_config_note_from_environment", {"local_path": None}),
        (
            ["config", "note", "push", "/tmp/note.md"],
            "push_config_note_from_environment",
            {"local_path": "/tmp/note.md"},
        ),
        (["config", "env", "push", "/tmp/.env"], "push_config_env_from_environment", {"local_path": "/tmp/.env"}),
        (
            ["config", "files", "push", "/tmp/guide.txt"],
            "push_config_files_from_environment",
            {"paths": ["/tmp/guide.txt"]},
        ),
        (
            ["config", "files", "delete", "old.txt", "legacy.txt"],
            "delete_config_files_from_environment",
            {"names": ["old.txt", "legacy.txt"]},
        ),
        (
            ["config", "skills", "push", "/tmp/alpha", "/tmp/beta"],
            "push_config_skills_from_environment",
            {"paths": ["/tmp/alpha", "/tmp/beta"]},
        ),
        (
            ["config", "skills", "delete", "alpha", "beta"],
            "delete_config_skills_from_environment",
            {"names": ["alpha", "beta"]},
        ),
    ],
)
def test_cli_config_mutation_commands_forward_and_print_manifest_json(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    argv: list[str],
    helper_name: str,
    expected_kwargs: dict[str, object],
) -> None:
    captured_kwargs: dict[str, object] = {}

    def fake_helper(**kwargs):
        captured_kwargs.update(kwargs)
        return _config_manifest_response()

    _patch_cli_module(monkeypatch, "_config_module", **{helper_name: fake_helper})

    with pytest.raises(SystemExit) as exc_info:
        main(argv)

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert json.loads(captured.out) == json.loads(_config_manifest_response().model_dump_json())
    assert captured_kwargs == expected_kwargs


@pytest.mark.parametrize(
    ("argv", "helper_name"),
    [
        (["config", "skills", "pull", "alpha", "--json"], "pull_config_skills_from_environment"),
        (["config", "skill", "pull", "alpha", "--json"], "pull_config_skills_from_environment"),
        (["config", "files", "pull", "guide.txt", "--json"], "pull_config_files_from_environment"),
        (["config", "file", "pull", "guide.txt", "--json"], "pull_config_files_from_environment"),
    ],
)
def test_cli_config_pull_commands_support_plural_and_hidden_singular_aliases(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    argv: list[str],
    helper_name: str,
) -> None:
    if "skills" in helper_name:
        expected_json = {
            "items": [
                {
                    "name": "alpha",
                    "archive_path": "/tmp/alpha.zip",
                    "directory_path": "/tmp/alpha",
                    "skill_md": "# Alpha\n",
                }
            ]
        }
        response = type(
            "Response",
            (),
            {"model_dump_json": lambda self: json.dumps(expected_json)},
        )()
        expected_kwargs = {"names": ["alpha"], "local_dir": None}
    else:
        expected_json = {"items": [{"name": "guide.txt", "path": "/tmp/guide.txt"}]}
        response = type(
            "Response",
            (),
            {"model_dump_json": lambda self: json.dumps(expected_json)},
        )()
        expected_kwargs = {"names": ["guide.txt"], "local_dir": None}

    captured_kwargs: dict[str, object] = {}

    def fake_helper(*, names, local_dir):
        captured_kwargs["names"] = names
        captured_kwargs["local_dir"] = local_dir
        return response

    _patch_cli_module(monkeypatch, "_config_module", **{helper_name: fake_helper})

    with pytest.raises(SystemExit) as exc_info:
        main(argv)

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert json.loads(captured.out) == expected_json
    assert captured_kwargs == expected_kwargs


@pytest.mark.parametrize(
    "argv",
    [
        ["config", "skill", "push", "/tmp/alpha"],
        ["config", "skill", "delete", "alpha"],
        ["config", "file", "push", "/tmp/guide.txt"],
        ["config", "file", "delete", "guide.txt"],
    ],
)
def test_cli_hidden_singular_aliases_do_not_expose_mutation_commands(
    capsys: pytest.CaptureFixture[str],
    argv: list[str],
) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(argv)

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "No such command" in captured.err


def test_cli_file_upload_prints_uploaded_tool_file_json(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _patch_cli_module(
        monkeypatch,
        "_files_module",
        upload_file_from_environment=lambda *, path: type(
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
    _patch_cli_module(
        monkeypatch,
        "_files_module",
        download_file_from_environment=lambda **_kwargs: type("Response", (), {"path": Path("/tmp/report.pdf")})(),
    )

    with pytest.raises(SystemExit) as exc_info:
        main(["file", "download", "tool_file", _reference("tool-file-1"), "--to", "/tmp"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert captured.out.strip() == "/tmp/report.pdf"


def test_cli_file_download_rejects_mapping_option(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called = False

    def fake_download_file_from_environment(**_kwargs):
        nonlocal called
        called = True
        return type("Response", (), {"path": Path("/tmp/inputs/report.pdf")})()

    _patch_cli_module(
        monkeypatch,
        "_files_module",
        download_file_from_environment=fake_download_file_from_environment,
    )

    with pytest.raises(SystemExit) as exc_info:
        main(
            [
                "file",
                "download",
                "--mapping",
                json.dumps({"transfer_method": "tool_file", "reference": _reference("tool-file-1")}),
                "--to",
                "/tmp/inputs",
            ]
        )

    assert exc_info.value.code == 2
    assert called is False


def test_cli_file_download_rejects_legacy_positional_directory(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    called = False

    def fake_download_file_from_environment(**_kwargs):
        nonlocal called
        called = True
        return type("Response", (), {"path": Path("/tmp/report.pdf")})()

    _patch_cli_module(
        monkeypatch,
        "_files_module",
        download_file_from_environment=fake_download_file_from_environment,
    )

    with pytest.raises(SystemExit) as exc_info:
        main(["file", "download", "tool_file", _reference("tool-file-1"), "/tmp"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert called is False
    assert "/tmp" in captured.err


def test_cli_drive_list_prints_manifest_json(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _patch_cli_module(
        monkeypatch,
        "_drive_module",
        list_drive_manifest_from_environment=lambda *, prefix: AgentStubDriveManifestResponse(
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
        format_drive_manifest=lambda response: (
            f"{response.items[0].size}\t{response.items[0].mime_type}\t{response.items[0].hash or '-'}\t"
            f"{response.items[0].key}"
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
    _patch_cli_module(
        monkeypatch,
        "_drive_module",
        list_drive_manifest_from_environment=lambda *, prefix: AgentStubDriveManifestResponse(
            items=[
                AgentStubDriveItem(
                    key=f"{prefix}example/SKILL.md",
                    size=12,
                    hash=None,
                    mime_type="text/markdown",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                )
            ]
        ),
        format_drive_manifest=lambda response: (
            f"{response.items[0].size}\t{response.items[0].mime_type}\t{response.items[0].hash or '-'}\t"
            f"{response.items[0].key}"
        ),
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
    _patch_cli_module(
        monkeypatch,
        "_drive_module",
        pull_drive_from_environment=lambda *, targets, local_base: DrivePullResult(
            items=[
                DrivePullResult.Item(
                    key=f"{targets[0]}/SKILL.md", local_path=str(Path(local_base) / targets[0] / "SKILL.md")
                ),
                DrivePullResult.Item(
                    key=f"{targets[0]}/helper.py", local_path=str(Path(local_base) / targets[0] / "helper.py")
                ),
            ]
        ),
    )

    with pytest.raises(SystemExit) as exc_info:
        main(["drive", "pull", "skills/example", "--to", "/tmp/drive"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert captured.out.strip().splitlines() == [
        "/tmp/drive/skills/example/SKILL.md",
        "/tmp/drive/skills/example/helper.py",
    ]


def test_cli_drive_pull_prints_json_result(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _patch_cli_module(
        monkeypatch,
        "_drive_module",
        pull_drive_from_environment=lambda *, targets, local_base: DrivePullResult(
            items=[
                DrivePullResult.Item(key="files/a.txt", local_path=f"{local_base}/files/a.txt"),
                DrivePullResult.Item(key="skills/foo/SKILL.md", local_path=f"{local_base}/skills/foo/SKILL.md"),
            ]
        ),
    )

    with pytest.raises(SystemExit) as exc_info:
        main(["drive", "pull", "files/a.txt", "--to", "/tmp/drive", "--json"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert json.loads(captured.out) == {
        "items": [
            {"key": "files/a.txt", "local_path": "/tmp/drive/files/a.txt"},
            {"key": "skills/foo/SKILL.md", "local_path": "/tmp/drive/skills/foo/SKILL.md"},
        ]
    }


def test_cli_drive_pull_forwards_multiple_targets(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    captured_kwargs: dict[str, object] = {}

    def fake_pull_drive_from_environment(*, targets, local_base):
        captured_kwargs["targets"] = targets
        captured_kwargs["local_base"] = local_base
        return DrivePullResult(
            items=[
                DrivePullResult.Item(
                    key="skills/foo/SKILL.md", local_path=str(Path(local_base) / "skills" / "foo" / "SKILL.md")
                )
            ]
        )

    _patch_cli_module(monkeypatch, "_drive_module", pull_drive_from_environment=fake_pull_drive_from_environment)

    with pytest.raises(SystemExit) as exc_info:
        main(["drive", "pull", "skills/foo", "files/a.txt", "--to", "/tmp/drive"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert captured_kwargs == {"targets": ["skills/foo", "files/a.txt"], "local_base": "/tmp/drive"}
    assert captured.out.strip() == "/tmp/drive/skills/foo/SKILL.md"


def test_cli_drive_pull_uses_environment_drive_base_default(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_DRIVE_BASE", "/env/drive")
    captured_kwargs: dict[str, object] = {}

    def fake_pull_drive_from_environment(*, targets, local_base):
        captured_kwargs["targets"] = targets
        captured_kwargs["local_base"] = local_base
        return DrivePullResult(
            items=[
                DrivePullResult.Item(
                    key="skills/foo/SKILL.md", local_path=str(Path(local_base) / "skills" / "foo" / "SKILL.md")
                )
            ]
        )

    _patch_cli_module(monkeypatch, "_drive_module", pull_drive_from_environment=fake_pull_drive_from_environment)

    with pytest.raises(SystemExit) as exc_info:
        main(["drive", "pull", "skills/foo"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert captured_kwargs == {"targets": ["skills/foo"], "local_base": "/env/drive"}
    assert captured.out.strip() == "/env/drive/skills/foo/SKILL.md"


def test_cli_drive_pull_keeps_historical_drive_base_when_env_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.delenv("DIFY_AGENT_STUB_DRIVE_BASE", raising=False)
    captured_kwargs: dict[str, object] = {}

    def fake_pull_drive_from_environment(*, targets, local_base):
        captured_kwargs["targets"] = targets
        captured_kwargs["local_base"] = local_base
        return DrivePullResult(
            items=[
                DrivePullResult.Item(
                    key="skills/foo/SKILL.md", local_path=str(Path(local_base) / "skills" / "foo" / "SKILL.md")
                )
            ]
        )

    _patch_cli_module(monkeypatch, "_drive_module", pull_drive_from_environment=fake_pull_drive_from_environment)

    with pytest.raises(SystemExit) as exc_info:
        main(["drive", "pull", "skills/foo"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert captured_kwargs == {"targets": ["skills/foo"], "local_base": "/mnt/drive"}
    assert captured.out.strip() == "/mnt/drive/skills/foo/SKILL.md"


def test_cli_drive_pull_without_targets_pulls_whole_visible_drive(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    captured_kwargs: dict[str, object] = {}

    def fake_pull_drive_from_environment(*, targets, local_base):
        captured_kwargs["targets"] = targets
        captured_kwargs["local_base"] = local_base
        return DrivePullResult(
            items=[DrivePullResult.Item(key="files/a.txt", local_path=str(Path(local_base) / "files" / "a.txt"))]
        )

    _patch_cli_module(monkeypatch, "_drive_module", pull_drive_from_environment=fake_pull_drive_from_environment)

    with pytest.raises(SystemExit) as exc_info:
        main(["drive", "pull", "--to", "/tmp/drive"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert captured_kwargs == {"targets": None, "local_base": "/tmp/drive"}
    assert captured.out.strip() == "/tmp/drive/files/a.txt"


def test_cli_drive_push_prints_commit_json(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _patch_cli_module(
        monkeypatch,
        "_drive_module",
        push_drive_from_environment=lambda *, local_path, drive_path, kind: AgentStubDriveCommitResponse(
            items=[
                AgentStubDriveItem(
                    key=drive_path,
                    size=12,
                    hash=None,
                    mime_type="text/markdown",
                    file_kind="tool_file",
                    file_id=Path(local_path).name,
                    value_owned_by_drive=kind != "dir",
                )
            ]
        ),
    )

    with pytest.raises(SystemExit) as exc_info:
        main(["drive", "push", "/tmp/report.md", "skills/example/SKILL.md"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert json.loads(captured.out)["items"][0]["key"] == "skills/example/SKILL.md"


def test_cli_drive_push_forwards_kind(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    captured_kwargs: dict[str, object] = {}

    def fake_push_drive_from_environment(*, local_path, drive_path, kind):
        captured_kwargs["local_path"] = local_path
        captured_kwargs["drive_path"] = drive_path
        captured_kwargs["kind"] = kind
        return AgentStubDriveCommitResponse(items=[])

    _patch_cli_module(monkeypatch, "_drive_module", push_drive_from_environment=fake_push_drive_from_environment)

    with pytest.raises(SystemExit) as exc_info:
        main(["drive", "push", "/tmp/skill", "skills/example", "--kind", "skill"])

    capsys.readouterr()
    assert exc_info.value.code == 0
    assert captured_kwargs == {
        "local_path": "/tmp/skill",
        "drive_path": "skills/example",
        "kind": "skill",
    }


def test_cli_drive_push_accepts_json_flag(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    captured_kwargs: dict[str, object] = {}

    def fake_push_drive_from_environment(*, local_path, drive_path, kind):
        captured_kwargs["local_path"] = local_path
        captured_kwargs["drive_path"] = drive_path
        captured_kwargs["kind"] = kind
        return AgentStubDriveCommitResponse(items=[])

    _patch_cli_module(monkeypatch, "_drive_module", push_drive_from_environment=fake_push_drive_from_environment)

    with pytest.raises(SystemExit) as exc_info:
        main(["drive", "push", "/tmp/report.md", "files/report.md", "--json"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 0
    assert json.loads(captured.out) == {"items": []}
    assert captured_kwargs == {
        "local_path": "/tmp/report.md",
        "drive_path": "files/report.md",
        "kind": None,
    }


def test_cli_drive_push_rejects_recursive_option(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    called = False

    def fake_push_drive_from_environment(*, local_path, drive_path, kind):
        nonlocal called
        called = True
        return AgentStubDriveCommitResponse(items=[])

    _patch_cli_module(monkeypatch, "_drive_module", push_drive_from_environment=fake_push_drive_from_environment)

    with pytest.raises(SystemExit) as exc_info:
        main(["drive", "push", "/tmp/dir", "files/dir", "--recursive"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert called is False
    assert "--recursive" in captured.err
