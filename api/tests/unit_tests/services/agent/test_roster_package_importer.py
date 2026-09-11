from __future__ import annotations

import hashlib
import io
import json
import zipfile
from collections.abc import Generator

import pytest
import yaml
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Forbidden

from core.db.session_factory import session_factory
from core.plugin.entities.plugin import PluginDependency, PluginDependencyType
from models import Account
from models.account import TenantPluginDebugPermission, TenantPluginInstallPermission, TenantPluginPermission
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentDebugConversation,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.agent_config_entities import AgentSoulConfig
from models.model import App, AppModelConfig, InstalledApp, Site, UploadFile
from models.tools import ToolFile
from services.agent.dsl_entities import (
    AgentPackage,
    AgentPackageMetadata,
    AgentPackageWorkspaceSkill,
    make_agent_app_dsl,
)
from services.agent.errors import (
    AgentNameConflictError,
    InvalidRosterAgentPackageError,
    RosterAgentPackageDependenciesMissingError,
    RosterAgentPackageImportFailedError,
    RosterAgentPackageResourceUnavailableError,
    RosterAgentPackageTooLargeError,
)
from services.agent.roster_package_entities import (
    ROSTER_AGENT_PACKAGE_FORMAT,
    ROSTER_AGENT_PACKAGE_FORMAT_VERSION,
    RosterAgentPackageApp,
    RosterAgentPackageFile,
    RosterAgentPackageManifest,
    RosterAgentPackageSkill,
)
from services.agent.roster_package_importer import RosterAgentPackageImporter
from services.app_service import AppService
from services.file_service import FileService
from services.plugin.dependencies_analysis import DependenciesAnalysisService


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


@pytest.fixture(autouse=True)
def _installed_plugins(monkeypatch):
    monkeypatch.setattr(DependenciesAnalysisService, "get_leaked_dependencies", lambda **_kwargs: [])


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
    soul_data: dict[str, object] = {
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
            path="f_000001.pdf",
            size=len(guide),
            sha256=hashlib.sha256(guide).hexdigest(),
        ),
        RosterAgentPackageFile(
            id="f_000002",
            path="f_000002.txt",
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
    dependency = PluginDependency(
        type=PluginDependencyType.Marketplace,
        value=PluginDependency.Marketplace(marketplace_plugin_unique_identifier="langgenius/example:1.0.0@digest"),
    )
    app = make_agent_app_dsl(
        App(name=name, mode="agent"),
        package_ref="agent_1",
        packages={
            "agent_1": AgentPackage(
                metadata=AgentPackageMetadata(name=name, description="Imported description", role="researcher"),
                soul=soul,
                workspace_skills=[
                    AgentPackageWorkspaceSkill(
                        name="workspace-skill",
                        display_name="Workspace Skill",
                        description="workspace-skill description.",
                        priority=0,
                    )
                ],
            )
        },
        dependencies=[dependency],
    )
    app_bytes = yaml.safe_dump(app.model_dump(mode="json")).encode()
    manifest = RosterAgentPackageManifest(
        format=ROSTER_AGENT_PACKAGE_FORMAT,
        format_version=ROSTER_AGENT_PACKAGE_FORMAT_VERSION,
        apps=[
            RosterAgentPackageApp(path="app.yaml", size=len(app_bytes), sha256=hashlib.sha256(app_bytes).hexdigest())
        ],
        skills=[
            RosterAgentPackageSkill(
                id="s_000001",
                scope="agent_config",
                name="config-skill",
                path="s_000001.zip",
                size=len(config_skill),
                sha256=hashlib.sha256(config_skill).hexdigest(),
            ),
            RosterAgentPackageSkill(
                id="s_000002",
                scope="workspace",
                name="workspace-skill",
                path="s_000002.zip",
                size=len(workspace_skill),
                sha256=hashlib.sha256(workspace_skill).hexdigest(),
            ),
        ],
        files=files,
    )
    manifest_data = manifest.model_dump(mode="json", exclude_none=True)
    if binary_dependency:
        manifest_data["files"][0]["role"] = "binary_dependency"
    return _zip({"manifest.yaml": yaml.safe_dump(manifest_data).encode(), "app.yaml": app_bytes, **members})


def _count(session: Session, model) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


@pytest.mark.parametrize("skill_index", [0, 1], ids=["uploaded", "workspace"])
@pytest.mark.parametrize(
    "damage", ["invalid_zip", "missing_skill_md", "member_crc", "checksum", "size", "name_mismatch"]
)
def test_damaged_skill_becomes_missing_with_warning(monkeypatch, sqlite_session_factory, skill_index, damage):
    with zipfile.ZipFile(io.BytesIO(_package())) as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    manifest = yaml.safe_load(members["manifest.yaml"])
    skill = manifest["skills"][skill_index]
    path = skill["path"]
    if damage == "invalid_zip":
        members[path] = b"not a zip archive"
    elif damage == "missing_skill_md":
        members[path] = _zip({"README.md": b"no entrypoint"})
    elif damage == "member_crc":
        members[path] = members[path].replace(b"print('ok')", b"print('NO')", 1)
    elif damage == "name_mismatch":
        members[path] = _skill_archive("different-name")
    skill["size"] = len(members[path]) + (1 if damage == "size" else 0)
    skill["sha256"] = "0" * 64 if damage == "checksum" else hashlib.sha256(members[path]).hexdigest()
    members["manifest.yaml"] = yaml.safe_dump(manifest).encode()
    storage = _MemoryStorage()
    monkeypatch.setattr(AppService, "finalize_created_app", lambda *_args, **_kwargs: None)
    result = RosterAgentPackageImporter(storage_backend=storage).import_package(
        source=io.BytesIO(_zip(members)), tenant_id="tenant-1", account=_account()
    )
    assert len(result.warnings) == 1
    warning = result.warnings[0]
    assert warning.code == "agent_skill_missing"
    assert warning.details["name"] == skill["name"]
    assert warning.details["path"] == path
    assert warning.details["reason"]
    assert storage.save_count == 3
    with sqlite_session_factory() as session:
        draft = session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.agent_id == result.agent_id))
        soul = AgentSoulConfig.model_validate(draft.config_snapshot_dict)
        damaged = soul.config_skills[skill_index]
        assert damaged.name == skill["name"]
        assert damaged.is_missing is True
        assert damaged.file_id == ""
        assert soul.config_skills[1 - skill_index].is_missing is False
        assert all(not ref.is_missing for ref in soul.config_files)
        assert _count(session, ToolFile) == 2


