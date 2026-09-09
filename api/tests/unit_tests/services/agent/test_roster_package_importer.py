from __future__ import annotations

import hashlib
import io
import json
import zipfile
from collections.abc import Generator

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Forbidden

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
from models.model import App, AppModelConfig, Conversation, InstalledApp, Site, UploadFile
from models.tools import ToolFile
from services.agent.errors import (
    AgentNameConflictError,
    InvalidRosterAgentPackageError,
    RosterAgentPackageDependenciesMissingError,
    RosterAgentPackageImportFailedError,
    RosterAgentPackageResourceUnavailableError,
)
from services.agent.roster_package_cleanup import PackageCleanupCache, PackageCleanupJob, RosterPackageCleanup
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


class _CleanupCache(PackageCleanupCache):
    def __init__(self):
        self.jobs: dict[str, PackageCleanupJob] = {}

    def save(self, job: PackageCleanupJob) -> None:
        self.jobs[job.key] = job.model_copy(deep=True)

    def load(self, key: str) -> PackageCleanupJob | None:
        job = self.jobs.get(key)
        return job.model_copy(deep=True) if job else None

    def complete(self, key: str) -> None:
        self.jobs.pop(key, None)

    def due(self) -> list[str]:
        return list(self.jobs)


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
        assert len(failure.value.data["leaked_dependencies"]) == 1


def test_database_cleanup_failure_preserves_blobs_and_retries(monkeypatch, sqlite_session_factory):
    storage = _MemoryStorage()
    cache = _CleanupCache()
    cleanup = RosterPackageCleanup(cache=cache, storage_backend=storage)
    remove_database = cleanup._remove_database

    def unavailable(_job):
        raise RuntimeError("database unavailable")

    def fail_finalize(*_args, **_kwargs):
        raise RuntimeError("initialization failed")

    monkeypatch.setattr(cleanup, "_remove_database", unavailable)
    monkeypatch.setattr(AppService, "finalize_created_app", fail_finalize)
    with pytest.raises(RosterAgentPackageImportFailedError):
        RosterAgentPackageImporter(storage_backend=storage, cleanup=cleanup).import_package(
            source=io.BytesIO(_package()), tenant_id="tenant-1", account=_account()
        )
    assert len(storage.files) == 4
    assert storage.deleted == []
    key = next(iter(cache.jobs))
    assert cache.jobs[key].database_removed is False
    with sqlite_session_factory() as session:
        assert _count(session, App) == 1
    monkeypatch.setattr(cleanup, "_remove_database", remove_database)
    cleanup.run(key)
    assert storage.files == {}
    assert cache.jobs == {}
    with sqlite_session_factory() as session:
        assert _count(session, App) == 0
    cleanup.run(key)
    assert len(storage.deleted) == 4


def test_blob_cleanup_failure_retries_from_checkpoint(monkeypatch, sqlite_session_factory):
    storage = _MemoryStorage()
    cache = _CleanupCache()
    cleanup = RosterPackageCleanup(cache=cache, storage_backend=storage)
    delete_blob = storage.delete

    def unavailable(_key):
        raise OSError("storage unavailable")

    def fail_finalize(*_args, **_kwargs):
        raise RuntimeError("initialization failed")

    monkeypatch.setattr(storage, "delete", unavailable)
    monkeypatch.setattr(AppService, "finalize_created_app", fail_finalize)
    with pytest.raises(RosterAgentPackageImportFailedError):
        RosterAgentPackageImporter(storage_backend=storage, cleanup=cleanup).import_package(
            source=io.BytesIO(_package()), tenant_id="tenant-1", account=_account()
        )
    key = next(iter(cache.jobs))
    assert cache.jobs[key].database_removed is True
    with sqlite_session_factory() as session:
        assert _count(session, App) == 0

    def unexpected_database_access(_job):
        raise AssertionError("must resume after database cleanup")

    monkeypatch.setattr(cleanup, "_remove_database", unexpected_database_access)
    monkeypatch.setattr(storage, "delete", delete_blob)
    cleanup.run(key)
    assert storage.files == {}
    assert cache.jobs == {}


def test_cleanup_checkpoint_failure_preserves_blobs(monkeypatch, sqlite_session_factory):
    storage = _MemoryStorage()
    cache = _CleanupCache()
    cleanup = RosterPackageCleanup(cache=cache, storage_backend=storage)
    save = cache.save

    def save_until_checkpoint(job):
        if job.database_removed:
            raise RuntimeError("Redis checkpoint unavailable")
        save(job)

    def fail_finalize(*_args, **_kwargs):
        raise RuntimeError("initialization failed")

    monkeypatch.setattr(cache, "save", save_until_checkpoint)
    monkeypatch.setattr(AppService, "finalize_created_app", fail_finalize)
    with pytest.raises(RosterAgentPackageImportFailedError):
        RosterAgentPackageImporter(storage_backend=storage, cleanup=cleanup).import_package(
            source=io.BytesIO(_package()), tenant_id="tenant-1", account=_account()
        )
    with sqlite_session_factory() as session:
        assert _count(session, App) == 0
    assert len(storage.files) == 4
    key = next(iter(cache.jobs))
    assert cache.jobs[key].database_removed is False
    monkeypatch.setattr(cache, "save", save)
    cleanup.run(key)
    assert storage.files == {}


