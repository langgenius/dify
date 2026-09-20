"""Workflow packages restore node-owned Agents and assets across workspaces."""

from __future__ import annotations

import hashlib
import io
import zipfile
from collections.abc import Callable, Generator
from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock

import pytest
import yaml
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import QueuePool

from models import Account, App, AppMode
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.model import UploadFile
from models.skill import AgentSkillBinding, AgentSkillBindingSnapshot, Skill, SkillVersion, SkillVersionManifest
from models.tools import ToolFile
from models.workflow import Workflow, WorkflowType
from services.agent.dsl_entities import AgentPackage
from services.agent.errors import InvalidRosterAgentPackageError, RosterAgentPackageExportFailedError
from services.agent.package_resource_exporter import AgentPackageResourceExporter
from services.agent.package_resource_importer import AgentPackageResourceImporter
from services.app_dsl_service import AppDslService, Import
from services.app_package_service import AppPackageManifest, AppPackageService
from services.entities.dsl_entities import ImportStatus
from services.errors.account import NoPermissionError
from services.plugin.dependencies_analysis import DependenciesAnalysisService
from tests.unit_tests.model_factories import make_account, make_app, make_tenant, make_upload_file, make_workflow


class _MemoryStorage:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.saved: list[str] = []

    def load_stream(self, filename: str) -> Generator[bytes, None, None]:
        yield self.files[filename]

    def save(self, filename: str, data: bytes) -> None:
        self.files[filename] = data
        self.saved.append(filename)


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> _MemoryStorage:
    backend = _MemoryStorage()
    monkeypatch.setattr("services.workflow_service.db", SimpleNamespace(engine=sqlite_engine))
    monkeypatch.setattr(
        "services.app_package_service.AgentPackageResourceExporter",
        lambda: AgentPackageResourceExporter(storage_backend=backend),
    )
    monkeypatch.setattr(
        "services.app_package_service.AgentPackageResourceImporter",
        lambda: AgentPackageResourceImporter(storage_backend=backend),
    )
    monkeypatch.setattr(DependenciesAnalysisService, "generate_dependencies", lambda **_kwargs: [])
    return backend


def _skill(name: str, marker: str) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("SKILL.md", f"---\nname: {name}\ndescription: {marker}\n---\n\n# Instructions\n{marker}\n")
        archive.writestr("scripts/run.py", f"print({marker!r})\n")
    return output.getvalue()


def _tool_file(session: Session, storage: _MemoryStorage, key: str, payload: bytes) -> ToolFile:
    row = ToolFile(
        tenant_id="tenant-1",
        user_id="account-1",
        conversation_id=None,
        file_key=key,
        name=key.rsplit("/", 1)[-1],
        mimetype="application/zip",
        size=len(payload),
        original_url=None,
    )
    storage.files[key] = payload
    session.add(row)
    return row