def test_damaged_ordinary_file_still_rejects_package():
    with zipfile.ZipFile(io.BytesIO(_package())) as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    members["f_000001.pdf"] = b"damaged"
    storage = _MemoryStorage()
    with pytest.raises(InvalidRosterAgentPackageError):
        RosterAgentPackageImporter(storage_backend=storage).import_package(
            source=io.BytesIO(_zip(members)), tenant_id="tenant-1", account=_account()
        )
    assert storage.save_count == 0


def test_import_rejects_multiple_apps_before_writes():
    with zipfile.ZipFile(io.BytesIO(_package())) as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    manifest = yaml.safe_load(members["manifest.yaml"])
    members["second.yaml"] = members["app.yaml"]
    manifest["apps"].append({**manifest["apps"][0], "path": "second.yaml"})
    members["manifest.yaml"] = yaml.safe_dump(manifest).encode()
    storage = _MemoryStorage()
    with pytest.raises(InvalidRosterAgentPackageError, match="exactly one Agent App"):
        RosterAgentPackageImporter(storage_backend=storage).import_package(
            source=io.BytesIO(_zip(members)), tenant_id="tenant-1", account=_account()
        )
    assert storage.save_count == 0


def test_import_uses_indexed_app_path(monkeypatch, sqlite_session_factory):
    with zipfile.ZipFile(io.BytesIO(_package())) as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    manifest = yaml.safe_load(members["manifest.yaml"])
    members["custom.yml"] = members.pop("app.yaml")
    manifest["apps"][0]["path"] = "custom.yml"
    members["manifest.yaml"] = yaml.safe_dump(manifest).encode()
    monkeypatch.setattr(AppService, "finalize_created_app", lambda *_args, **_kwargs: None)
    result = RosterAgentPackageImporter(storage_backend=_MemoryStorage()).import_package(
        source=io.BytesIO(_zip(members)), tenant_id="tenant-1", account=_account()
    )
    with sqlite_session_factory() as session:
        assert session.get(App, result.app_id).name == "Imported Agent"


