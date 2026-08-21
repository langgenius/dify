import json
from unittest.mock import Mock

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from graphon.enums import BuiltinNodeTypes
from models.account import Account
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentIconType,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentConfigFileRefConfig, AgentConfigSkillRefConfig, AgentSoulConfig
from models.dataset import Dataset
from models.enums import AppStatus
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.agent.dsl_entities import (
    AGENT_NODE_JOB_DSL_KEY,
    AGENT_PACKAGE_REF_KEY,
    AgentPackage,
    AgentPackageMetadata,
    make_portable_agent_package,
)
from services.agent.dsl_service import AgentDslService, AgentPackageImportResult, is_agent_v2_graph
from services.entities.dsl_entities import DslImportWarning


def _agent(
    *,
    agent_id: str = "agent-1",
    app_id: str | None = None,
    name: str = "Portable Agent",
    scope: AgentScope = AgentScope.ROSTER,
    source: AgentSource = AgentSource.AGENT_APP,
) -> Agent:
    agent = Agent(
        tenant_id="tenant-1",
        name=name,
        description="description",
        role="researcher",
        scope=scope,
        source=source,
        status=AgentStatus.ACTIVE,
        app_id=app_id,
        icon_type=AgentIconType.EMOJI,
        icon="R",
    )
    agent.id = agent_id
    return agent


def _snapshot(
    *,
    snapshot_id: str = "snapshot-1",
    agent_id: str = "agent-1",
    version: int = 1,
    soul: AgentSoulConfig | None = None,
) -> AgentConfigSnapshot:
    snapshot = AgentConfigSnapshot(
        tenant_id="tenant-1",
        agent_id=agent_id,
        version=version,
        home_snapshot_id="home-1",
        config_snapshot=soul or AgentSoulConfig(),
        created_by="account-1",
    )
    snapshot.id = snapshot_id
    return snapshot


def _app(*, name: str = "", description: str = "", mode: AppMode = AppMode.AGENT_CHAT) -> App:
    return App(
        id="app-1",
        tenant_id="tenant-1",
        name=name,
        description=description,
        mode=mode,
        status=AppStatus.NORMAL,
        enable_site=False,
        enable_api=False,
        api_rpm=0,
        api_rph=0,
    )


def _account() -> Account:
    account = Account(name="Owner", email="owner@example.com")
    account.id = "account-1"
    return account


def _workflow(*, workflow_id: str = "workflow-1") -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id="tenant-1",
        app_id="app-1",
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph={"nodes": [], "edges": []},
        features={},
        created_by="account-1",
        environment_variables=[],
        conversation_variables=[],
    )


def _agent_node(node_id: str, binding: object | None = None) -> dict:
    data = {"type": BuiltinNodeTypes.AGENT, "version": "2", "agent_node_kind": "dify_agent"}
    if binding is not None:
        data["agent_binding"] = binding
    return {"id": node_id, "data": data}


