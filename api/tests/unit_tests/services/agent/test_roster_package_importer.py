from __future__ import annotations

import hashlib
import io
import json
import zipfile
from collections.abc import Generator

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.plugin.entities.plugin import PluginDependency, PluginDependencyType
from models import Account
from models.agent import (
    AgentConfigDraft,
)
from models.agent_config_entities import AgentSoulConfig
from services.agent.roster_package_entities import (
    ROSTER_AGENT_PACKAGE_FORMAT,
    ROSTER_AGENT_PACKAGE_FORMAT_VERSION,
    RosterAgentPackageFile,
    RosterAgentPackageManifest,
    RosterAgentPackageMetadata,
    RosterAgentPackageSkill,
)
from services.agent.roster_package_importer import RosterAgentPackageImporter
from services.app_service import AppService


class _MemoryStorage:
    def __init__(self, *, fail_save_at: int | None = None) -> None:
        self.files: dict[str, bytes] = {}
        self.deleted: list[str] = []
        self.save_count = 0
        self.fail_save_at = fail_save_at

    def save(self, filename: str, data: bytes) -> None:
        self.save_count += 1
        if self.fail_save_at == self.save_count:
            raise OSError("storage unavailable")
        self.files[filename] = data

    def delete(self, filename: str) -> None:
        self.deleted.append(filename)
        self.files.pop(filename, None)

    def load_stream(self, filename: str) -> Generator[bytes, None, None]:
        yield self.files[filename]


def _account() -> Account:
    account = Account(
        name="Agent Importer",
        email="agent-importer@example.com",
        interface_language="en-US",
    )
    account.id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    return account


def _zip(members: dict[str, bytes]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for path, payload in members.items():
            archive.writestr(path, payload)
    return output.getvalue()


def _skill_archive(name: str) -> bytes:
    return _zip(
        {
            "SKILL.md": f"---\nname: {name}\ndescription: {name} description.\n---\n\n# Skill\n".encode(),
            "scripts/run.py": b"print('ok')\n",
        }
    )


def _package(
    *,
    name: str = "Imported Agent",
    binary_dependency: bool = False,
    missing_knowledge: bool = False,
) -> bytes:
    config_skill = _skill_archive("config-skill")
    workspace_skill = _skill_archive("workspace-skill")
    guide = b"guide-content"
    notes = b"notes-content"
    soul_data = {
        "prompt": {"system_prompt": "Imported prompt"},
        "config_skills": [{"name": "config-skill", "file_id": "s_000001"}],
        "config_files": [
            {"name": "guide.pdf", "file_kind": "upload_file", "file_id": "f_000001"},
            {"name": "notes.txt", "file_kind": "tool_file", "file_id": "f_000002"},
        ],
    }
    if missing_knowledge:
        soul_data["knowledge"] = {
            "sets": [
                {
                    "id": "set-1",
                    "name": "Documents",
                    "datasets": [{"id": "missing-dataset-id", "name": "Missing Docs"}],
                    "query": {"mode": "user_query", "value": "query"},
                    "retrieval": {
                        "mode": "single",
                        "model": {"provider": "provider/embedding", "name": "embed", "mode": "embedding"},
                    },
                }
            ]
        }
    soul = AgentSoulConfig.model_validate(soul_data)
    files = [
        RosterAgentPackageFile(
            id="f_000001",
            role="agent_config_file",
            path="f_000001.pdf",
            original_name="guide.pdf",
            mime_type="application/pdf",
            size=len(guide),
            sha256=hashlib.sha256(guide).hexdigest(),
        ),
        RosterAgentPackageFile(
            id="f_000002",
            role="agent_config_file",
            path="f_000002.txt",
            original_name="notes.txt",
            mime_type="text/plain",
            size=len(notes),
            sha256=hashlib.sha256(notes).hexdigest(),
        ),
    ]
    members = {
        "s_000001.zip": config_skill,
        "s_000002.zip": workspace_skill,
        "f_000001.pdf": guide,
        "f_000002.txt": notes,
    }
    if binary_dependency:
        binary = b"binary-content"
        files.append(
            RosterAgentPackageFile(
                id="f_000003",
                role="binary_dependency",
                path="f_000003.so",
                original_name="tool.so",
                mime_type="application/octet-stream",
                platform="linux",
                arch="amd64",
                size=len(binary),
                sha256=hashlib.sha256(binary).hexdigest(),
            )
        )
        members["f_000003.so"] = binary
    dependency = PluginDependency(
        type=PluginDependencyType.Marketplace,
        value=PluginDependency.Marketplace(marketplace_plugin_unique_identifier="langgenius/example:1.0.0@digest"),
    )
    manifest = RosterAgentPackageManifest(
        format=ROSTER_AGENT_PACKAGE_FORMAT,
        format_version=ROSTER_AGENT_PACKAGE_FORMAT_VERSION,
        metadata=RosterAgentPackageMetadata(name=name, description="Imported description", role="researcher"),
        soul=soul,
        skills=[
            RosterAgentPackageSkill(
                id="s_000001",
                scope="agent_config",
                name="config-skill",
                description="config-skill description.",
                path="s_000001.zip",
                size=len(config_skill),
                sha256=hashlib.sha256(config_skill).hexdigest(),
            ),
            RosterAgentPackageSkill(
                id="s_000002",
                scope="workspace",
                name="workspace-skill",
                display_name="Workspace Skill",
                description="workspace-skill description.",
                priority=0,
                path="s_000002.zip",
                size=len(workspace_skill),
                sha256=hashlib.sha256(workspace_skill).hexdigest(),
            ),
        ],
        files=files,
        dependencies=[dependency],
    )
    return _zip({"manifest.json": manifest.model_dump_json(exclude_none=True).encode(), **members})


def _count(session: Session, model) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_import_clears_source_credentials(monkeypatch, sqlite_session_factory):
    with zipfile.ZipFile(io.BytesIO(_package())) as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    manifest = json.loads(members["manifest.json"])
    manifest["soul"]["tools"]["dify_tools"] = [
        {
            "provider_id": "langgenius/example/example",
            "provider_type": "plugin",
            "credential_type": "api-key",
            "credential_ref": {"type": "tool", "id": "source-credential"},
            "runtime_parameters": {"api_key": "source-secret", "query": "keep"},
        }
    ]
    manifest["soul"]["model"] = {
        "plugin_id": "langgenius/example",
        "model_provider": "langgenius/example/example",
        "model": "example",
        "credential_ref": {"type": "provider", "id": "source-model"},
    }
    manifest["soul"]["env"]["secret_refs"] = [{"name": "TOKEN", "value": "source-secret", "id": "source-id"}]
    members["manifest.json"] = json.dumps(manifest).encode()
    monkeypatch.setattr(AppService, "finalize_created_app", lambda *_a, **_k: None)
    result = RosterAgentPackageImporter(storage_backend=_MemoryStorage()).import_package(
        source=io.BytesIO(_zip(members)), tenant_id="tenant-1", account=_account()
    )
    with sqlite_session_factory() as session:
        draft = session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.agent_id == result.agent_id))
        data = draft.config_snapshot_dict
        tool = data["tools"]["dify_tools"][0]
        assert tool["credential_type"] == "unauthorized"
        assert tool["credential_ref"] is None
        assert tool["runtime_parameters"] == {"api_key": None, "query": "keep"}
        assert data["model"]["credential_ref"] is None
        assert "source-secret" not in json.dumps(data)
        assert "source-id" not in json.dumps(data)