@pytest.mark.parametrize("use_zip64", [False, True])
def test_invalid_utf8_skill_filename_is_recovered(monkeypatch, sqlite_session_factory, use_zip64):
    with zipfile.ZipFile(io.BytesIO(_package())) as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    with monkeypatch.context() as scoped:
        if use_zip64:
            scoped.setattr(zipfile, "ZIP64_LIMIT", 0)
        skill = _zip(
            {
                "SKILL.md": b"---\nname: config-skill\ndescription: Recoverable skill.\n---\n",
                "scripts/\u00e9.py": b"print('ok')\n",
            }
        ).replace(b"\xc3\xa9.py", b"\xffa.py")
    members["s_000001.zip"] = skill
    manifest = yaml.safe_load(members["manifest.yaml"])
    manifest["skills"][0]["size"] = len(skill)
    manifest["skills"][0]["sha256"] = hashlib.sha256(skill).hexdigest()
    members["manifest.yaml"] = yaml.safe_dump(manifest).encode()
    storage = _MemoryStorage()
    monkeypatch.setattr(AppService, "finalize_created_app", lambda *_args, **_kwargs: None)
    result = RosterAgentPackageImporter(storage_backend=storage).import_package(
        source=io.BytesIO(_zip(members)), tenant_id="tenant-1", account=_account()
    )
    assert result.warnings == []
    with sqlite_session_factory() as session:
        draft = session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.agent_id == result.agent_id))
        soul = AgentSoulConfig.model_validate(draft.config_snapshot_dict)
        assert soul.config_skills[0].is_missing is False
        tool_file = session.get(ToolFile, soul.config_skills[0].file_id)
        with zipfile.ZipFile(io.BytesIO(storage.files[tool_file.file_key])) as archive:
            assert archive.read("scripts/\ufffda.py") == b"print('ok')\n"


@pytest.mark.parametrize("names", [["INVALID-NAME"], ["TOKEN", "TOKEN"]])
def test_import_rejects_invalid_shell_environment_before_writes(monkeypatch, sqlite_session_factory, names):
    with zipfile.ZipFile(io.BytesIO(_package())) as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    app = yaml.safe_load(members["app.yaml"])
    app["agent_packages"]["agent_1"]["soul"]["env"]["variables"] = [{"name": name, "value": "value"} for name in names]
    members["app.yaml"] = yaml.safe_dump(app).encode()
    manifest = yaml.safe_load(members["manifest.yaml"])
    manifest["apps"][0].update(size=len(members["app.yaml"]), sha256=hashlib.sha256(members["app.yaml"]).hexdigest())
    members["manifest.yaml"] = yaml.safe_dump(manifest).encode()
    monkeypatch.setattr(AppService, "finalize_created_app", lambda *_args, **_kwargs: None)
    storage = _MemoryStorage()
    with pytest.raises(InvalidRosterAgentPackageError, match="Soul is invalid"):
        RosterAgentPackageImporter(storage_backend=storage).import_package(
            source=io.BytesIO(_zip(members)), tenant_id="tenant-1", account=_account()
        )
    assert storage.save_count == 0
    with sqlite_session_factory() as session:
        assert _count(session, App) == 0


def test_import_clears_source_credentials(monkeypatch, sqlite_session_factory):
    with zipfile.ZipFile(io.BytesIO(_package())) as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    app = yaml.safe_load(members["app.yaml"])
    soul = app["agent_packages"]["agent_1"]["soul"]
    soul["tools"]["dify_tools"] = [
        {
            "provider_id": "langgenius/example/example",
            "provider_type": "plugin",
            "credential_type": "api-key",
            "credential_ref": {"type": "tool", "id": "source-credential"},
            "runtime_parameters": {"api_key": "source-secret", "query": "keep"},
        }
    ]
    soul["model"] = {
        "plugin_id": "langgenius/example",
        "model_provider": "langgenius/example/example",
        "model": "example",
        "credential_ref": {"type": "provider", "id": "source-model"},
    }
    soul["env"]["secret_refs"] = [{"name": "TOKEN", "value": "source-secret", "id": "source-id"}]
    members["app.yaml"] = yaml.safe_dump(app).encode()
    manifest = yaml.safe_load(members["manifest.yaml"])
    manifest["apps"][0].update(size=len(members["app.yaml"]), sha256=hashlib.sha256(members["app.yaml"]).hexdigest())
    members["manifest.yaml"] = yaml.safe_dump(manifest).encode()
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