def _source(
    session: Session, storage: _MemoryStorage, *, mode: AppMode = AppMode.WORKFLOW, published: bool = False
) -> App:
    app = make_app(mode=mode, name="Inline Workflow")
    nodes = [
        {
            "id": f"node-{index}",
            "data": {"type": "agent", "version": "2", "title": f"Agent {index}", "agent_node_kind": "dify_agent"},
        }
        for index in (1, 2)
    ]
    workflow = make_workflow(
        workflow_id="workflow-1",
        app_id=app.id,
        graph={"nodes": nodes, "edges": []},
        workflow_type=WorkflowType.CHAT if mode == AppMode.ADVANCED_CHAT else WorkflowType.WORKFLOW,
        version="2026-01-01 00:00:00" if published else Workflow.VERSION_DRAFT,
    )
    session.add_all([app, workflow])
    for index in (1, 2):
        skill_file = _tool_file(
            session, storage, f"tools/skill-{index}.zip", _skill("research", f"Agent {index} skill")
        )
        notes = _tool_file(session, storage, f"tools/notes-{index}.txt", f"Agent {index} notes".encode())
        upload = make_upload_file(file_id=f"upload-{index}", key=f"uploads/guide-{index}.txt", name="guide.txt")
        storage.files[upload.key] = f"Agent {index} guide".encode()
        agent = Agent(
            id=f"source-agent-{index}",
            tenant_id=app.tenant_id,
            name=f"Inline {index}",
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            app_id=app.id,
            workflow_id=workflow.id,
            workflow_node_id=f"node-{index}",
            status=AgentStatus.ACTIVE,
            created_by="account-1",
        )
        soul = AgentSoulConfig.model_validate(
            {
                "prompt": {"system_prompt": f"Bound snapshot {index}"},
                "config_skills": [{"name": "research", "file_id": skill_file.id}],
                "config_files": [
                    {"name": "notes.txt", "file_kind": "tool_file", "file_id": notes.id},
                    {"name": "guide.txt", "file_kind": "upload_file", "file_id": upload.id},
                ],
            }
        )
        snapshot = AgentConfigSnapshot(
            id=f"source-snapshot-{index}",
            tenant_id=app.tenant_id,
            agent_id=agent.id,
            version=1,
            config_snapshot=soul,
            created_by="account-1",
        )
        active = AgentConfigSnapshot(
            id=f"active-snapshot-{index}",
            tenant_id=app.tenant_id,
            agent_id=agent.id,
            version=2,
            config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "Unbound active snapshot"}}),
            created_by="account-1",
        )
        agent.active_config_snapshot_id = active.id
        binding = WorkflowAgentNodeBinding(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            workflow_version=workflow.version,
            node_id=f"node-{index}",
            binding_type=WorkflowAgentBindingType.INLINE_AGENT,
            agent_id=agent.id,
            current_snapshot_id=snapshot.id,
            node_job_config={"workflow_prompt": f"Job {index}"},
            created_by="account-1",
        )
        session.add_all([upload, agent, snapshot, active, binding])
        if index == 1:
            workspace_archive = _tool_file(
                session, storage, "tools/workspace.zip", _skill("workspace", "Workspace skill")
            )
            skill = Skill(
                id="source-workspace-skill",
                tenant_id=app.tenant_id,
                name="workspace",
                display_name="Workspace",
                description="Workspace skill",
                created_by="account-1",
                updated_by="account-1",
            )
            version = SkillVersion(
                id="source-skill-version",
                skill_id=skill.id,
                version_number=1,
                version_name="1.0",
                publish_note="",
                manifest=SkillVersionManifest(
                    name="workspace", display_name="Workspace", description="Workspace skill", files=[]
                ),
                archive_tool_file_id=workspace_archive.id,
                archive_size=workspace_archive.size,
                hash_code="workspace-hash",
                published_by="account-1",
            )
            skill.latest_published_version_id = version.id
            session.add_all(
                [
                    skill,
                    version,
                    AgentSkillBindingSnapshot(
                        tenant_id=app.tenant_id,
                        agent_id=agent.id,
                        config_snapshot_id=snapshot.id,
                        skill_id=skill.id,
                        priority=0,
                        created_by="account-1",
                    ),
                ]
            )
    session.commit()
    return app


def _account(tenant_id: str = "tenant-2") -> Account:
    return make_account(tenant=make_tenant(tenant_id=tenant_id))


def _import(session: Session, content: bytes, *, app_id: str | None = None, account: Account | None = None) -> Import:
    prepared = AppPackageService().read_package(io.BytesIO(content))
    assert prepared is not None
    with prepared:
        result = AppDslService(session).import_app(
            account=account or _account(),
            import_mode="yaml-content",
            yaml_content=prepared.dsl,
            app_id=app_id,
            package=prepared,
        )
    if result.status == ImportStatus.FAILED:
        session.rollback()
    else:
        session.commit()
    return result


