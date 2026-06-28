"""CLI helpers for sandbox-visible Agent Stub config commands."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from pydantic import BaseModel, ConfigDict

from dify_agent.agent_stub._drive_materialization import (
    DriveMaterializationTransferError,
    DriveMaterializationValidationError,
    extract_archive_to_directory,
)
from dify_agent.agent_stub.cli._drive import _build_skill_archive
from dify_agent.agent_stub.cli._env import read_agent_stub_environment
from dify_agent.agent_stub.cli._files import upload_tool_file_resource_from_environment
from dify_agent.agent_stub.client._agent_stub import (
    request_agent_stub_config_manifest_sync,
    request_agent_stub_config_push_sync,
    request_agent_stub_config_file_pull_sync,
    request_agent_stub_config_skill_pull_sync,
)
from dify_agent.agent_stub.client._errors import AgentStubTransferError, AgentStubValidationError
from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubConfigFileRef,
    AgentStubConfigManifestResponse,
    AgentStubConfigPushFileItem,
    AgentStubConfigPushRequest,
    AgentStubConfigPushSkillItem,
)

_DEFAULT_CONFIG_BASE = Path("./dify_conf")
_SKILL_MD_FILENAME = "SKILL.md"
_SAFE_ENV_VALUE = re.compile(r"^[A-Za-z0-9_./:@+-]+$")


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


class ConfigPushSpec(BaseModel):
    files: list[str | dict[str, Any]] = []
    skills: list[str | dict[str, Any]] = []
    env: str | None = None
    note: str | None = None

    model_config = ConfigDict(extra="forbid")


@dataclass(frozen=True, slots=True)
class _PreparedPushItem:
    name: str
    path: Path | None


def manifest_from_environment() -> AgentStubConfigManifestResponse:
    environment = read_agent_stub_environment()
    return request_agent_stub_config_manifest_sync(url=environment.url, auth_jwe=environment.auth_jwe)


def pull_config_skills_from_environment(
    names: list[str] | None = None,
    local_dir: str | None = None,
) -> ConfigSkillPullResult:
    environment = read_agent_stub_environment()
    manifest = request_agent_stub_config_manifest_sync(url=environment.url, auth_jwe=environment.auth_jwe)
    selected_names = names or [item.name for item in manifest.skills]
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
    selected_names = names or [item.name for item in manifest.files]
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


def pull_config_env_from_environment(local_path: str | None = None) -> Path:
    manifest = manifest_from_environment()
    target_path = Path(local_path or (_DEFAULT_CONFIG_BASE / ".env")).expanduser().resolve()
    target_path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    for key in manifest.env_keys:
        if key not in os.environ:
            raise AgentStubValidationError(f"config env key is not present in the current environment: {key}")
        lines.append(f"{key}={_format_env_value(os.environ[key])}")
    target_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    return target_path


def pull_config_note_from_environment(local_path: str | None = None) -> Path:
    manifest = manifest_from_environment()
    target_path = Path(local_path or (_DEFAULT_CONFIG_BASE / "note.md")).expanduser().resolve()
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(manifest.note, encoding="utf-8")
    return target_path


def push_config_from_environment(spec_path: str | None = None) -> AgentStubConfigManifestResponse:
    environment = read_agent_stub_environment()
    raw_spec = _read_push_spec(spec_path)
    spec = ConfigPushSpec.model_validate(json.loads(raw_spec))

    file_items = [
        _build_file_push_item(item=item)
        for item in _prepare_push_items(spec.files, kind="file")
    ]
    skill_items = [
        _build_skill_push_item(item=item)
        for item in _prepare_push_items(spec.skills, kind="skill")
    ]
    env_text = _read_optional_text_path(spec.env)
    note_text = _read_optional_text_path(spec.note)
    return request_agent_stub_config_push_sync(
        url=environment.url,
        auth_jwe=environment.auth_jwe,
        request=AgentStubConfigPushRequest(
            files=file_items,
            skills=skill_items,
            env_text=env_text,
            note=note_text,
        ),
    )


def _read_push_spec(spec_path: str | None) -> str:
    if spec_path is None or spec_path == "-":
        return os.fdopen(os.dup(0), encoding="utf-8").read()
    return Path(spec_path).expanduser().read_text(encoding="utf-8")


def _prepare_push_items(entries: list[str | dict[str, Any]], *, kind: str) -> list[_PreparedPushItem]:
    prepared: list[_PreparedPushItem] = []
    for entry in entries:
        if isinstance(entry, str):
            path = Path(entry).expanduser().resolve()
            prepared.append(_PreparedPushItem(name=_infer_name_from_path(path), path=path))
            continue
        if not isinstance(entry, dict):
            raise AgentStubValidationError(f"invalid config {kind} push entry")
        path_value = entry.get("path")
        name = str(entry.get("name") or "").strip()
        if not path_value:
            if not name:
                raise AgentStubValidationError(f"config {kind} delete entries require a name")
            prepared.append(_PreparedPushItem(name=name, path=None))
            continue
        path = Path(str(path_value)).expanduser().resolve()
        prepared.append(_PreparedPushItem(name=name or _infer_name_from_path(path), path=path))
    return prepared


def _infer_name_from_path(path: Path) -> str:
    return path.name


def _build_file_push_item(
    *,
    item: _PreparedPushItem,
) -> AgentStubConfigPushFileItem:
    if item.path is None:
        return AgentStubConfigPushFileItem(name=item.name, file_ref=None)
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
    if item.path is None:
        return AgentStubConfigPushSkillItem(name=item.name, file_ref=None)
    if not item.path.is_dir():
        raise AgentStubValidationError(f"config skill path must be a directory: {item.path}")
    skill_md_path = item.path / _SKILL_MD_FILENAME
    if not skill_md_path.is_file():
        raise AgentStubValidationError(f"config skill directory must contain {_SKILL_MD_FILENAME}: {item.path}")
    if item.path.name != item.name:
        raise AgentStubValidationError(f"config skill name must match the directory name: {item.name}")
    with TemporaryDirectory() as temp_dir:
        archive_path = Path(temp_dir) / f"{item.name}.zip"
        _build_skill_archive(item.path, archive_path)
        uploaded = upload_tool_file_resource_from_environment(path=str(archive_path))
    return AgentStubConfigPushSkillItem(
        name=item.name,
        file_ref=AgentStubConfigFileRef(kind="tool_file", id=uploaded.tool_file_id),
    )


def _read_optional_text_path(path_value: str | None) -> str | None:
    if path_value is None:
        return None
    return Path(path_value).expanduser().read_text(encoding="utf-8")


def _format_env_value(value: str) -> str:
    if _SAFE_ENV_VALUE.fullmatch(value):
        return value
    return json.dumps(value)


__all__ = [
    "ConfigFilePullResult",
    "ConfigSkillPullResult",
    "manifest_from_environment",
    "pull_config_env_from_environment",
    "pull_config_files_from_environment",
    "pull_config_note_from_environment",
    "pull_config_skills_from_environment",
    "push_config_from_environment",
]