@pytest.mark.parametrize("allowed", [False, True])
def test_missing_plugins_are_checked_before_writes(monkeypatch, config_overrides, allowed):
    config_overrides(RBAC_ENABLED=True)
    monkeypatch.setattr(DependenciesAnalysisService, "get_leaked_dependencies", lambda **kwargs: kwargs["dependencies"])
    monkeypatch.setattr(
        "services.agent.roster_package_dependencies.RBACService.CheckAccess.check", lambda *_args, **_kwargs: allowed
    )
    storage = _MemoryStorage()
    with pytest.raises(RosterAgentPackageDependenciesMissingError if allowed else Forbidden) as failure:
        RosterAgentPackageImporter(storage_backend=storage).import_package(
            source=io.BytesIO(_package()), tenant_id="tenant-1", account=_account()
        )
    assert storage.save_count == 0
    if allowed:
        assert isinstance(failure.value, RosterAgentPackageDependenciesMissingError)
        assert failure.value.data is not None
        assert len(failure.value.data["leaked_dependencies"]) == 1


def test_empty_dependencies_do_not_require_plugin_service(monkeypatch):
    from services.agent.roster_package_dependencies import check_package_dependencies

    def unavailable(**_kwargs):
        raise OSError("plugin service unavailable")

    monkeypatch.setattr(DependenciesAnalysisService, "get_leaked_dependencies", unavailable)
    check_package_dependencies(tenant_id="tenant-1", account=_account(), dependencies=[])


@pytest.mark.parametrize("policy", [TenantPluginInstallPermission.NOBODY, TenantPluginInstallPermission.ADMINS])
def test_missing_plugins_respect_workspace_install_policy(
    monkeypatch, config_overrides, sqlite_session_factory, policy
):
    config_overrides(RBAC_ENABLED=False)
    with sqlite_session_factory() as session, session.begin():
        session.add(
            TenantPluginPermission(
                tenant_id="tenant-1", install_permission=policy, debug_permission=TenantPluginDebugPermission.NOBODY
            )
        )
    monkeypatch.setattr(DependenciesAnalysisService, "get_leaked_dependencies", lambda **kwargs: kwargs["dependencies"])
    storage = _MemoryStorage()
    with pytest.raises(Forbidden):
        RosterAgentPackageImporter(storage_backend=storage).import_package(
            source=io.BytesIO(_package()), tenant_id="tenant-1", account=_account()
        )
    assert storage.save_count == 0


def test_import_materializes_agent_resources_and_unpublished_draft(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    storage = _MemoryStorage()
    monkeypatch.setattr("services.app_service.initialize_agent_rbac_access", lambda **_kwargs: None)
    monkeypatch.setattr("services.app_service.SystemFeatureService.is_webapp_auth_enabled", lambda: False)

    result = RosterAgentPackageImporter(
        storage_backend=storage,
    ).import_package(
        source=io.BytesIO(_package()),
        tenant_id="tenant-1",
        account=_account(),
    )

    assert result.warnings == []
    assert len(storage.files) == 4
    with sqlite_session_factory() as session:
        app = session.get(App, result.app_id)
        agent = session.get(Agent, result.agent_id)
        assert app is not None
        assert app.name == "Imported Agent"
        assert app.mode == "agent"
        assert app.enable_site is False
        assert app.enable_api is False
        model_config = session.get(AppModelConfig, app.app_model_config_id)
        assert model_config is not None
        assert model_config.app_id == app.id
        assert agent is not None
        assert agent.source == AgentSource.IMPORTED
        assert agent.scope == AgentScope.ROSTER
        assert agent.active_config_is_published is False
        draft = session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.agent_id == agent.id))
        assert draft is not None
        soul = AgentSoulConfig.model_validate(draft.config_snapshot_dict)
        assert [item.name for item in soul.config_skills] == ["config-skill", "workspace-skill"]
        assert all(item.file_id and not item.is_missing for item in soul.config_skills)
        assert [(item.name, item.file_kind) for item in soul.config_files] == [
            ("guide.pdf", "upload_file"),
            ("notes.txt", "tool_file"),
        ]
        assert all(item.file_id and not item.is_missing for item in soul.config_files)
        revision = session.scalar(select(AgentConfigRevision).where(AgentConfigRevision.agent_id == agent.id))
        assert revision is not None
        assert revision.operation == AgentConfigRevisionOperation.IMPORT_PACKAGE
        assert _count(session, ToolFile) == 3
        assert _count(session, UploadFile) == 1
        assert _count(session, Site) == 1
        assert _count(session, InstalledApp) == 1
        assert _count(session, AgentDebugConversation) == 1