def _rewrite(
    content: bytes, mutate: Callable[[AppPackageManifest, dict[str, object], dict[str, bytes]], None]
) -> bytes:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    manifest = AppPackageManifest.model_validate(yaml.safe_load(members["manifest.yaml"]))
    data = yaml.safe_load(members["app.yaml"])
    mutate(manifest, data, members)
    members["app.yaml"] = yaml.safe_dump(data).encode()
    manifest.apps[0].size = len(members["app.yaml"])
    manifest.apps[0].sha256 = hashlib.sha256(members["app.yaml"]).hexdigest()
    members["manifest.yaml"] = yaml.safe_dump(manifest.model_dump(mode="json")).encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for name, payload in members.items():
            archive.writestr(name, payload)
    return output.getvalue()


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
@pytest.mark.parametrize("published", [False, True])
def test_package_round_trip_restores_bound_agents_and_resources(
    sqlite_session: Session,
    storage: _MemoryStorage,
    mode: AppMode,
    published: bool,
) -> None:
    app = _source(sqlite_session, storage, mode=mode, published=published)
    with AppPackageService().export_app(app_model=app, workflow_id="workflow-1" if published else None) as exported:
        content = exported.archive.read()
    prepared = AppPackageService().read_package(io.BytesIO(content))
    assert prepared is not None
    with prepared:
        assert len(prepared.agent_resources) == 2
        assert [p.soul.prompt.system_prompt for p in prepared.agents.values()] == [
            "Bound snapshot 1",
            "Bound snapshot 2",
        ]
        assert all(not p.omitted_assets for p in prepared.agents.values())
        assert {r.name for group in prepared.agent_resources.values() for r in group.skills} == {
            "research",
            "workspace",
        }
    result = _import(sqlite_session, content)
    assert result.status == ImportStatus.COMPLETED, result.error
    assert result.app_mode == mode
    bindings = sqlite_session.scalars(
        select(WorkflowAgentNodeBinding)
        .where(WorkflowAgentNodeBinding.app_id == result.app_id)
        .order_by(WorkflowAgentNodeBinding.node_id)
    ).all()
    assert len(bindings) == 2
    for index, binding in enumerate(bindings, 1):
        assert binding.tenant_id == "tenant-2"
        assert binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT
        assert binding.node_job_config_dict["workflow_prompt"] == f"Job {index}"
        agent = sqlite_session.get(Agent, binding.agent_id)
        assert agent is not None
        assert (agent.scope, agent.app_id, agent.workflow_id, agent.workflow_node_id) == (
            AgentScope.WORKFLOW_ONLY,
            result.app_id,
            binding.workflow_id,
            binding.node_id,
        )
        snapshot = sqlite_session.get(AgentConfigSnapshot, binding.current_snapshot_id)
        assert snapshot is not None
        soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
        assert soul.prompt.system_prompt == f"Bound snapshot {index}"
        assert len(soul.config_skills) == (2 if index == 1 else 1)
        for ref in soul.config_skills:
            file = sqlite_session.get(ToolFile, ref.file_id)
            assert file is not None
            assert file.tenant_id == "tenant-2"
            assert not ref.is_missing
            with zipfile.ZipFile(io.BytesIO(storage.files[file.file_key])) as archive:
                expected = f"Agent {index} skill" if ref.name == "research" else "Workspace skill"
                assert expected.encode() in archive.read("SKILL.md")
        for ref in soul.config_files:
            row = sqlite_session.get(ToolFile if ref.file_kind == "tool_file" else UploadFile, ref.file_id)
            assert row is not None
            assert row.tenant_id == "tenant-2"
            key = row.file_key if isinstance(row, ToolFile) else row.key
            expected = f"Agent {index} notes" if ref.name == "notes.txt" else f"Agent {index} guide"
            assert storage.files[key] == expected.encode()
            if isinstance(row, UploadFile):
                assert row.used is True
                assert row.used_by == "account-1"
        assert sqlite_session.scalar(select(AgentSkillBinding).where(AgentSkillBinding.agent_id == agent.id)) is None


def test_yaml_export_still_omits_resources(sqlite_session: Session, storage: _MemoryStorage) -> None:
    app = _source(sqlite_session, storage)
    data = yaml.safe_load(AppDslService.export_dsl(app, session=sqlite_session))
    for package in data["agent_packages"].values():
        assert package["omitted_assets"]
        assert all(item["is_missing"] and item["file_id"] == "" for item in package["soul"]["config_files"])


