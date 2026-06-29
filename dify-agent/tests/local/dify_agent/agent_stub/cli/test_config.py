from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from dify_agent.agent_stub.cli import _config as config_cli
from dify_agent.agent_stub.cli._env import AgentStubEnvironment
from dify_agent.agent_stub.client._errors import AgentStubValidationError
from dify_agent.agent_stub.protocol.agent_stub import AgentStubConfigManifestResponse


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


def test_pull_config_env_from_environment_writes_only_declared_keys(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(config_cli, "manifest_from_environment", _manifest_payload)
    monkeypatch.setenv("API_KEY", "plain")
    monkeypatch.setenv("JSON_VALUE", "two words")

    result = config_cli.pull_config_env_from_environment(local_path=str(tmp_path / ".env"))

    assert result.read_text(encoding="utf-8") == 'API_KEY=plain\nJSON_VALUE="two words"\n'


def test_push_config_from_environment_builds_request_from_files_skills_env_and_note(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    file_path = tmp_path / "guide.txt"
    file_path.write_text("guide", encoding="utf-8")
    skill_dir = tmp_path / "alpha"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text("# Alpha\n", encoding="utf-8")
    env_path = tmp_path / ".env"
    env_path.write_text("API_KEY=value\n", encoding="utf-8")
    note_path = tmp_path / "note.md"
    note_path.write_text("hello", encoding="utf-8")
    spec_path = tmp_path / "push.json"
    spec_path.write_text(
        json.dumps(
            {
                "files": [str(file_path), {"name": "old.txt"}],
                "skills": [str(skill_dir), {"name": "old-skill"}],
                "env": str(env_path),
                "note": str(note_path),
            }
        ),
        encoding="utf-8",
    )

    uploaded_paths: list[str] = []

    def fake_upload_tool_file_resource_from_environment(*, path: str):
        uploaded_paths.append(path)
        return SimpleNamespace(tool_file_id=f"tool-file-{len(uploaded_paths)}")

    monkeypatch.setattr(config_cli, "read_agent_stub_environment", lambda: _environment())
    monkeypatch.setattr(
        config_cli, "upload_tool_file_resource_from_environment", fake_upload_tool_file_resource_from_environment
    )

    captured: dict[str, object] = {}

    def fake_push_sync(**kwargs):
        captured.update(kwargs)
        return _manifest_payload()

    monkeypatch.setattr(config_cli, "request_agent_stub_config_push_sync", fake_push_sync)

    response = config_cli.push_config_from_environment(str(spec_path))

    assert response.agent_id == "agent-1"
    request = captured["request"]
    assert request.files[0].name == "guide.txt"
    assert request.files[0].file_ref.id == "tool-file-1"
    assert request.files[1].name == "old.txt"
    assert request.files[1].file_ref is None
    assert request.skills[0].name == "alpha"
    assert request.skills[0].file_ref.id == "tool-file-2"
    assert request.skills[1].name == "old-skill"
    assert request.skills[1].file_ref is None
    assert request.env_text == "API_KEY=value\n"
    assert request.note == "hello"
    assert uploaded_paths[0] == str(file_path)
    assert uploaded_paths[1].endswith("/alpha.zip")


def test_prepare_push_items_rejects_delete_entries_without_name() -> None:
    with pytest.raises(AgentStubValidationError, match="delete entries require a name"):
        config_cli._prepare_push_items([{}], kind="file")


def test_build_file_push_item_rejects_non_regular_files(tmp_path: Path) -> None:
    with pytest.raises(AgentStubValidationError, match="regular file"):
        config_cli._build_file_push_item(item=config_cli._PreparedPushItem(name="bad", path=tmp_path))


def test_build_skill_push_item_rejects_missing_skill_md(tmp_path: Path) -> None:
    skill_dir = tmp_path / "alpha"
    skill_dir.mkdir()

    with pytest.raises(AgentStubValidationError, match="must contain SKILL.md"):
        config_cli._build_skill_push_item(item=config_cli._PreparedPushItem(name="alpha", path=skill_dir))


def test_build_skill_push_item_rejects_directory_name_mismatch(tmp_path: Path) -> None:
    skill_dir = tmp_path / "alpha"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text("# Alpha\n", encoding="utf-8")

    with pytest.raises(AgentStubValidationError, match="must match the directory name"):
        config_cli._build_skill_push_item(item=config_cli._PreparedPushItem(name="beta", path=skill_dir))
