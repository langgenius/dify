from __future__ import annotations

import hashlib
import io
import json
import zipfile
from collections.abc import Callable, Generator, Mapping
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, Mock
from uuid import uuid4

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
from services.agent.errors import (
    InvalidRosterAgentPackageError,
    RosterAgentPackageExportFailedError,
    RosterAgentPackageTooLargeError,
)
from services.agent.package_resource_exporter import AgentPackageResourceExporter, _FileSource, _SkillSource
from services.agent.package_resource_importer import AgentPackageResourceImporter
from services.agent.roster_package_entities import PackageIcon, PreparedPackageArchive, RosterAgentPackageMember
from services.app_dsl_service import AppDslService, Import
from services.app_package_service import AppPackageManifest, AppPackageService
from services.dsl_content import DSL_MAX_SIZE
from services.entities.dsl_entities import ImportStatus
from services.errors.base import NoPermissionError
from services.plugin.dependencies_analysis import DependenciesAnalysisService
from tests.helpers.unit.model_factories import make_account, make_app, make_tenant, make_upload_file, make_workflow

"""Workflow packages restore node-owned Agents and assets across workspaces."""


class _MemoryStorage:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.saved: list[str] = []

    def load_stream(self, filename: str) -> Generator[bytes]:
        yield self.files[filename]

    def save(self, filename: str, data: bytes) -> None:
        self.files[filename] = data
        self.saved.append(filename)


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


def _import(
    session: Session,
    content: bytes,
    *,
    app_id: str | None = None,
    account: Account | None = None,
    preserve_agent_bindings: bool = False,
) -> Import:
    prepared = AppPackageService().read_package(io.BytesIO(content), accept_roster_references=preserve_agent_bindings)
    assert prepared is not None
    with prepared:
        result = AppDslService(session).import_app(
            account=account or _account(),
            import_mode="yaml-content",
            yaml_content=prepared.dsl,
            app_id=app_id,
            package=prepared,
            preserve_agent_bindings=preserve_agent_bindings,
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


def _add_roster_node(session: Session, app: App, *, graph_binding: Mapping[str, object] | None = None) -> Agent:
    workflow = session.get(Workflow, "workflow-1")
    assert workflow is not None
    graph = workflow.graph_dict
    data: dict[str, object] = {"type": "agent", "version": "2", "title": "Roster", "agent_node_kind": "dify_agent"}
    if graph_binding is not None:
        data["agent_binding"] = dict(graph_binding)
    graph["nodes"].append({"id": "node-3", "data": data})
    workflow.graph = json.dumps(graph)
    agent = Agent(
        id="roster-agent-1",
        tenant_id=app.tenant_id,
        name="Roster",
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="roster-snapshot-1",
        created_by="account-1",
    )
    snapshot = AgentConfigSnapshot(
        id="roster-snapshot-1",
        tenant_id=app.tenant_id,
        agent_id=agent.id,
        version=1,
        config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "Roster"}}),
        created_by="account-1",
    )
    binding = WorkflowAgentNodeBinding(
        tenant_id=app.tenant_id,
        app_id=app.id,
        workflow_id=workflow.id,
        workflow_version=workflow.version,
        node_id="node-3",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id=agent.id,
        current_snapshot_id=snapshot.id,
        node_job_config={"workflow_prompt": "Roster job"},
        created_by="account-1",
    )
    session.add_all([agent, snapshot, binding])
    session.commit()
    return agent


def _read_export(content: bytes) -> tuple[dict[str, object], dict[str, object]]:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        return yaml.safe_load(archive.read("app.yaml")), yaml.safe_load(archive.read("manifest.yaml"))


def _node_data(data: dict[str, object], node_id: str = "node-3") -> dict[str, object]:
    workflow = cast(dict[str, dict[str, list[dict[str, object]]]], data["workflow"])
    return next(cast(dict[str, object], node["data"]) for node in workflow["graph"]["nodes"] if node["id"] == node_id)


def _roster_export(session: Session, storage: _MemoryStorage) -> bytes:
    app = _source(session, storage)
    _add_roster_node(session, app)
    with AppPackageService().export_app(app_model=app, preserve_agent_bindings=True) as exported:
        return exported.archive.read()