def test_export_rejects_cross_tenant_assets(sqlite_session: Session, storage: _MemoryStorage) -> None:
    app = _source(sqlite_session, storage)
    row = sqlite_session.get(UploadFile, "upload-1")
    assert row is not None
    row.tenant_id = "tenant-elsewhere"
    sqlite_session.commit()
    with pytest.raises(RosterAgentPackageExportFailedError, match="payload is unavailable"):
        AppPackageService().export_app(app_model=app)


@pytest.mark.parametrize(
    "mutation", ["unknown_agent", "cross_agent_file", "unreferenced_agent", "duplicate_path", "file_checksum"]
)
def test_rejects_invalid_resource_ownership_before_upload(
    sqlite_session: Session,
    storage: _MemoryStorage,
    mutation: str,
) -> None:
    app = _source(sqlite_session, storage)
    with AppPackageService().export_app(app_model=app) as exported:
        content = exported.archive.read()

    def mutate(manifest: AppPackageManifest, data: dict[str, object], members: dict[str, bytes]) -> None:
        resources = manifest.agent_resources
        if mutation == "unknown_agent":
            resources["unknown"] = resources.pop("agent_1")
        elif mutation == "cross_agent_file":
            agents = cast(dict[str, object], data["agent_packages"])
            first = AgentPackage.model_validate(agents["agent_1"])
            second = AgentPackage.model_validate(agents["agent_2"])
            first.soul.config_files[0].file_id = second.soul.config_files[0].file_id
            agents["agent_1"] = first.model_dump(mode="json")
        elif mutation == "unreferenced_agent":
            cast(dict[str, dict[str, list[object]]], data["workflow"])["graph"]["nodes"].pop()
        elif mutation == "duplicate_path":
            resources["agent_2"].files[0] = resources["agent_1"].files[0]
        else:
            resource = resources["agent_1"].files[0]
            members[resource.path] = b"x" * resource.size

    with pytest.raises(InvalidRosterAgentPackageError):
        AppPackageService().read_package(io.BytesIO(_rewrite(content, mutate)))
    assert storage.saved == []


