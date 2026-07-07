from __future__ import annotations

import io
import zipfile
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest

from dify_agent.agent_stub.cli import _config as config_cli
from dify_agent.agent_stub.cli._env import AgentStubEnvironment
from dify_agent.agent_stub.client._errors import AgentStubValidationError
from dify_agent.agent_stub.protocol.agent_stub import AgentStubConfigManifestResponse, AgentStubConfigPushRequest


def _manifest_payload() -> AgentStubConfigManifestResponse:
    return AgentStubConfigManifestResponse.model_validate(
        {
            "agent_id": "agent-1",
            "config_version": {"id": "cfg-1", "kind": "build_draft", "writable": True},
            "skills": {"items": [{"name": "alpha", "description": "Alpha skill"}]},
            "files": {"items": [{"name": "guide.txt"}]},
            "env_keys": ["API_KEY", "JSON_VALUE"],
            "note": "Use carefully.",
        }
    )


def _zip_bytes(members: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, payload in members.items():
            archive.writestr(name, payload)
    return buffer.getvalue()


def _environment() -> AgentStubEnvironment:
    return AgentStubEnvironment(url="https://agent.example.com/agent-stub", auth_jwe="test-jwe")


def test_pull_config_skills_from_environment_downloads_and_extracts_archives(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(config_cli, "read_agent_stub_environment", lambda: _environment())
    monkeypatch.setattr(config_cli, "request_agent_stub_config_manifest_sync", lambda **_kwargs: _manifest_payload())
    monkeypatch.setattr(
        config_cli,
        "request_agent_stub_config_skill_pull_sync",
        lambda **_kwargs: _zip_bytes({"SKILL.md": b"# Alpha\n", "refs/spec.md": b"spec"}),
    )

    result = config_cli.pull_config_skills_from_environment(local_dir=str(tmp_path))

    assert [item.name for item in result.items] == ["alpha"]
    assert Path(result.items[0].archive_path).read_bytes()
    assert Path(result.items[0].directory_path, "SKILL.md").read_text(encoding="utf-8") == "# Alpha\n"
    assert result.items[0].skill_md == "# Alpha\n"


def test_pull_config_files_from_environment_downloads_visible_files(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(config_cli, "read_agent_stub_environment", lambda: _environment())
    monkeypatch.setattr(config_cli, "request_agent_stub_config_manifest_sync", lambda **_kwargs: _manifest_payload())
    monkeypatch.setattr(
        config_cli,
        "request_agent_stub_config_file_pull_sync",
        lambda **_kwargs: b"guide-bytes",
    )

    result = config_cli.pull_config_files_from_environment(local_dir=str(tmp_path))

    assert result.items == [config_cli.ConfigFilePullResult.Item(name="guide.txt", path=str(tmp_path / "guide.txt"))]
    assert (tmp_path / "guide.txt").read_bytes() == b"guide-bytes"


def test_pull_config_note_uses_hidden_default_dir(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(config_cli, "manifest_from_environment", _manifest_payload)

    note_path = config_cli.pull_config_note_from_environment()

    assert note_path == (tmp_path / ".dify_conf" / "note.md").resolve()
    assert note_path.read_text(encoding="utf-8") == "Use carefully."


def test_push_config_note_from_environment_reads_default_file(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.chdir(tmp_path)
    note_path = tmp_path / ".dify_conf" / "note.md"
    note_path.parent.mkdir()
    note_path.write_text("hello", encoding="utf-8")
    monkeypatch.setattr(config_cli, "read_agent_stub_environment", lambda: _environment())

    captured: dict[str, object] = {}

    def fake_push_sync(**kwargs):
        captured.update(kwargs)
        return _manifest_payload()

    monkeypatch.setattr(config_cli, "request_agent_stub_config_push_sync", fake_push_sync)

    response = config_cli.push_config_note_from_environment(None)

    assert response.agent_id == "agent-1"
    request = cast(AgentStubConfigPushRequest, captured["request"])
    assert request.note == "hello"
    assert request.env_text is None
    assert request.files == []
    assert request.skills == []


def test_push_config_note_from_environment_reads_explicit_file(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    note_path = tmp_path / "note.md"
    note_path.write_text("explicit", encoding="utf-8")
    monkeypatch.setattr(config_cli, "read_agent_stub_environment", lambda: _environment())

    captured: dict[str, object] = {}

    def fake_push_sync(**kwargs):
        captured.update(kwargs)
        return _manifest_payload()

    monkeypatch.setattr(config_cli, "request_agent_stub_config_push_sync", fake_push_sync)

    config_cli.push_config_note_from_environment(str(note_path))

    request = cast(AgentStubConfigPushRequest, captured["request"])
    assert request.note == "explicit"


def test_push_config_note_from_environment_reads_stdin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config_cli, "read_agent_stub_environment", lambda: _environment())
    monkeypatch.setattr(config_cli.os, "dup", lambda _fd: 99)
    monkeypatch.setattr(config_cli.os, "fdopen", lambda _fd, encoding: io.StringIO("from-stdin"))

    captured: dict[str, object] = {}

    def fake_push_sync(**kwargs):
        captured.update(kwargs)
        return _manifest_payload()

    monkeypatch.setattr(config_cli, "request_agent_stub_config_push_sync", fake_push_sync)

    config_cli.push_config_note_from_environment("-")

    request = cast(AgentStubConfigPushRequest, captured["request"])
    assert request.note == "from-stdin"


def test_push_config_env_from_environment_reads_explicit_file(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    env_path = tmp_path / "custom.env"
    env_path.write_text("API_KEY=custom\n", encoding="utf-8")
    monkeypatch.setattr(config_cli, "read_agent_stub_environment", lambda: _environment())

    captured: dict[str, object] = {}

    def fake_push_sync(**kwargs):
        captured.update(kwargs)
        return _manifest_payload()

    monkeypatch.setattr(config_cli, "request_agent_stub_config_push_sync", fake_push_sync)

    config_cli.push_config_env_from_environment(str(env_path))

    request = cast(AgentStubConfigPushRequest, captured["request"])
    assert request.env_text == "API_KEY=custom\n"


def test_push_config_env_from_environment_reads_stdin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config_cli, "read_agent_stub_environment", lambda: _environment())
    monkeypatch.setattr(config_cli.os, "dup", lambda _fd: 99)
    monkeypatch.setattr(config_cli.os, "fdopen", lambda _fd, encoding: io.StringIO("API_KEY=stdin\n"))

    captured: dict[str, object] = {}

    def fake_push_sync(**kwargs):
        captured.update(kwargs)
        return _manifest_payload()

    monkeypatch.setattr(config_cli, "request_agent_stub_config_push_sync", fake_push_sync)

    config_cli.push_config_env_from_environment("-")

    request = cast(AgentStubConfigPushRequest, captured["request"])
    assert request.env_text == "API_KEY=stdin\n"


def test_push_config_files_from_environment_builds_upload_items(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    file_path = tmp_path / "guide.txt"
    file_path.write_text("guide", encoding="utf-8")
    monkeypatch.setattr(config_cli, "read_agent_stub_environment", lambda: _environment())
    monkeypatch.setattr(
        config_cli,
        "upload_tool_file_resource_from_environment",
        lambda *, path: SimpleNamespace(tool_file_id=f"tool-file:{Path(path).name}"),
    )

    captured: dict[str, object] = {}

    def fake_push_sync(**kwargs):
        captured.update(kwargs)
        return _manifest_payload()

    monkeypatch.setattr(config_cli, "request_agent_stub_config_push_sync", fake_push_sync)

    config_cli.push_config_files_from_environment([str(file_path)])

    request = cast(AgentStubConfigPushRequest, captured["request"])
    assert request.files[0].name == "guide.txt"
    assert request.files[0].file_ref is not None
    assert request.files[0].file_ref.id == "tool-file:guide.txt"
    assert request.skills == []


def test_push_config_files_from_environment_rejects_empty_paths() -> None:
    with pytest.raises(AgentStubValidationError, match="at least one file path is required"):
        config_cli.push_config_files_from_environment([])


def test_delete_config_files_from_environment_builds_delete_items(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config_cli, "read_agent_stub_environment", lambda: _environment())

    captured: dict[str, object] = {}

    def fake_push_sync(**kwargs):
        captured.update(kwargs)
        return _manifest_payload()

    monkeypatch.setattr(config_cli, "request_agent_stub_config_push_sync", fake_push_sync)

    config_cli.delete_config_files_from_environment(["old.txt", "legacy.txt"])

    request = cast(AgentStubConfigPushRequest, captured["request"])
    assert [item.name for item in request.files] == ["old.txt", "legacy.txt"]
    assert all(item.file_ref is None for item in request.files)


def test_delete_config_files_from_environment_rejects_empty_names() -> None:
    with pytest.raises(AgentStubValidationError, match="at least one file name is required"):
        config_cli.delete_config_files_from_environment([])


def test_push_config_skills_from_environment_builds_archive_upload_items(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    skill_dir = tmp_path / "alpha"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text("# Alpha\n", encoding="utf-8")
    uploaded_paths: list[str] = []
    monkeypatch.setattr(config_cli, "read_agent_stub_environment", lambda: _environment())

    def fake_upload_tool_file_resource_from_environment(*, path: str):
        uploaded_paths.append(path)
        return SimpleNamespace(tool_file_id=f"tool-file-{len(uploaded_paths)}")

    monkeypatch.setattr(
        config_cli,
        "upload_tool_file_resource_from_environment",
        fake_upload_tool_file_resource_from_environment,
    )

    captured: dict[str, object] = {}

    def fake_push_sync(**kwargs):
        captured.update(kwargs)
        return _manifest_payload()

    monkeypatch.setattr(config_cli, "request_agent_stub_config_push_sync", fake_push_sync)

    config_cli.push_config_skills_from_environment([str(skill_dir)])

    request = cast(AgentStubConfigPushRequest, captured["request"])
    assert request.skills[0].name == "alpha"
    assert request.skills[0].file_ref is not None
    assert request.skills[0].file_ref.id == "tool-file-1"
    assert len(uploaded_paths) == 1
    assert uploaded_paths[0].endswith("/alpha.zip")


def test_push_config_skills_from_environment_rejects_empty_paths() -> None:
    with pytest.raises(AgentStubValidationError, match="at least one skill directory is required"):
        config_cli.push_config_skills_from_environment([])


def test_delete_config_skills_from_environment_builds_delete_items(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config_cli, "read_agent_stub_environment", lambda: _environment())

    captured: dict[str, object] = {}

    def fake_push_sync(**kwargs):
        captured.update(kwargs)
        return _manifest_payload()

    monkeypatch.setattr(config_cli, "request_agent_stub_config_push_sync", fake_push_sync)

    config_cli.delete_config_skills_from_environment(["alpha", "beta"])

    request = cast(AgentStubConfigPushRequest, captured["request"])
    assert [item.name for item in request.skills] == ["alpha", "beta"]
    assert all(item.file_ref is None for item in request.skills)


def test_delete_config_skills_from_environment_rejects_empty_names() -> None:
    with pytest.raises(AgentStubValidationError, match="at least one skill name is required"):
        config_cli.delete_config_skills_from_environment([])


def test_build_file_push_item_rejects_non_regular_files(tmp_path: Path) -> None:
    with pytest.raises(AgentStubValidationError, match="regular file"):
        config_cli._build_file_push_item(item=config_cli._PreparedPushItem(name="bad", path=tmp_path))


def test_build_skill_push_item_rejects_missing_skill_md(tmp_path: Path) -> None:
    skill_dir = tmp_path / "alpha"
    skill_dir.mkdir()

    with pytest.raises(AgentStubValidationError, match="must contain SKILL.md"):
        config_cli._build_skill_push_item(item=config_cli._PreparedPushItem(name="alpha", path=skill_dir))