def test_import_rejects_binary_dependencies_before_side_effects(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    storage = _MemoryStorage()
    importer = RosterAgentPackageImporter(storage_backend=storage)

    with pytest.raises(InvalidRosterAgentPackageError, match="manifest is invalid"):
        importer.import_package(
            source=io.BytesIO(_package(binary_dependency=True)),
            tenant_id="tenant-1",
            account=_account(),
        )

    assert storage.files == {}
    with sqlite_session_factory() as session:
        assert _count(session, App) == 0


def test_import_marks_unavailable_knowledge_for_rebinding(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    storage = _MemoryStorage()
    monkeypatch.setattr(AppService, "finalize_created_app", lambda *_args, **_kwargs: None)

    result = RosterAgentPackageImporter(storage_backend=storage).import_package(
        source=io.BytesIO(_package(missing_knowledge=True)),
        tenant_id="tenant-1",
        account=_account(),
    )

    assert [warning.code for warning in result.warnings] == ["agent_knowledge_unresolved"]
    with sqlite_session_factory() as session:
        draft = session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.agent_id == result.agent_id))
        assert draft is not None
        soul = AgentSoulConfig.model_validate(draft.config_snapshot_dict)
        dataset_id = soul.knowledge.sets[0].datasets[0].id
        assert dataset_id is not None
        assert dataset_id.startswith("missing-dataset-")
        assert dataset_id != "missing-dataset-id"