def _bindings_by_node(session: Session, app_id: str | None) -> dict[str, WorkflowAgentNodeBinding]:
    rows = session.scalars(select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.app_id == app_id))
    return {row.node_id: row for row in rows}


class TestWorkflowPackageServiceCases:
    @staticmethod
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

    @staticmethod
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
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            manifest = yaml.safe_load(archive.read("manifest.yaml"))
            assert all(
                "audit" not in resource
                for group in manifest["agent_resources"].values()
                for resource in [*group["skills"], *group["files"]]
            )
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
            assert (
                sqlite_session.scalar(select(AgentSkillBinding).where(AgentSkillBinding.agent_id == agent.id)) is None
            )

    @staticmethod
    def test_yaml_export_still_omits_resources(sqlite_session: Session, storage: _MemoryStorage) -> None:
        app = _source(sqlite_session, storage)
        data = yaml.safe_load(AppDslService.export_dsl(app, session=sqlite_session))
        for package in data["agent_packages"].values():
            assert package["omitted_assets"]
            assert all(item["is_missing"] and item["file_id"] == "" for item in package["soul"]["config_files"])

    @staticmethod
    def test_export_rejects_cross_tenant_assets(sqlite_session: Session, storage: _MemoryStorage) -> None:
        app = _source(sqlite_session, storage)
        row = sqlite_session.get(UploadFile, "upload-1")
        assert row is not None
        row.tenant_id = "tenant-elsewhere"
        sqlite_session.commit()
        with pytest.raises(RosterAgentPackageExportFailedError, match="payload is unavailable"):
            AppPackageService().export_app(app_model=app)

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

        def checked_load(filename: str) -> Generator[bytes]:
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

    @staticmethod
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

    @staticmethod
    def test_reader_keeps_legacy_packaged_roster_nodes(sqlite_session: Session, storage: _MemoryStorage) -> None:
        app = _source(sqlite_session, storage)
        with AppPackageService().export_app(app_model=app) as exported:
            content = exported.archive.read()

        def mutate(_manifest: AppPackageManifest, data: dict[str, object], _members: dict[str, bytes]) -> None:
            cast(dict[str, object], _node_data(data, "node-1")["agent_binding"])["binding_type"] = "roster_agent"

        legacy = _rewrite(content, mutate)
        prepared = AppPackageService().read_package(io.BytesIO(legacy), accept_roster_references=True)
        assert prepared is not None
        prepared.close()

    @staticmethod
    def test_package_export_keeps_roster_references(sqlite_session: Session, storage: _MemoryStorage) -> None:
        app = _source(sqlite_session, storage)
        _add_roster_node(sqlite_session, app)
        with AppPackageService().export_app(app_model=app, preserve_agent_bindings=True) as exported:
            data, manifest = _read_export(exported.archive.read())
        node = _node_data(data)
        assert node["agent_binding"] == {
            "binding_type": "roster_agent",
            "agent_id": "roster-agent-1",
            "current_snapshot_id": "roster-snapshot-1",
        }
        assert node["agent_task"] == "Roster job"
        assert (
            set(cast(dict[str, object], manifest["agent_resources"]))
            == set(cast(dict[str, object], data["agent_packages"]))
            == {"agent_1", "agent_2"}
        )

    @staticmethod
    @pytest.mark.usefixtures("storage")
    def test_roster_only_package_export_passes_self_check(sqlite_session: Session) -> None:
        app = make_app(mode=AppMode.WORKFLOW, name="Roster Only")
        workflow = make_workflow(
            workflow_id="workflow-1",
            app_id=app.id,
            graph={"nodes": [], "edges": []},
            workflow_type=WorkflowType.WORKFLOW,
            version=Workflow.VERSION_DRAFT,
        )
        sqlite_session.add_all([app, workflow])
        sqlite_session.commit()
        _add_roster_node(sqlite_session, app)
        with AppPackageService().export_app(app_model=app, preserve_agent_bindings=True) as exported:
            data, manifest = _read_export(exported.archive.read())
        assert not manifest.get("agent_resources")
        assert cast(dict[str, object], _node_data(data)["agent_binding"])["agent_id"] == "roster-agent-1"

    @staticmethod
    def test_published_export_projects_the_exported_versions_bindings(
        sqlite_session: Session, storage: _MemoryStorage
    ) -> None:
        app = _source(sqlite_session, storage, published=True)
        _add_roster_node(sqlite_session, app, graph_binding={"binding_type": "roster_agent", "agent_id": "stale-agent"})
        with AppPackageService().export_app(
            app_model=app, workflow_id="workflow-1", preserve_agent_bindings=True
        ) as exported:
            content = exported.archive.read()
        data, _manifest = _read_export(content)
        node = _node_data(data)
        assert cast(dict[str, object], node["agent_binding"])["agent_id"] == "roster-agent-1"
        assert node["agent_task"] == "Roster job"
        result = _import(sqlite_session, content, account=_account("tenant-1"), preserve_agent_bindings=True)
        assert result.status == ImportStatus.COMPLETED, result.error
        roster = sqlite_session.scalars(
            select(WorkflowAgentNodeBinding).where(
                WorkflowAgentNodeBinding.app_id == result.app_id,
                WorkflowAgentNodeBinding.node_id == "node-3",
            )
        ).one()
        assert (roster.binding_type, roster.agent_id) == (WorkflowAgentBindingType.ROSTER_AGENT, "roster-agent-1")
        assert roster.node_job_config_dict["workflow_prompt"] == "Roster job"

    @staticmethod
    def test_overwrite_with_mixed_graph_keeps_roster_link(
        sqlite_session: Session, storage: _MemoryStorage, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "services.app_dsl_service.WorkflowAgentRetirementService.retire_unowned", lambda **_kwargs: None
        )
        content = _roster_export(sqlite_session, storage)
        account = _account("tenant-1")
        original = _import(sqlite_session, content, account=account, preserve_agent_bindings=True)
        updated = _import(
            sqlite_session, content, app_id=original.app_id, account=account, preserve_agent_bindings=True
        )
        assert updated.status == ImportStatus.COMPLETED, updated.error
        rows = _bindings_by_node(sqlite_session, original.app_id)
        assert rows["node-3"].binding_type == WorkflowAgentBindingType.ROSTER_AGENT
        assert rows["node-3"].agent_id == "roster-agent-1"
        assert rows["node-3"].node_job_config_dict["workflow_prompt"] == "Roster job"
        assert {rows["node-1"].binding_type, rows["node-2"].binding_type} == {WorkflowAgentBindingType.INLINE_AGENT}

    @staticmethod
    def test_unresolvable_roster_reference_fails_the_import(sqlite_session: Session, storage: _MemoryStorage) -> None:
        content = _roster_export(sqlite_session, storage)

        def mutate(_manifest: AppPackageManifest, data: dict[str, object], _members: dict[str, bytes]) -> None:
            cast(dict[str, object], _node_data(data)["agent_binding"])["agent_id"] = "missing-agent"

        result = _import(
            sqlite_session, _rewrite(content, mutate), account=_account("tenant-1"), preserve_agent_bindings=True
        )
        assert result.status == ImportStatus.FAILED
        assert "roster agent" in (result.error or "")

    @staticmethod
    def test_confirm_keeps_roster_link(
        sqlite_session: Session, storage: _MemoryStorage, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        content = _roster_export(sqlite_session, storage)

        def mutate(_manifest: AppPackageManifest, data: dict[str, object], _members: dict[str, bytes]) -> None:
            data["version"] = "99.0.0"

        pending: dict[str, str] = {}
        monkeypatch.setattr(
            "services.app_dsl_service.redis_client.setex", lambda key, _ttl, value: pending.__setitem__(key, value)
        )
        monkeypatch.setattr("services.app_dsl_service.redis_client.get", pending.get)
        monkeypatch.setattr("services.app_dsl_service.redis_client.delete", pending.pop)
        account = _account("tenant-1")
        result = _import(sqlite_session, _rewrite(content, mutate), account=account, preserve_agent_bindings=True)
        assert result.status == ImportStatus.PENDING
        confirmed = AppDslService(sqlite_session).confirm_import(import_id=result.id, account=account)
        assert confirmed.status in {ImportStatus.COMPLETED, ImportStatus.COMPLETED_WITH_WARNINGS}, confirmed.error
        row = _bindings_by_node(sqlite_session, confirmed.app_id)["node-3"]
        assert row.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
        assert row.agent_id == "roster-agent-1"


"""Ordinary App packages preserve DSLs and enforce container integrity."""


def _archive(dsl: str, **manifest_overrides: object) -> io.BytesIO:
    payload = dsl.encode()
    manifest = {
        "format": "dify.app",
        "format_version": 1,
        "apps": [{"path": "app.yaml", "size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}],
        **manifest_overrides,
    }
    source = io.BytesIO()
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.yaml", yaml.safe_dump(manifest))
        archive.writestr("app.yaml", payload)
    source.seek(0)
    return source


def _dsl_with_size(size: int) -> str:
    header = "kind: app\napp:\n  mode: workflow\n  description: "
    padding = size - len(header.encode("utf-8"))
    return header + "\U0001f600" * (padding // 4) + "a" * (padding % 4)


def _roster_archive(binding: dict[str, object], agent_job: dict[str, object] | None = None) -> io.BytesIO:
    node_data = {
        "type": "agent",
        "version": "2",
        "title": "Roster",
        "agent_node_kind": "dify_agent",
        "agent_binding": binding,
        "agent_job": agent_job or {"workflow_prompt": "Roster job"},
    }
    dsl = yaml.safe_dump(
        {
            "kind": "app",
            "app": {"mode": "workflow", "name": "Roster"},
            "workflow": {"graph": {"nodes": [{"id": "node-1", "data": node_data}], "edges": []}},
        }
    )
    with AppPackageService().export(dsl=dsl, name="Roster") as package:
        return io.BytesIO(package.archive.read())


class TestAppPackageServiceCases:
    @staticmethod
    @pytest.mark.parametrize("mode", ["workflow", "advanced-chat", "chat", "completion", "agent-chat"])
    @pytest.mark.parametrize("version", ["0.1.0", "99.0.0"])
    def test_round_trip_retains_exact_dsl_and_defers_version_handling(mode: str, version: str) -> None:
        dsl = f"kind: app\nversion: {version}\napp:\n  mode: {mode}\n# Preserve the DSL verbatim.\n"
        service = AppPackageService()
        with service.export(dsl=dsl, name="Example App") as package:
            assert package.filename == "example-app.ifpkg"
            prepared = service.read_package(package.archive)
            assert prepared is not None
            with prepared:
                assert prepared.dsl == dsl
            assert package.archive.tell() == 0
        assert package.archive.closed

    @staticmethod
    @pytest.mark.parametrize("overrides", [{"format": "unknown"}, {"format_version": 2}, {"apps": []}])
    def test_rejects_unsupported_manifests(overrides: dict[str, object]) -> None:
        with pytest.raises(InvalidRosterAgentPackageError, match="manifest"):
            AppPackageService().read_package(_archive("kind: app\napp: {mode: workflow}\n", **overrides))

    @staticmethod
    @pytest.mark.parametrize(
        "dsl",
        [
            "[]",
            "kind: app\napp: {mode: agent}",
            "kind: app\napp: {mode: unknown}",
            "kind: app\napp: {mode: workflow, mode: chat}",
            "kind: app\napp: {mode: workflow}\nsite: not-a-map",
        ],
    )
    def test_rejects_invalid_or_agent_dsl_in_ordinary_container(dsl: str) -> None:
        with pytest.raises(InvalidRosterAgentPackageError):
            AppPackageService().read_package(_archive(dsl))

    @staticmethod
    def test_rejects_checksum_mismatch() -> None:
        dsl = "kind: app\napp: {mode: workflow}\n"
        source = _archive(dsl, apps=[{"path": "app.yaml", "size": len(dsl), "sha256": "0" * 64}])
        with pytest.raises(InvalidRosterAgentPackageError, match="integrity"):
            AppPackageService().read_package(source)

    @staticmethod
    @pytest.mark.parametrize("path", ["extra.txt", "../escape", "APP.YAML"])
    def test_rejects_unlisted_unsafe_and_duplicate_members(path: str) -> None:
        source = _archive("kind: app\napp: {mode: workflow}\n")
        with zipfile.ZipFile(source, "a") as archive:
            archive.writestr(path, "unexpected")
        source.seek(0)
        with pytest.raises(InvalidRosterAgentPackageError):
            AppPackageService().read_package(source)

    @staticmethod
    def test_rejects_oversized_container(config_overrides: Callable[..., None]) -> None:
        source = _archive("kind: app\napp: {mode: workflow}\n")
        config_overrides(AGENT_PACKAGE_MAX_BYTES=10)
        with pytest.raises(RosterAgentPackageTooLargeError):
            AppPackageService().read_package(source)

    @staticmethod
    @pytest.mark.parametrize("size", [6 * 1024 * 1024, DSL_MAX_SIZE])
    def test_package_round_trip_accepts_large_dsl_within_legacy_limit(size: int) -> None:
        dsl = _dsl_with_size(size)
        service = AppPackageService()
        with service.export(dsl=dsl, name="Large Workflow") as package:
            prepared = service.read_package(package.archive)
            assert prepared is not None
            with prepared:
                assert prepared.dsl == dsl

    @staticmethod
    def test_export_rejects_dsl_exceeding_legacy_byte_limit() -> None:
        dsl = _dsl_with_size(DSL_MAX_SIZE + 1)
        with pytest.raises(RosterAgentPackageTooLargeError):
            AppPackageService().export(dsl=dsl, name="Large Workflow")

    @staticmethod
    def test_import_rejects_compressed_dsl_exceeding_legacy_byte_limit() -> None:
        dsl = _dsl_with_size(DSL_MAX_SIZE + 1)
        source = _archive(dsl)
        with pytest.raises(RosterAgentPackageTooLargeError):
            AppPackageService().read_package(source)

    @staticmethod
    @pytest.mark.parametrize(
        ("binding", "agent_job"),
        [
            pytest.param({"binding_type": "roster_agent"}, None, id="agent-id-missing"),
            pytest.param({"binding_type": "roster_agent", "agent_id": ""}, None, id="agent-id-empty"),
            pytest.param(
                {"binding_type": "roster_agent", "agent_id": "a", "package_ref": "agent_1"},
                None,
                id="package-ref-extra",
            ),
            pytest.param(
                {"binding_type": "roster_agent", "agent_id": "a"},
                {"declared_outputs": "not-a-list"},
                id="invalid-agent-job",
            ),
        ],
    )
    def test_roster_only_package_rejects_bad_references_when_accepted(
        binding: dict[str, object], agent_job: dict[str, object] | None
    ) -> None:
        with pytest.raises(InvalidRosterAgentPackageError, match="Agent references are invalid"):
            AppPackageService().read_package(_roster_archive(binding, agent_job), accept_roster_references=True)

    @staticmethod
    def test_non_workflow_package_is_accepted_when_roster_references_accepted() -> None:
        dsl = yaml.safe_dump({"kind": "app", "app": {"mode": "chat", "name": "Chat"}})
        with AppPackageService().export(dsl=dsl, name="Chat") as package:
            prepared = AppPackageService().read_package(package.archive, accept_roster_references=True)
        assert prepared is not None
        assert prepared.agents == {}
        prepared.close()


"""Packaged image icons travel with Apps and receive destination-owned file ids."""


def _icon_archive(*, payload: bytes = b"image", digest: str | None = None, reference: str = "i_000001") -> io.BytesIO:
    dsl = yaml.safe_dump({"kind": "app", "app": {"mode": "chat", "icon_type": "image", "icon": reference}})
    with AppPackageService().export(dsl=dsl.replace(reference, "legacy-id"), name="Example") as exported:
        with zipfile.ZipFile(exported.archive) as package:
            manifest = yaml.safe_load(package.read("manifest.yaml"))
    app_bytes = dsl.encode()
    manifest["apps"][0].update(size=len(app_bytes), sha256=hashlib.sha256(app_bytes).hexdigest())
    manifest["icons"] = [
        {
            "id": "i_000001",
            "path": "i_000001.png",
            "size": len(payload),
            "sha256": digest or hashlib.sha256(payload).hexdigest(),
        }
    ]
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as package:
        package.writestr("manifest.yaml", yaml.safe_dump(manifest))
        package.writestr("app.yaml", app_bytes)
        package.writestr("i_000001.png", payload)
    output.seek(0)
    return output


class TestPackageIconsCases:
    @staticmethod
    def test_app_icon_export_deduplicates_uploads_and_restores_references(monkeypatch: pytest.MonkeyPatch) -> None:
        source_id = str(uuid4())
        payload = b"image payload"
        backend = Mock()
        backend.load_stream.side_effect = lambda _: iter([payload])
        exporter = AgentPackageResourceExporter(storage_backend=backend)
        upload_lookup = Mock(return_value={source_id: SimpleNamespace(key="source/icon.png", extension="png")})
        monkeypatch.setattr(exporter, "_upload_files", upload_lookup)
        metadata = {"mode": "chat", "icon_type": "image", "icon": source_id}
        duplicate = dict(metadata)
        exporter.collect_icon(session=Mock(), tenant_id="source-tenant", metadata=metadata)
        exporter.collect_icon(session=Mock(), tenant_id="source-tenant", metadata=duplicate)
        assert metadata["icon"] == duplicate["icon"] == "i_000001"
        assert upload_lookup.call_args.kwargs["tenant_id"] == "source-tenant"
        assert upload_lookup.call_count == 1
        dsl = yaml.safe_dump({"kind": "app", "app": metadata})
        with AppPackageService().export(dsl=dsl, name="Example", resources=exporter) as exported:
            with zipfile.ZipFile(exported.archive) as package:
                assert package.read("i_000001.png") == payload
            exported.archive.seek(0)
            prepared = AppPackageService().read_package(exported.archive)
            assert prepared is not None
            with prepared:
                restore = Mock(return_value={"i_000001": "destination-id"})
                monkeypatch.setattr(AgentPackageResourceImporter, "materialize_icons", restore)
                data = yaml.safe_load(prepared.dsl)
                prepared.materialize_icons(data=data, tenant_id="destination", account_id="account")
                assert data["app"]["icon"] == "destination-id"
                assert restore.call_args.kwargs["tenant_id"] == "destination"

    @staticmethod
    def test_app_package_restores_independent_site_image_icon(monkeypatch: pytest.MonkeyPatch) -> None:
        app_icon_id, site_icon_id = str(uuid4()), str(uuid4())
        backend = Mock()
        backend.load_stream.side_effect = lambda key: iter([key.encode()])
        exporter = AgentPackageResourceExporter(storage_backend=backend)
        monkeypatch.setattr(
            exporter,
            "_upload_files",
            Mock(
                side_effect=lambda *, file_ids, **_kwargs: {
                    file_id: SimpleNamespace(key=f"source/{file_id}.png", extension="png") for file_id in file_ids
                }
            ),
        )
        app = {"mode": "chat", "icon_type": "image", "icon": app_icon_id}
        site = {"title": "Site", "icon_type": "image", "icon": site_icon_id}
        exporter.collect_icon(session=Mock(), tenant_id="source", metadata=app)
        exporter.collect_icon(session=Mock(), tenant_id="source", metadata=site)
        with AppPackageService().export(
            dsl=yaml.safe_dump({"kind": "app", "app": app, "site": site}), name="App", resources=exporter
        ) as exported:
            prepared = AppPackageService().read_package(exported.archive)
            assert prepared is not None
            with prepared:
                assert len(prepared.icons) == 2
                monkeypatch.setattr(
                    AgentPackageResourceImporter,
                    "materialize_icons",
                    Mock(return_value={app["icon"]: "new-app-icon", site["icon"]: "new-site-icon"}),
                )
                data = yaml.safe_load(prepared.dsl)
                prepared.materialize_icons(data=data, tenant_id="destination", account_id="account")
                assert data["app"]["icon"] == "new-app-icon"
                assert data["site"]["icon"] == "new-site-icon"

    @staticmethod
    def test_icon_export_rejects_unavailable_tenant_upload(monkeypatch: pytest.MonkeyPatch) -> None:
        exporter = AgentPackageResourceExporter(storage_backend=Mock())
        monkeypatch.setattr(exporter, "_upload_files", Mock(return_value={}))
        with pytest.raises(RosterAgentPackageExportFailedError, match="unavailable"):
            exporter.collect_icon(
                session=Mock(), tenant_id="tenant", metadata={"icon_type": "image", "icon": str(uuid4())}
            )

    @staticmethod
    def test_icon_checksum_is_required() -> None:
        with pytest.raises(InvalidRosterAgentPackageError, match="integrity"):
            AppPackageService().read_package(_icon_archive(digest="0" * 64))

    @staticmethod
    @pytest.mark.parametrize("reference", ["i_000002", "unrelated-upload"])
    def test_icon_must_resolve_to_metadata(reference: str) -> None:
        with pytest.raises(InvalidRosterAgentPackageError, match="references"):
            AppPackageService().read_package(_icon_archive(reference=reference))

    @staticmethod
    def test_icon_image_limit_is_enforced(config_overrides: Callable[..., None]) -> None:
        config_overrides(UPLOAD_IMAGE_FILE_SIZE_LIMIT=0)
        with pytest.raises(RosterAgentPackageTooLargeError, match="image size"):
            AppPackageService().read_package(_icon_archive())

    @staticmethod
    def test_materialized_icon_is_owned_by_destination(monkeypatch: pytest.MonkeyPatch) -> None:
        payload = b"image payload"
        digest = hashlib.sha256(payload).hexdigest()
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as package:
            package.writestr("i_000001.png", payload)
        prepared = PreparedPackageArchive(
            archive=archive, members={"i_000001.png": RosterAgentPackageMember(size=len(payload), sha256=digest)}
        )
        icon = PackageIcon(id="i_000001", path="i_000001.png", size=len(payload), sha256=digest)
        session = MagicMock()
        monkeypatch.setattr(
            "services.agent.package_resource_importer.session_factory.create_session",
            MagicMock(return_value=session),
        )
        backend = Mock()
        with prepared:
            mapping = AgentPackageResourceImporter(storage_backend=backend).materialize_icons(
                archive=prepared, icons=[icon], tenant_id="destination", account_id="importer"
            )
        row = session.__enter__.return_value.add_all.call_args.args[0][0]
        assert row.id == mapping["i_000001"]
        assert row.tenant_id == "destination"
        assert row.created_by == "importer"
        assert row.mime_type == "image/png"
        assert row.key.startswith("upload_files/destination/")
        backend.save.assert_called_once_with(row.key, payload)

    @staticmethod
    def test_roster_export_embeds_agent_icon(monkeypatch: pytest.MonkeyPatch) -> None:
        from models.agent_config_entities import AgentSoulConfig
        from models.model import App, AppMode
        from services.agent.dsl_entities import AgentPackage, AgentPackageMetadata, make_agent_app_dsl
        from services.agent.roster_package_exporter import RosterAgentPackageExporter
        from services.agent.roster_package_reader import RosterAgentPackageReader
        from services.entities.site_dsl import SiteDsl

        backend = Mock()
        backend.load_stream.side_effect = lambda _: iter([b"icon"])
        resources = AgentPackageResourceExporter(storage_backend=backend)
        resources.sources["agent_1"] = (list[_SkillSource](), list[_FileSource]())
        metadata = {"name": "Agent", "icon_type": "image", "icon": "source-id"}
        monkeypatch.setattr(
            resources,
            "_upload_files",
            Mock(
                return_value={
                    "source-id": SimpleNamespace(key="icon.png", extension="png"),
                }
            ),
        )
        resources.collect_icon(session=Mock(), tenant_id="source", metadata=metadata)
        app = make_agent_app_dsl(
            App(name="Agent", mode=AppMode.AGENT),
            package_ref="agent_1",
            packages={
                "agent_1": AgentPackage(metadata=AgentPackageMetadata.model_validate(metadata), soul=AgentSoulConfig())
            },
            dependencies=[],
        )
        app.site = SiteDsl(title="Agent Site", icon_type="image", icon="i_000001")
        with RosterAgentPackageExporter(storage_backend=backend)._build_archive(
            app=app, resources=resources
        ) as exported:
            with RosterAgentPackageReader().read(exported.archive) as prepared:
                assert prepared.apps["app.yaml"].package.metadata.icon == "i_000001"
                assert prepared.apps["app.yaml"].site is not None
                assert prepared.apps["app.yaml"].site.icon == "i_000001"
                assert prepared.manifest.icons[0].path == "i_000001.png"
                assert RosterAgentPackageReader().read_member_bytes(prepared, "i_000001.png", max_bytes=4) == b"icon"