def test_make_portable_agent_package_strips_workspace_credentials_and_assets() -> None:
    soul = AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "langgenius/openai/openai",
                "model": "gpt-test",
                "credential_ref": {"type": "provider", "id": "model-secret"},
            },
            "tools": {
                "dify_tools": [
                    {
                        "provider_id": "langgenius/google/google",
                        "provider_type": "plugin",
                        "tool_name": "search",
                        "credential_type": "api-key",
                        "credential_ref": {"type": "tool", "id": "tool-secret"},
                        "runtime_parameters": {
                            "query": "hello",
                            "upload_file_id": "upload-1",
                            "api_key": "plain-secret",
                        },
                    }
                ],
                "cli_tools": [
                    {
                        "name": "cli",
                        "env": {
                            "secret_refs": [
                                {
                                    "name": "TOKEN",
                                    "value": "plain-secret",
                                    "credential_id": "credential-1",
                                }
                            ]
                        },
                    }
                ],
            },
            "env": {"secret_refs": [{"name": "GLOBAL_TOKEN", "value": "plain-secret", "id": "secret-1"}]},
            "config_skills": [{"name": "research", "file_kind": "tool_file", "file_id": "skill-file"}],
            "config_files": [{"name": "guide.md", "file_kind": "upload_file", "file_id": "config-file"}],
            "human": {
                "contacts": [
                    {
                        "id": "human-1",
                        "tenant_id": "tenant-1",
                        "name": "Reviewer",
                        "email": "reviewer@example.com",
                    }
                ]
            },
        }
    )

    package = make_portable_agent_package(_agent(), soul)
    serialized = package.model_dump(mode="json")

    assert package.soul.model is not None
    assert package.soul.model.credential_ref is None
    assert package.soul.tools.dify_tools[0].credential_type == "unauthorized"
    assert package.soul.tools.dify_tools[0].credential_ref is None
    assert package.soul.tools.dify_tools[0].runtime_parameters["upload_file_id"] is None
    assert package.soul.tools.dify_tools[0].runtime_parameters["api_key"] is None
    assert package.soul.config_skills[0].name == "research"
    assert package.soul.config_skills[0].file_id == ""
    assert package.soul.config_skills[0].is_missing is True
    assert package.soul.config_files[0].name == "guide.md"
    assert package.soul.config_files[0].file_id == ""
    assert package.soul.config_files[0].is_missing is True
    assert [asset.kind for asset in package.omitted_assets] == ["skill", "file"]
    assert "plain-secret" not in str(serialized)
    assert "model-secret" not in str(serialized)
    assert "tool-secret" not in str(serialized)
    assert "skill-file" not in str(serialized)
    assert "config-file" not in str(serialized)
    assert package.soul.human.contacts[0].id is None
    assert package.soul.human.contacts[0].name == "Reviewer"


def test_agent_package_round_trips_as_strict_dsl_dto() -> None:
    package = make_portable_agent_package(_agent(), AgentSoulConfig())

    restored = AgentPackage.model_validate(package.model_dump(mode="json"))

    assert restored == package


def test_agent_package_normalizes_legacy_null_missing_asset_file_ids() -> None:
    package = make_portable_agent_package(
        _agent(),
        AgentSoulConfig.model_validate(
            {
                "config_skills": [{"name": "research", "file_id": "skill-file"}],
                "config_files": [{"name": "guide.md", "file_kind": "tool_file", "file_id": "config-file"}],
            }
        ),
    ).model_dump(mode="json")
    package["soul"]["config_skills"][0]["file_id"] = None
    package["soul"]["config_files"][0]["file_id"] = None

    restored = AgentPackage.model_validate(package)

    assert restored.soul.config_skills[0].file_id == ""
    assert restored.soul.config_files[0].file_id == ""
    assert restored.model_dump(mode="json")["soul"]["config_skills"][0]["file_id"] == ""
    assert restored.model_dump(mode="json")["soul"]["config_files"][0]["file_id"] == ""


@pytest.mark.parametrize(
    "asset",
    [
        {"name": "research", "file_id": None, "is_missing": False},
        {"name": "guide.md", "file_kind": "tool_file", "file_id": None, "is_missing": False},
    ],
)
def test_agent_package_rejects_null_file_id_for_available_assets(asset: dict) -> None:
    package = make_portable_agent_package(_agent(), AgentSoulConfig()).model_dump(mode="json")
    target = "config_files" if "file_kind" in asset else "config_skills"
    package["soul"][target] = [asset]

    with pytest.raises(ValidationError):
        AgentPackage.model_validate(package)