def test_import_validates_all_file_limits_before_staging(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = _MemoryStorage()
    monkeypatch.setattr(FileService, "file_size_limit", lambda **_kwargs: 1)

    with pytest.raises(InvalidRosterAgentPackageError, match="file size limit"):
        RosterAgentPackageImporter(storage_backend=storage).import_package(
            source=io.BytesIO(_package()),
            tenant_id="tenant-1",
            account=_account(),
        )

    assert storage.files == {}


def test_import_rejects_duplicate_agent_name_before_staging(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session, session.begin():
        session.add(
            Agent(
                tenant_id="tenant-1",
                name="Imported Agent",
                description="",
                role="",
                agent_kind=AgentKind.DIFY_AGENT,
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                status=AgentStatus.ACTIVE,
                created_by=_account().id,
                updated_by=_account().id,
            )
        )
    storage = _MemoryStorage()

    with pytest.raises(AgentNameConflictError):
        RosterAgentPackageImporter(storage_backend=storage).import_package(
            source=io.BytesIO(_package()),
            tenant_id="tenant-1",
            account=_account(),
        )

    assert storage.files == {}


@pytest.mark.parametrize("fail_after_write", [False, True])
def test_import_does_not_create_records_when_storage_fails(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    fail_after_write: bool,
) -> None:
    storage = _MemoryStorage(fail_save_at=None if fail_after_write else 2)
    if fail_after_write:
        save = storage.save

        def save_then_fail(filename: str, data: bytes) -> None:
            save(filename, data)
            if storage.save_count == 2:
                raise OSError("storage write completed but acknowledgement failed")

        monkeypatch.setattr(storage, "save", save_then_fail)

    with pytest.raises(RosterAgentPackageResourceUnavailableError):
        RosterAgentPackageImporter(storage_backend=storage).import_package(
            source=io.BytesIO(_package()),
            tenant_id="tenant-1",
            account=_account(),
        )

    assert len(storage.files) == (2 if fail_after_write else 1)
    assert storage.deleted == []
    with sqlite_session_factory() as session:
        assert _count(session, App) == 0
        assert _count(session, ToolFile) == 0


@pytest.mark.parametrize(
    ("failure", "expected"),
    [
        (AgentNameConflictError(), AgentNameConflictError),
        (InvalidRosterAgentPackageError(), InvalidRosterAgentPackageError),
        (RosterAgentPackageTooLargeError(), RosterAgentPackageTooLargeError),
        (RosterAgentPackageResourceUnavailableError(), RosterAgentPackageResourceUnavailableError),
        (IntegrityError("insert", {}, RuntimeError("roster_unique_name")), AgentNameConflictError),
        (IntegrityError("insert", {}, RuntimeError("other constraint")), RosterAgentPackageImportFailedError),
        (RuntimeError("unexpected failure"), RosterAgentPackageImportFailedError),
    ],
)
def test_import_preserves_error_mapping(monkeypatch, failure, expected):
    importer = RosterAgentPackageImporter(storage_backend=_MemoryStorage())

    def fail(**_kwargs):
        raise failure

    monkeypatch.setattr(importer, "_ensure_name_available", fail)
    with pytest.raises(expected) as caught:
        importer.import_package(source=io.BytesIO(_package()), tenant_id="tenant-1", account=_account())
    if isinstance(failure, expected):
        assert caught.value is failure
    else:
        assert caught.value.__cause__ is failure


def test_import_preserves_file_records_when_agent_creation_fails(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    storage = _MemoryStorage()
    monkeypatch.setattr(
        RosterAgentPackageImporter,
        "_persist_import",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("database unavailable")),
    )

    with pytest.raises(RosterAgentPackageImportFailedError):
        RosterAgentPackageImporter(storage_backend=storage).import_package(
            source=io.BytesIO(_package()),
            tenant_id="tenant-1",
            account=_account(),
        )

    assert len(storage.files) == 4
    assert storage.deleted == []
    with sqlite_session_factory() as session:
        assert _count(session, App) == 0
        assert _count(session, ToolFile) == 3
        assert _count(session, UploadFile) == 1
        uploaded = session.scalar(select(UploadFile))
        assert uploaded is not None
        assert uploaded.used is False


@pytest.mark.parametrize("failed_phase", ["files", "agent"])
def test_import_rolls_back_only_the_failed_transaction(sqlite_session_factory, failed_phase):
    storage = _MemoryStorage()

    def fail_after_flush(session, _flush_context):
        target = ToolFile if failed_phase == "files" else Site
        if any(isinstance(row, target) for row in session.new):
            raise RuntimeError("database write failed after flush")

    event.listen(sqlite_session_factory.class_, "after_flush", fail_after_flush)
    try:
        with pytest.raises(RosterAgentPackageImportFailedError):
            RosterAgentPackageImporter(storage_backend=storage).import_package(
                source=io.BytesIO(_package()), tenant_id="tenant-1", account=_account()
            )
    finally:
        event.remove(sqlite_session_factory.class_, "after_flush", fail_after_flush)

    assert len(storage.files) == 4
    assert storage.deleted == []
    with sqlite_session_factory() as session:
        for model in (
            App,
            AppModelConfig,
            Agent,
            AgentConfigSnapshot,
            AgentConfigRevision,
            AgentConfigDraft,
            AgentDebugConversation,
            Site,
            InstalledApp,
        ):
            assert _count(session, model) == 0
        assert _count(session, ToolFile) == (0 if failed_phase == "files" else 3)
        assert _count(session, UploadFile) == (0 if failed_phase == "files" else 1)
        if failed_phase == "agent":
            uploaded = session.scalar(select(UploadFile))
            assert uploaded is not None
            assert uploaded.used is False


@pytest.mark.usefixtures("sqlite_session_factory")
def test_uploads_do_not_hold_database_transactions(monkeypatch):
    sessions: list[Session] = []
    create_session = session_factory.create_session

    def track_session():
        session = create_session()
        sessions.append(session)
        return session

    storage = _MemoryStorage()
    save = storage.save

    def save_outside_transaction(filename: str, data: bytes) -> None:
        assert not any(session.in_transaction() for session in sessions)
        save(filename, data)

    monkeypatch.setattr(session_factory, "create_session", track_session)
    monkeypatch.setattr(storage, "save", save_outside_transaction)
    monkeypatch.setattr(AppService, "finalize_created_app", lambda *_args, **_kwargs: None)
    RosterAgentPackageImporter(storage_backend=storage).import_package(
        source=io.BytesIO(_package()), tenant_id="tenant-1", account=_account()
    )
    assert storage.save_count == 4


def test_import_succeeds_when_post_commit_initialization_fails(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    caplog: pytest.LogCaptureFixture,
) -> None:
    storage = _MemoryStorage()
    monkeypatch.setattr(
        AppService,
        "finalize_created_app",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("finalization failed")),
    )
    result = RosterAgentPackageImporter(storage_backend=storage).import_package(
        source=io.BytesIO(_package()), tenant_id="tenant-1", account=_account()
    )
    assert len(storage.files) == 4
    assert storage.deleted == []
    assert result.warnings == []
    assert "post-commit initialization failed" in caplog.text
    with sqlite_session_factory() as session:
        assert session.get(App, result.app_id) is not None
        assert session.get(Agent, result.agent_id) is not None
        for model in (
            AppModelConfig,
            AgentConfigSnapshot,
            AgentConfigRevision,
            AgentConfigDraft,
            AgentDebugConversation,
            Site,
            InstalledApp,
            UploadFile,
        ):
            assert _count(session, model) == 1
        assert _count(session, ToolFile) == 3
        uploaded = session.scalar(select(UploadFile))
        assert uploaded is not None
        assert uploaded.used is True
