"""CLI helpers for sandbox-visible Agent Stub config commands."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from pydantic import BaseModel, ConfigDict

from dify_agent.agent_stub._drive_materialization import (
    DriveMaterializationTransferError,
    DriveMaterializationValidationError,
    extract_archive_to_directory,
)
from dify_agent.agent_stub.cli._drive import _build_skill_archive
from dify_agent.agent_stub.cli._env import read_agent_stub_environment
from dify_agent.agent_stub.cli._files import upload_tool_file_resource_from_environment
from dify_agent.agent_stub.client import (
    AgentStubTransferError,
    AgentStubValidationError,
    request_agent_stub_config_file_pull_sync,
    request_agent_stub_config_manifest_sync,
    request_agent_stub_config_push_sync,
    request_agent_stub_config_skill_pull_sync,
)
from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubConfigFileRef,
    AgentStubConfigManifestResponse,
    AgentStubConfigPushFileItem,
    AgentStubConfigPushRequest,
    AgentStubConfigPushSkillItem,
)

_DEFAULT_CONFIG_BASE = Path("./.dify_conf")
_SKILL_MD_FILENAME = "SKILL.md"


class ConfigSkillPullResult(BaseModel):
    class Item(BaseModel):
        name: str
        archive_path: str
        directory_path: str
        skill_md: str

        model_config = ConfigDict(extra="forbid")

    items: list[Item]

    model_config = ConfigDict(extra="forbid")


class ConfigFilePullResult(BaseModel):
    class Item(BaseModel):
        name: str
        path: str

        model_config = ConfigDict(extra="forbid")

    items: list[Item]

    model_config = ConfigDict(extra="forbid")


@dataclass(frozen=True, slots=True)
class _PreparedPushItem:
    name: str
    path: Path


def manifest_from_environment() -> AgentStubConfigManifestResponse:
    environment = read_agent_stub_environment()
    return request_agent_stub_config_manifest_sync(url=environment.url, auth_jwe=environment.auth_jwe)


def pull_config_skills_from_environment(
    names: list[str] | None = None,
    local_dir: str | None = None,
) -> ConfigSkillPullResult:
    environment = read_agent_stub_environment()
    manifest = request_agent_stub_config_manifest_sync(url=environment.url, auth_jwe=environment.auth_jwe)
    selected_names = names or [item.name for item in manifest.skills.items]
    target_dir = Path(local_dir or (_DEFAULT_CONFIG_BASE / "skills")).expanduser().resolve()
    target_dir.mkdir(parents=True, exist_ok=True)

    items: list[ConfigSkillPullResult.Item] = []
    for name in selected_names:
        archive_bytes = request_agent_stub_config_skill_pull_sync(
            url=environment.url,
            auth_jwe=environment.auth_jwe,
            name=name,
        )
        archive_path = target_dir / f"{name}.zip"
        skill_dir = target_dir / name
        skill_dir.mkdir(parents=True, exist_ok=True)
        archive_path.write_bytes(archive_bytes)
        try:
            extract_archive_to_directory(archive_path, target_dir=skill_dir)
        except DriveMaterializationValidationError as exc:
            raise AgentStubValidationError(str(exc)) from exc
        except DriveMaterializationTransferError as exc:
            raise AgentStubTransferError(str(exc)) from exc
        skill_md_path = skill_dir / _SKILL_MD_FILENAME
        if not skill_md_path.is_file():
            raise AgentStubValidationError(f"pulled config skill is missing {_SKILL_MD_FILENAME}: {name}")
        items.append(
            ConfigSkillPullResult.Item(
                name=name,
                archive_path=str(archive_path),
                directory_path=str(skill_dir),
                skill_md=skill_md_path.read_text(encoding="utf-8"),
            )
        )
    return ConfigSkillPullResult(items=items)


def pull_config_files_from_environment(
    names: list[str] | None = None,
    local_dir: str | None = None,
) -> ConfigFilePullResult:
    environment = read_agent_stub_environment()
    manifest = request_agent_stub_config_manifest_sync(url=environment.url, auth_jwe=environment.auth_jwe)
    selected_names = names or [item.name for item in manifest.files.items]
    target_dir = Path(local_dir or (_DEFAULT_CONFIG_BASE / "files")).expanduser().resolve()
    target_dir.mkdir(parents=True, exist_ok=True)

    items: list[ConfigFilePullResult.Item] = []
    for name in selected_names:
        payload = request_agent_stub_config_file_pull_sync(
            url=environment.url,
            auth_jwe=environment.auth_jwe,
            name=name,
        )
        target_path = target_dir / name
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(payload)
        items.append(ConfigFilePullResult.Item(name=name, path=str(target_path)))
    return ConfigFilePullResult(items=items)


def pull_config_note_from_environment(local_path: str | None = None) -> Path:
    manifest = manifest_from_environment()
    target_path = Path(local_path or (_DEFAULT_CONFIG_BASE / "note.md")).expanduser().resolve()
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(manifest.note, encoding="utf-8")
    return target_path


def push_config_note_from_environment(local_path: str | None) -> AgentStubConfigManifestResponse:
    note = _read_text_input(local_path, _DEFAULT_CONFIG_BASE / "note.md")
    return _push_config_from_environment(note=note)


def push_config_env_from_environment(local_path: str) -> AgentStubConfigManifestResponse:
    env_text = _read_text_input(local_path, default_path=None)
    return _push_config_from_environment(env_text=env_text)


def push_config_files_from_environment(paths: list[str]) -> AgentStubConfigManifestResponse:
    _require_non_empty_inputs(paths, kind="file path")
    items = [
        _PreparedPushItem(
            name=_infer_name_from_path(source_path),
            path=source_path,
        )
        for source_path in _resolve_input_paths(paths)
    ]
    return _push_config_from_environment(files=[_build_file_push_item(item=item) for item in items])


def delete_config_files_from_environment(names: list[str]) -> AgentStubConfigManifestResponse:
    _require_non_empty_inputs(names, kind="file name")
    return _push_config_from_environment(
        files=[
            AgentStubConfigPushFileItem(name=_require_config_entry_name(name, kind="file"), file_ref=None)
            for name in names
        ]
    )


def push_config_skills_from_environment(paths: list[str]) -> AgentStubConfigManifestResponse:
    _require_non_empty_inputs(paths, kind="skill directory")
    items = [
        _PreparedPushItem(name=_infer_name_from_path(source_path), path=source_path)
        for source_path in _resolve_input_paths(paths)
    ]
    return _push_config_from_environment(skills=[_build_skill_push_item(item=item) for item in items])


def delete_config_skills_from_environment(names: list[str]) -> AgentStubConfigManifestResponse:
    _require_non_empty_inputs(names, kind="skill name")
    return _push_config_from_environment(
        skills=[
            AgentStubConfigPushSkillItem(name=_require_config_entry_name(name, kind="skill"), file_ref=None)
            for name in names
        ]
    )


def _push_config_from_environment(
    *,
    files: list[AgentStubConfigPushFileItem] | None = None,
    skills: list[AgentStubConfigPushSkillItem] | None = None,
    env_text: str | None = None,
    note: str | None = None,
) -> AgentStubConfigManifestResponse:
    environment = read_agent_stub_environment()
    return request_agent_stub_config_push_sync(
        url=environment.url,
        auth_jwe=environment.auth_jwe,
        request=AgentStubConfigPushRequest(
            files=files or [],
            skills=skills or [],
            env_text=env_text,
            note=note,
        ),
    )


def _read_text_input(path_value: str | None, default_path: Path | None) -> str:
    if path_value == "-":
        return os.fdopen(os.dup(0), encoding="utf-8").read()
    if path_value is None:
        if default_path is None:
            raise AgentStubValidationError("local file path or '-' is required")
        source_path = default_path.expanduser().resolve()
    else:
        source_path = Path(path_value).expanduser().resolve()
    if not source_path.is_file():
        raise AgentStubValidationError(f"local file not found: {source_path}")
    return source_path.read_text(encoding="utf-8")


def _resolve_input_paths(paths: list[str]) -> list[Path]:
    return [Path(path).expanduser().resolve() for path in paths]


def _infer_name_from_path(path: Path) -> str:
    return path.name


def _build_file_push_item(
    *,
    item: _PreparedPushItem,
) -> AgentStubConfigPushFileItem:
    if not item.path.is_file():
        raise AgentStubValidationError(f"config file path must be a regular file: {item.path}")
    uploaded = upload_tool_file_resource_from_environment(path=str(item.path))
    return AgentStubConfigPushFileItem(
        name=item.name,
        file_ref=AgentStubConfigFileRef(kind="tool_file", id=uploaded.tool_file_id),
    )


def _build_skill_push_item(
    *,
    item: _PreparedPushItem,
) -> AgentStubConfigPushSkillItem:
    if not item.path.is_dir():
        raise AgentStubValidationError(f"config skill path must be a directory: {item.path}")
    skill_md_path = item.path / _SKILL_MD_FILENAME
    if not skill_md_path.is_file():
        raise AgentStubValidationError(f"config skill directory must contain {_SKILL_MD_FILENAME}: {item.path}")
    with TemporaryDirectory() as temp_dir:
        archive_path = Path(temp_dir) / f"{item.name}.zip"
        _build_skill_archive(item.path, archive_path)
        uploaded = upload_tool_file_resource_from_environment(path=str(archive_path))
    return AgentStubConfigPushSkillItem(
        name=item.name,
        file_ref=AgentStubConfigFileRef(kind="tool_file", id=uploaded.tool_file_id),
    )


def _require_config_entry_name(name: str, *, kind: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise AgentStubValidationError(f"config {kind} name must not be empty")
    return normalized


def _require_non_empty_inputs(values: list[str], *, kind: str) -> None:
    if not values:
        raise AgentStubValidationError(f"at least one {kind} is required")


__all__ = [
    "ConfigFilePullResult",
    "ConfigSkillPullResult",
    "manifest_from_environment",
    "pull_config_files_from_environment",
    "pull_config_note_from_environment",
    "pull_config_skills_from_environment",
    "push_config_env_from_environment",
    "push_config_files_from_environment",
    "push_config_note_from_environment",
    "push_config_skills_from_environment",
    "delete_config_files_from_environment",
    "delete_config_skills_from_environment",
]