def test_import_warnings_cover_runtime_setup_removed_from_package(
    monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    soul = AgentSoulConfig.model_validate(
        {
            "tools": {
                "dify_tools": [
                    {
                        "provider_id": "langgenius/google/google",
                        "provider_type": "plugin",
                        "tool_name": "search",
                        "credential_type": "unauthorized",
                    }
                ],
                "cli_tools": [{"name": "cli", "env": {"secret_refs": [{"name": "CLI_TOKEN"}]}}],
            },
            "env": {"secret_refs": [{"name": "GLOBAL_TOKEN"}]},
            "human": {"contacts": [{"name": "Reviewer", "email": "reviewer@example.com"}]},
        }
    )
    monkeypatch.setattr("services.agent.dsl_service.get_tenant_knowledge_dataset_rows", Mock(return_value={}))

    _, warnings = AgentDslService(unbound_session)._resolve_package_soul(
        tenant_id="tenant-1",
        package=make_portable_agent_package(_agent(), soul),
        package_path="agent_packages.agent_1",
    )

    codes = [warning.code for warning in warnings]
    assert codes.count("agent_tool_authorization_required") == 1
    assert codes.count("agent_secret_required") == 2
    assert codes.count("agent_human_contact_unresolved") == 1


def test_agent_package_rejects_unknown_schema_version() -> None:
    package = make_portable_agent_package(_agent(), AgentSoulConfig()).model_dump(mode="json")
    package["schema_version"] = 2

    with pytest.raises(ValidationError):
        AgentPackage.model_validate(package)


def test_export_agent_app_requires_backing_agent(sqlite_session: Session) -> None:
    with pytest.raises(ValueError, match="no active backing Agent"):
        AgentDslService(sqlite_session).export_agent_app(app=_app())


@pytest.mark.parametrize("use_draft", [True, False])
def test_export_agent_app_uses_draft_or_active_snapshot(sqlite_session: Session, use_draft: bool) -> None:
    agent = _agent(app_id="app-1")
    agent.active_config_snapshot_id = "snapshot-1"
    snapshot = _snapshot(soul=AgentSoulConfig(config_note="snapshot"))
    rows: list[object] = [agent, snapshot]
    if use_draft:
        rows.append(
            AgentConfigDraft(
                id="draft-1",
                tenant_id="tenant-1",
                agent_id=agent.id,
                draft_type=AgentConfigDraftType.DRAFT,
                account_id=None,
                draft_owner_key="",
                config_snapshot=AgentSoulConfig(config_note="draft"),
            )
        )
    sqlite_session.add_all(rows)
    sqlite_session.commit()

    package_ref, packages = AgentDslService(sqlite_session).export_agent_app(app=_app())

    assert package_ref == "agent_1"
    assert packages[package_ref].soul.config_note == ("draft" if use_draft else "snapshot")


def test_export_workflow_packages_deduplicates_shared_agent(sqlite_session: Session) -> None:
    graph = {"nodes": [_agent_node("node-1"), _agent_node("node-2")], "edges": []}
    bindings = [
        WorkflowAgentNodeBinding(
            id=f"binding-{node_id}",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id=node_id,
            agent_id="agent-1",
            current_snapshot_id="snapshot-1",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            node_job_config={"workflow_prompt": node_id},
        )
        for node_id in ("node-1", "node-2")
    ]
    sqlite_session.add_all([_agent(), _snapshot(), *bindings])
    sqlite_session.commit()

    portable_graph, packages = AgentDslService(sqlite_session).export_workflow_packages(
        workflow=_workflow(),
        graph=graph,
    )

    assert list(packages) == ["agent_1"]
    for node in portable_graph["nodes"]:
        assert node["data"]["agent_binding"] == {
            "binding_type": WorkflowAgentBindingType.ROSTER_AGENT.value,
            AGENT_PACKAGE_REF_KEY: "agent_1",
        }
        assert node["data"][AGENT_NODE_JOB_DSL_KEY]["workflow_prompt"] == node["id"]


def test_export_workflow_packages_rejects_incomplete_binding(sqlite_session: Session) -> None:
    with pytest.raises(ValueError, match="no complete persisted binding"):
        AgentDslService(sqlite_session).export_workflow_packages(
            workflow=_workflow(),
            graph={"nodes": [_agent_node("node-1")], "edges": []},
        )


def test_graph_without_package_bindings_removes_portable_fields() -> None:
    graph = {
        "nodes": [
            _agent_node(
                "portable",
                {
                    "binding_type": WorkflowAgentBindingType.INLINE_AGENT.value,
                    AGENT_PACKAGE_REF_KEY: "agent_1",
                },
            ),
            _agent_node("persisted", {"binding_type": "inline_agent", "agent_id": "agent-1"}),
        ],
        "edges": [],
    }
    for node in graph["nodes"]:
        node["data"][AGENT_NODE_JOB_DSL_KEY] = {"workflow_prompt": "work"}

    result = AgentDslService.graph_without_package_bindings(graph)

    assert "agent_binding" not in result["nodes"][0]["data"]
    assert result["nodes"][1]["data"]["agent_binding"]["agent_id"] == "agent-1"
    assert all(AGENT_NODE_JOB_DSL_KEY not in node["data"] for node in result["nodes"])
    assert AGENT_NODE_JOB_DSL_KEY in graph["nodes"][0]["data"]


def test_import_agent_app_package_creates_config_and_unpublished_draft(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    service = AgentDslService(sqlite_session)
    soul = AgentSoulConfig(config_note="portable")
    warning = DslImportWarning(code="setup", path="agent.soul", message="setup required")
    service._resolve_package_soul = Mock(return_value=(soul, [warning]))
    service._unique_roster_name = Mock(return_value="Portable Agent import")
    agent = _agent()
    agent.active_config_snapshot_id = "snapshot-1"
    agent.active_config_is_published = True
    snapshot = _snapshot(soul=soul)
    roster_service = Mock()

    def create_backing_agent(**_kwargs: object) -> Agent:
        sqlite_session.add_all([agent, snapshot])
        sqlite_session.flush()
        return agent

    roster_service.create_backing_agent_for_app.side_effect = create_backing_agent
    monkeypatch.setattr("services.agent.dsl_service.AgentRosterService", Mock(return_value=roster_service))
    app = _app()
    sqlite_session.add(app)
    sqlite_session.commit()

    result = service.import_agent_app_package(
        app=app,
        account=_account(),
        package=make_portable_agent_package(_agent(), soul),
    )

    assert result.warnings == [warning]
    assert agent.active_config_is_published is False
    assert app.name == "Portable Agent"
    assert app.description == "description"
    assert app.app_model_config_id is not None
    draft = sqlite_session.scalar(
        select(AgentConfigDraft).where(
            AgentConfigDraft.agent_id == agent.id,
            AgentConfigDraft.draft_type == AgentConfigDraftType.DRAFT,
        )
    )
    assert draft is not None
    assert draft.config_snapshot.config_note == "portable"


def test_import_workflow_packages_materializes_every_package_binding_as_inline(sqlite_session: Session) -> None:
    package = make_portable_agent_package(_agent(), AgentSoulConfig())
    graph = {
        "nodes": [
            _agent_node(
                "roster-1",
                {"binding_type": WorkflowAgentBindingType.ROSTER_AGENT.value, AGENT_PACKAGE_REF_KEY: "agent_1"},
            ),
            _agent_node(
                "roster-2",
                {"binding_type": WorkflowAgentBindingType.ROSTER_AGENT.value, AGENT_PACKAGE_REF_KEY: "agent_1"},
            ),
            _agent_node(
                "inline",
                {"binding_type": WorkflowAgentBindingType.INLINE_AGENT.value, AGENT_PACKAGE_REF_KEY: "agent_1"},
            ),
            _agent_node("missing-binding"),
            _agent_node("invalid-ref", {AGENT_PACKAGE_REF_KEY: 1}),
        ],
        "edges": [],
    }
    for node in graph["nodes"][:3]:
        node["data"][AGENT_NODE_JOB_DSL_KEY] = {"workflow_prompt": node["id"]}
    old_binding = WorkflowAgentNodeBinding(
        id="old-binding",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version=Workflow.VERSION_DRAFT,
        node_id="old-node",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="old-inline-agent",
        current_snapshot_id="old-snapshot",
        node_job_config={},
    )
    sqlite_session.add(old_binding)
    sqlite_session.commit()
    service = AgentDslService(sqlite_session)
    imported_results = [
        AgentPackageImportResult(
            agent=_agent(
                agent_id=f"inline-agent-{index}",
                scope=AgentScope.WORKFLOW_ONLY,
                source=AgentSource.IMPORTED,
            ),
            snapshot=_snapshot(
                snapshot_id=f"inline-snapshot-{index}",
                agent_id=f"inline-agent-{index}",
            ),
            warnings=[DslImportWarning(code=f"inline-{index}", path="agent", message="inline warning")],
        )
        for index in range(1, 4)
    ]
    service._create_imported_inline_agent = Mock(side_effect=imported_results)
    workflow = _workflow()

    result, warnings, retirement_candidates = service.import_workflow_packages(
        workflow=workflow,
        portable_graph=graph,
        raw_packages={"agent_1": package.model_dump(mode="json")},
        account=_account(),
    )

    assert sqlite_session.get(WorkflowAgentNodeBinding, old_binding.id) is None
    assert retirement_candidates == {"old-inline-agent"}
    assert service._create_imported_inline_agent.call_count == 3
    assert [call.kwargs["node_id"] for call in service._create_imported_inline_agent.call_args_list] == [
        "roster-1",
        "roster-2",
        "inline",
    ]
    assert [warning.code for warning in warnings] == ["inline-1", "inline-2", "inline-3"]
    bindings = [result["nodes"][index]["data"]["agent_binding"] for index in range(3)]
    assert [binding["agent_id"] for binding in bindings] == [
        "inline-agent-1",
        "inline-agent-2",
        "inline-agent-3",
    ]
    assert all(binding["binding_type"] == WorkflowAgentBindingType.INLINE_AGENT.value for binding in bindings)
    assert AGENT_NODE_JOB_DSL_KEY not in result["nodes"][0]["data"]
    assert json.loads(workflow.graph) == result
    added_bindings = sqlite_session.scalars(
        select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.workflow_id == workflow.id)
    ).all()
    assert len(added_bindings) == 3
    assert all(binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT for binding in added_bindings)


@pytest.mark.parametrize(
    ("binding", "error"),
    [
        (
            {"binding_type": WorkflowAgentBindingType.INLINE_AGENT.value, AGENT_PACKAGE_REF_KEY: "missing"},
            "unknown package",
        ),
        ({"binding_type": "invalid", AGENT_PACKAGE_REF_KEY: "agent_1"}, "invalid binding type"),
    ],
)
def test_import_workflow_packages_rejects_invalid_package_binding(
    sqlite_session: Session, binding: dict, error: str
) -> None:
    package = make_portable_agent_package(_agent(), AgentSoulConfig())

    with pytest.raises(ValueError, match=error):
        AgentDslService(sqlite_session).import_workflow_packages(
            workflow=_workflow(),
            portable_graph={"nodes": [_agent_node("node-1", binding)], "edges": []},
            raw_packages={"agent_1": package.model_dump(mode="json")},
            account=_account(),
        )


def test_clone_inline_binding_copies_soul(unbound_session: Session) -> None:
    service = AgentDslService(unbound_session)
    target_agent = _agent(
        agent_id="target-agent",
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
    )
    target_snapshot = _snapshot(snapshot_id="target-snapshot", agent_id=target_agent.id)
    service._create_workflow_only_agent = Mock(return_value=(target_agent, target_snapshot))
    source_agent = _agent()
    source_soul = AgentSoulConfig(
        config_note="source",
        config_skills=[AgentConfigSkillRefConfig(name="summarizer", file_id="skill-file-1")],
        config_files=[AgentConfigFileRefConfig(name="brief.pdf", file_kind="upload_file", file_id="config-file-1")],
    )
    source_snapshot = _snapshot(soul=source_soul)
    workflow = _workflow()

    result = service.clone_inline_binding_for_node(
        workflow=workflow,
        node_id="target-node",
        source_agent=source_agent,
        source_snapshot=source_snapshot,
        account_id="account-1",
    )

    assert result == (target_agent, target_snapshot)
    create_kwargs = service._create_workflow_only_agent.call_args.kwargs
    assert create_kwargs["metadata"].name == source_agent.name
    cloned_soul = create_kwargs["soul"]
    assert cloned_soul.config_note == "source"
    assert [(item.name, item.file_kind, item.file_id) for item in cloned_soul.config_skills] == [
        ("summarizer", "tool_file", "skill-file-1")
    ]
    assert [(item.name, item.file_kind, item.file_id) for item in cloned_soul.config_files] == [
        ("brief.pdf", "upload_file", "config-file-1")
    ]
    assert create_kwargs["source"] == AgentSource.WORKFLOW


def test_extract_package_dependencies_covers_model_tools_and_knowledge(
    monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    model_dependency = Mock(side_effect=lambda provider: f"model:{provider}")
    tool_dependency = Mock(side_effect=lambda provider: f"tool:{provider}")
    monkeypatch.setattr(
        "services.agent.dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        model_dependency,
    )
    monkeypatch.setattr(
        "services.agent.dsl_service.DependenciesAnalysisService.analyze_tool_dependency",
        tool_dependency,
    )
    soul = AgentSoulConfig.model_validate(
        {
            "model": {"plugin_id": "model-plugin", "model_provider": "provider/model", "model": "model"},
            "tools": {
                "dify_tools": [
                    {
                        "provider_id": "provider/tool",
                        "provider_type": "plugin",
                        "credential_type": "unauthorized",
                    },
                    {
                        "plugin_id": "plugin-id",
                        "provider": "fallback-provider",
                        "provider_type": "plugin",
                        "credential_type": "unauthorized",
                    },
                ]
            },
            "knowledge": {
                "sets": [
                    {
                        "id": "set-1",
                        "name": "Set",
                        "datasets": [{"id": "dataset-1", "name": "Docs"}],
                        "query": {"mode": "user_query", "value": "query"},
                        "retrieval": {
                            "mode": "single",
                            "model": {"provider": "provider/retrieval", "name": "embed", "mode": "embedding"},
                            "reranking_model": {"provider": "provider/rerank", "model": "rerank"},
                        },
                    }
                ]
            },
        }
    )

    dependencies = AgentDslService(unbound_session).extract_package_dependencies(
        {"agent_1": make_portable_agent_package(_agent(), soul)}
    )

    assert dependencies == [
        "model:provider/model",
        "tool:provider/tool",
        "tool:plugin-id/fallback-provider",
        "model:provider/retrieval",
        "model:provider/rerank",
    ]


def test_create_imported_inline_agent_uses_import_provenance(unbound_session: Session) -> None:
    service = AgentDslService(unbound_session)
    soul = AgentSoulConfig(config_note="inline")
    warning = DslImportWarning(code="setup", path="agent", message="setup")
    service._resolve_package_soul = Mock(return_value=(soul, [warning]))
    service._create_workflow_only_agent = Mock(return_value=(_agent(), _snapshot(soul=soul)))
    workflow = _workflow()

    result = service._create_imported_inline_agent(
        workflow=workflow,
        node_id="node-1",
        account=_account(),
        package=make_portable_agent_package(_agent(), soul),
        package_path="agent_packages.agent_1",
    )

    assert result.warnings == [warning]
    assert service._create_workflow_only_agent.call_args.kwargs["source"] == AgentSource.IMPORTED
    assert (
        service._create_workflow_only_agent.call_args.kwargs["operation"] == AgentConfigRevisionOperation.IMPORT_PACKAGE
    )


def test_create_workflow_only_agent_sets_backing_app_and_snapshot(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    service = AgentDslService(sqlite_session)
    roster_service = Mock()
    backing_app = _app()
    backing_app.id = "backing-app"
    roster_service.create_hidden_backing_app_for_workflow_agent.return_value = backing_app
    monkeypatch.setattr("services.agent.dsl_service.AgentRosterService", Mock(return_value=roster_service))
    monkeypatch.setattr("services.agent.dsl_service.agent_soul_has_model", Mock(return_value=True))
    workflow = _workflow()

    agent, snapshot = service._create_workflow_only_agent(
        workflow=workflow,
        node_id="node-1",
        account_id="account-1",
        metadata=AgentPackageMetadata(name="Inline", icon_type=AgentIconType.EMOJI.value),
        soul=AgentSoulConfig(),
        source=AgentSource.IMPORTED,
        operation=AgentConfigRevisionOperation.IMPORT_PACKAGE,
    )

    assert sqlite_session.get(Agent, agent.id) is agent
    assert sqlite_session.get(AgentConfigSnapshot, snapshot.id) is snapshot
    assert agent.scope == AgentScope.WORKFLOW_ONLY
    assert agent.backing_app_id == "backing-app"
    assert agent.active_config_snapshot_id == snapshot.id
    assert agent.active_config_has_model is True
    assert agent.active_config_is_published is True
    revision = sqlite_session.scalar(
        select(AgentConfigRevision).where(AgentConfigRevision.current_snapshot_id == snapshot.id)
    )
    assert revision is not None
    assert revision.operation == AgentConfigRevisionOperation.IMPORT_PACKAGE


def test_resolve_package_soul_preserves_existing_and_marks_missing_knowledge(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    soul = AgentSoulConfig.model_validate(
        {
            "config_skills": [{"name": "skill", "file_kind": "tool_file", "file_id": "skill-file"}],
            "config_files": [{"name": "Guide", "file_kind": "upload_file", "file_id": "guide-file"}],
            "knowledge": {
                "sets": [
                    {
                        "id": "set-1",
                        "name": "Set",
                        "datasets": [
                            {"id": "existing", "name": "Existing"},
                            {"id": "missing", "name": "Missing"},
                        ],
                        "query": {"mode": "user_query", "value": "query"},
                        "retrieval": {"mode": "multiple", "top_k": 3},
                    }
                ]
            },
        }
    )
    existing_dataset = Dataset(
        id="existing",
        tenant_id="tenant-1",
        name="Existing",
        created_by="account-1",
    )
    get_dataset_rows = Mock(return_value={"existing": existing_dataset})
    monkeypatch.setattr("services.agent.dsl_service.get_tenant_knowledge_dataset_rows", get_dataset_rows)

    resolved, warnings = AgentDslService(sqlite_session)._resolve_package_soul(
        tenant_id="tenant-1",
        package=make_portable_agent_package(_agent(), soul),
        package_path="agent_packages.agent_1",
    )

    get_dataset_rows.assert_called_once_with(
        session=sqlite_session,
        tenant_id="tenant-1",
        dataset_ids=["existing", "missing"],
    )
    datasets = resolved.knowledge.sets[0].datasets
    assert datasets[0].id == "existing"
    assert datasets[1].id is not None
    assert datasets[1].id.startswith("missing-dataset-")
    assert resolved.config_skills[0].model_dump(mode="json") == {
        "name": "skill",
        "description": "",
        "file_kind": "tool_file",
        "file_id": "",
        "is_missing": True,
        "size": None,
        "hash": None,
        "mime_type": "application/zip",
    }
    assert resolved.config_files[0].model_dump(mode="json") == {
        "name": "Guide",
        "file_kind": "upload_file",
        "file_id": "",
        "is_missing": True,
        "size": None,
        "hash": None,
        "mime_type": None,
    }
    assert {warning.code for warning in warnings} == {
        "agent_skill_omitted",
        "agent_file_omitted",
        "agent_knowledge_unresolved",
    }


def test_create_snapshot_increments_version_and_records_revision(sqlite_session: Session) -> None:
    agent = _agent()
    sqlite_session.add_all(
        [
            agent,
            _snapshot(snapshot_id="snapshot-1", version=1),
            _snapshot(snapshot_id="snapshot-2", version=2),
        ]
    )
    sqlite_session.commit()
    service = AgentDslService(sqlite_session)

    snapshot = service._create_snapshot(
        tenant_id="tenant-1",
        agent=agent,
        account_id="account-1",
        soul=AgentSoulConfig(config_note="version 3"),
        operation=AgentConfigRevisionOperation.IMPORT_PACKAGE,
    )

    assert snapshot.version == 3
    assert snapshot.home_snapshot_id is None
    assert sqlite_session.get(AgentConfigSnapshot, snapshot.id) is snapshot
    revision = sqlite_session.scalar(
        select(AgentConfigRevision).where(AgentConfigRevision.current_snapshot_id == snapshot.id)
    )
    assert revision is not None
    assert revision.operation == AgentConfigRevisionOperation.IMPORT_PACKAGE


def test_unique_roster_name_uses_first_available_suffix(sqlite_session: Session) -> None:
    sqlite_session.add_all(
        [
            _agent(agent_id="agent-1", name="Agent"),
            _agent(agent_id="agent-2", name="Agent import"),
            _agent(agent_id="decoy-agent", name="Agent import 2", scope=AgentScope.WORKFLOW_ONLY),
        ]
    )
    sqlite_session.commit()

    result = AgentDslService(sqlite_session)._unique_roster_name(tenant_id="tenant-1", requested="Agent")

    assert result == "Agent import 2"


def test_require_helpers_and_graph_detection(sqlite_session: Session) -> None:
    agent = _agent()
    snapshot = _snapshot()
    sqlite_session.add_all([agent, snapshot])
    sqlite_session.commit()
    service = AgentDslService(sqlite_session)

    assert service._require_agent(tenant_id="tenant-1", agent_id="agent-1") is agent
    with pytest.raises(ValueError, match="source Agent"):
        service._require_agent(tenant_id="tenant-1", agent_id="missing")
    with pytest.raises(ValueError, match="source snapshot"):
        service._require_snapshot(tenant_id="tenant-1", agent_id="agent-1", snapshot_id=None)
    assert service._require_snapshot(tenant_id="tenant-1", agent_id="agent-1", snapshot_id="snapshot-1") is snapshot
    with pytest.raises(ValueError, match="source snapshot"):
        service._require_snapshot(tenant_id="tenant-1", agent_id="agent-1", snapshot_id="missing")

    assert AgentDslService._agent_icon_type(AgentIconType.EMOJI.value) == AgentIconType.EMOJI
    assert AgentDslService._agent_icon_type(None) is None
    assert is_agent_v2_graph({"nodes": [_agent_node("agent")]}) is True
    assert is_agent_v2_graph({"nodes": [{"id": "legacy-agent", "data": {"type": "agent", "version": "2"}}]}) is False
    assert is_agent_v2_graph({"nodes": ["invalid", {"data": {"type": "start"}}]}) is False


def test_export_workflow_packages_ignores_historical_agent_version_two() -> None:
    session = Mock()
    service = AgentDslService(session)
    graph = {"nodes": [{"id": "legacy-agent", "data": {"type": "agent", "version": "2"}}]}

    portable_graph, packages = service.export_workflow_packages(workflow=Mock(), graph=graph)

    assert portable_graph == graph
    assert packages == {}
    session.scalars.assert_not_called()