def test_periodic_cleanup_continues_after_one_failed_job(monkeypatch):
    from tasks import cleanup_roster_package_task as task

    cache = _CleanupCache()
    cache.save(PackageCleanupJob(tenant_id="tenant-1", app_id="failed"))
    cache.save(PackageCleanupJob(tenant_id="tenant-1", app_id="next"))
    cleanup = RosterPackageCleanup(cache=cache, storage_backend=_MemoryStorage())

    def remove_database(job):
        if job.app_id == "failed":
            raise RuntimeError("database unavailable")

    monkeypatch.setattr(cleanup, "_remove_database", remove_database)
    monkeypatch.setattr(task, "RosterPackageCleanup", lambda: cleanup)
    task.cleanup_roster_packages.run()
    assert set(cache.jobs) == {"tenant-1:failed"}
    monkeypatch.setattr(cleanup, "_remove_database", lambda _job: None)
    task.cleanup_roster_packages.run()
    assert cache.jobs == {}


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
    cache = _CleanupCache()
    monkeypatch.setattr("services.app_service.initialize_agent_rbac_access", lambda **_kwargs: None)
    monkeypatch.setattr("services.app_service.SystemFeatureService.is_webapp_auth_enabled", lambda: False)

    result = RosterAgentPackageImporter(
        storage_backend=storage,
        cleanup=RosterPackageCleanup(cache=cache, storage_backend=storage),
    ).import_package(
        source=io.BytesIO(_package()),
        tenant_id="tenant-1",
        account=_account(),
    )

    assert result.warnings == []
    assert cache.jobs == {}
    assert len(storage.files) == 4
    with sqlite_session_factory() as session:
        app = session.get(App, result.app_id)
        agent = session.get(Agent, result.agent_id)
        assert app is not None
        assert app.name == "Imported Agent"
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
    cache = _CleanupCache()
    importer = RosterAgentPackageImporter(
        storage_backend=storage, cleanup=RosterPackageCleanup(cache=cache, storage_backend=storage)
    )

    with pytest.raises(InvalidRosterAgentPackageError, match="binary_dependency"):
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
    cache = _CleanupCache()
    monkeypatch.setattr(AppService, "finalize_created_app", lambda *_args, **_kwargs: None)

    result = RosterAgentPackageImporter(
        storage_backend=storage, cleanup=RosterPackageCleanup(cache=cache, storage_backend=storage)
    ).import_package(
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
        assert dataset_id.startswith("missing-dataset-")
        assert dataset_id != "missing-dataset-id"


def test_import_validates_all_file_limits_before_staging(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = _MemoryStorage()
    cache = _CleanupCache()
    monkeypatch.setattr(FileService, "file_size_limit", lambda **_kwargs: 1)

    with pytest.raises(InvalidRosterAgentPackageError, match="file size limit"):
        RosterAgentPackageImporter(
            storage_backend=storage, cleanup=RosterPackageCleanup(cache=cache, storage_backend=storage)
        ).import_package(
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
    cache = _CleanupCache()

    with pytest.raises(AgentNameConflictError):
        RosterAgentPackageImporter(
            storage_backend=storage, cleanup=RosterPackageCleanup(cache=cache, storage_backend=storage)
        ).import_package(
            source=io.BytesIO(_package()),
            tenant_id="tenant-1",
            account=_account(),
        )

    assert storage.files == {}


def test_import_cleans_staged_resources_when_storage_fails(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    storage = _MemoryStorage(fail_save_at=2)
    cache = _CleanupCache()

    with pytest.raises(RosterAgentPackageResourceUnavailableError):
        RosterAgentPackageImporter(
            storage_backend=storage, cleanup=RosterPackageCleanup(cache=cache, storage_backend=storage)
        ).import_package(
            source=io.BytesIO(_package()),
            tenant_id="tenant-1",
            account=_account(),
        )

    assert storage.files == {}
    assert len(storage.deleted) == 2
    with sqlite_session_factory() as session:
        assert _count(session, App) == 0
        assert _count(session, ToolFile) == 0


def test_import_cleans_external_state_when_database_write_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = _MemoryStorage()
    cache = _CleanupCache()
    monkeypatch.setattr(
        RosterAgentPackageImporter,
        "_persist_import",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("database unavailable")),
    )

    with pytest.raises(RosterAgentPackageImportFailedError):
        RosterAgentPackageImporter(
            storage_backend=storage, cleanup=RosterPackageCleanup(cache=cache, storage_backend=storage)
        ).import_package(
            source=io.BytesIO(_package()),
            tenant_id="tenant-1",
            account=_account(),
        )

    assert storage.files == {}
    assert len(storage.deleted) == 4


def test_import_compensates_committed_state_when_finalization_fails(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    storage = _MemoryStorage()
    cache = _CleanupCache()
    monkeypatch.setattr(
        AppService,
        "finalize_created_app",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("finalization failed")),
    )

    with pytest.raises(RosterAgentPackageImportFailedError):
        RosterAgentPackageImporter(
            storage_backend=storage, cleanup=RosterPackageCleanup(cache=cache, storage_backend=storage)
        ).import_package(
            source=io.BytesIO(_package()),
            tenant_id="tenant-1",
            account=_account(),
        )

    assert storage.files == {}
    assert set(storage.deleted)
    with sqlite_session_factory() as session:
        for model in (
            App,
            AppModelConfig,
            Agent,
            AgentConfigSnapshot,
            AgentConfigRevision,
            AgentConfigDraft,
            AgentDebugConversation,
            Conversation,
            Site,
            InstalledApp,
            ToolFile,
            UploadFile,
        ):
            assert _count(session, model) == 0