def test_pending_import_retains_materialized_resources_and_damage_warnings(
    sqlite_session: Session,
    storage: _MemoryStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = _source(sqlite_session, storage)
    with AppPackageService().export_app(app_model=app) as exported:
        content = exported.archive.read()

    def mutate(manifest: AppPackageManifest, data: dict[str, object], members: dict[str, bytes]) -> None:
        resources = manifest.agent_resources
        data["version"] = "99.0.0"
        resource = resources["agent_1"].skills[0]
        members[resource.path] = b"x" * resource.size

    pending: dict[str, str] = {}
    monkeypatch.setattr(
        "services.app_dsl_service.redis_client.setex", lambda key, _ttl, value: pending.__setitem__(key, value)
    )
    monkeypatch.setattr("services.app_dsl_service.redis_client.get", pending.get)
    monkeypatch.setattr("services.app_dsl_service.redis_client.delete", pending.pop)
    result = _import(sqlite_session, _rewrite(content, mutate))
    assert result.status == ImportStatus.PENDING
    saved_count = len(storage.saved)
    confirmed = AppDslService(sqlite_session).confirm_import(import_id=result.id, account=_account())
    assert confirmed.status == ImportStatus.COMPLETED_WITH_WARNINGS, confirmed.error
    assert any(
        warning.code == "agent_skill_missing" and warning.path.startswith("agent_packages.agent_1.")
        for warning in confirmed.warnings
    )
    assert len(storage.saved) == saved_count
    assert not pending


def test_overwrite_permission_is_checked_before_resource_upload(
    sqlite_session: Session,
    storage: _MemoryStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = _source(sqlite_session, storage)
    with AppPackageService().export_app(app_model=app) as exported:
        content = exported.archive.read()
    monkeypatch.setattr(AppDslService, "_load_app_for_overwrite", Mock(side_effect=NoPermissionError("Denied")))
    with pytest.raises(NoPermissionError):
        _import(sqlite_session, content, app_id="protected-app")
    assert not storage.saved


def test_overwrite_replaces_inline_agents_and_reports_previous_owners(
    sqlite_session: Session,
    storage: _MemoryStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = _source(sqlite_session, storage)
    with AppPackageService().export_app(app_model=app) as exported:
        content = exported.archive.read()
    original = _import(sqlite_session, content)
    assert original.status == ImportStatus.COMPLETED, original.error
    old_agents = set(
        sqlite_session.scalars(
            select(WorkflowAgentNodeBinding.agent_id).where(WorkflowAgentNodeBinding.app_id == original.app_id)
        )
    )
    sqlite_session.commit()
    retirement = Mock()
    monkeypatch.setattr("services.app_dsl_service.WorkflowAgentRetirementService.retire_unowned", retirement)
    updated = _import(sqlite_session, content, app_id=original.app_id)
    assert updated.status == ImportStatus.COMPLETED, updated.error
    assert updated.app_id == original.app_id
    new_agents = set(
        sqlite_session.scalars(
            select(WorkflowAgentNodeBinding.agent_id).where(WorkflowAgentNodeBinding.app_id == original.app_id)
        )
    )
    assert len(new_agents) == len(old_agents) == 2
    assert not (new_agents & old_agents)
    retirement.assert_called_once_with(tenant_id="tenant-2", agent_ids=old_agents, account_id="account-1")


@pytest.mark.parametrize("legacy_skill", [False, True])
def test_resource_io_runs_without_database_transactions(
    sqlite_session: Session,
    storage: _MemoryStorage,
    monkeypatch: pytest.MonkeyPatch,
    legacy_skill: bool,
) -> None:
    app = _source(sqlite_session, storage)
    if legacy_skill:
        version = sqlite_session.get(SkillVersion, "source-skill-version")
        assert version is not None
        version.manifest = version.manifest.model_copy(update={"name": None})
        sqlite_session.commit()
    engine = sqlite_session.get_bind()
    assert isinstance(engine, Engine)
    pool = engine.pool
    assert isinstance(pool, QueuePool)

    def before_io() -> None:
        assert not sqlite_session.in_transaction()
        assert pool.checkedout() == 0

    def load_legacy_skill(*, tenant_id: str, file_id: str) -> bytes:
        assert tenant_id == "tenant-1"
        assert file_id
        before_io()
        return storage.files["tools/workspace.zip"]

    monkeypatch.setattr(
        "services.skill_management_service.SkillManagementService._load_tool_file_bytes",
        staticmethod(load_legacy_skill),
    )
    load_stream = storage.load_stream
    save = storage.save

    def checked_load(filename: str) -> Generator[bytes, None, None]:
        before_io()
        yield from load_stream(filename)

    def checked_save(filename: str, data: bytes) -> None:
        before_io()
        save(filename, data)

    monkeypatch.setattr(storage, "load_stream", checked_load)
    monkeypatch.setattr(storage, "save", checked_save)
    with AppPackageService().export_app(app_model=app) as exported:
        content = exported.archive.read()
    result = _import(sqlite_session, content)
    assert result.status == ImportStatus.COMPLETED, result.error


def test_missing_assets_remain_explicit_import_warnings(sqlite_session: Session, storage: _MemoryStorage) -> None:
    app = _source(sqlite_session, storage)
    snapshot = sqlite_session.get(AgentConfigSnapshot, "source-snapshot-1")
    assert snapshot is not None
    soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
    soul.config_files[0].is_missing = True
    soul.config_files[0].file_id = ""
    snapshot.config_snapshot = soul
    sqlite_session.commit()
    with AppPackageService().export_app(app_model=app) as exported:
        result = _import(sqlite_session, exported.archive.read())
    assert result.status == ImportStatus.COMPLETED_WITH_WARNINGS, result.error
    assert any(warning.code == "agent_file_omitted" for warning in result.warnings)
