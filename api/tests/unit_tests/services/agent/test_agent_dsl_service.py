import json
from types import SimpleNamespace
from unittest.mock import Mock, call

import pytest
from pydantic import ValidationError

from graphon.enums import BuiltinNodeTypes
from models.agent import (
    Agent,
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
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.model import App, IconType
from services.agent.dsl_entities import (
    AGENT_NODE_JOB_DSL_KEY,
    AGENT_PACKAGE_REF_KEY,
    AgentPackage,
    AgentPackageMetadata,
    make_portable_agent_package,
)
from services.agent.dsl_service import AgentDslService, is_agent_v2_graph
from services.entities.dsl_entities import DslImportWarning


def _agent() -> Agent:
    agent = Agent(
        tenant_id="tenant-1",
        name="Portable Agent",
        description="description",
        role="researcher",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        icon_type=AgentIconType.EMOJI,
        icon="R",
    )
    agent.id = "agent-1"
    return agent


def _snapshot(*, snapshot_id: str = "snapshot-1", soul: AgentSoulConfig | None = None) -> AgentConfigSnapshot:
    snapshot = AgentConfigSnapshot(
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=soul or AgentSoulConfig(),
        created_by="account-1",
    )
    snapshot.id = snapshot_id
    return snapshot


def _agent_node(node_id: str, binding: object | None = None) -> dict:
    data = {"type": BuiltinNodeTypes.AGENT, "version": "2"}
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
    assert package.soul.config_skills == []
    assert package.soul.config_files == []
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


def test_import_warnings_cover_runtime_setup_removed_from_package(monkeypatch) -> None:
    soul = AgentSoulConfig.model_validate(
        {
            "tools": {
                "dify_tools": [
                    {
                        "provider_id": "langgenius/google/google",
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

    _, warnings = AgentDslService(Mock())._resolve_package_soul(
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


def test_export_agent_app_requires_backing_agent() -> None:
    session = Mock()
    session.scalar.return_value = None

    with pytest.raises(ValueError, match="no active backing Agent"):
        AgentDslService(session).export_agent_app(app=SimpleNamespace(tenant_id="tenant-1", id="app-1"))


@pytest.mark.parametrize("use_draft", [True, False])
def test_export_agent_app_uses_draft_or_active_snapshot(use_draft: bool) -> None:
    agent = _agent()
    agent.active_config_snapshot_id = "snapshot-1"
    draft = SimpleNamespace(config_snapshot_dict=AgentSoulConfig(config_note="draft").model_dump(mode="json"))
    session = Mock()
    session.scalar.side_effect = [agent, draft if use_draft else None]
    service = AgentDslService(session)
    require_snapshot = Mock(return_value=_snapshot(soul=AgentSoulConfig(config_note="snapshot")))
    service._require_snapshot = require_snapshot

    package_ref, packages = service.export_agent_app(app=SimpleNamespace(tenant_id="tenant-1", id="app-1"))

    assert package_ref == "agent_1"
    assert packages[package_ref].soul.config_note == ("draft" if use_draft else "snapshot")
    assert require_snapshot.call_count == (0 if use_draft else 1)


def test_export_workflow_packages_deduplicates_shared_agent() -> None:
    graph = {"nodes": [_agent_node("node-1"), _agent_node("node-2")], "edges": []}
    bindings = [
        SimpleNamespace(
            node_id=node_id,
            agent_id="agent-1",
            current_snapshot_id="snapshot-1",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            node_job_config_dict={"workflow_prompt": node_id},
        )
        for node_id in ("node-1", "node-2")
    ]
    session = Mock()
    session.scalars.return_value.all.return_value = bindings
    service = AgentDslService(session)
    service._require_agent = Mock(return_value=_agent())
    service._require_snapshot = Mock(return_value=_snapshot())

    portable_graph, packages = service.export_workflow_packages(
        workflow=SimpleNamespace(tenant_id="tenant-1", id="workflow-1", version="draft"),
        graph=graph,
    )

    assert list(packages) == ["agent_1"]
    for node in portable_graph["nodes"]:
        assert node["data"]["agent_binding"] == {
            "binding_type": WorkflowAgentBindingType.ROSTER_AGENT.value,
            AGENT_PACKAGE_REF_KEY: "agent_1",
        }
        assert node["data"][AGENT_NODE_JOB_DSL_KEY]["workflow_prompt"] == node["id"]
    assert service._require_agent.call_count == 2


def test_export_workflow_packages_rejects_incomplete_binding() -> None:
    session = Mock()
    session.scalars.return_value.all.return_value = []

    with pytest.raises(ValueError, match="no complete persisted binding"):
        AgentDslService(session).export_workflow_packages(
            workflow=SimpleNamespace(tenant_id="tenant-1", id="workflow-1", version="draft"),
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


def test_import_agent_app_package_creates_config_and_unpublished_draft(monkeypatch) -> None:
    session = Mock()
    service = AgentDslService(session)
    soul = AgentSoulConfig(config_note="portable")
    warning = DslImportWarning(code="setup", path="agent.soul", message="setup required")
    service._resolve_package_soul = Mock(return_value=(soul, [warning]))
    service._unique_roster_name = Mock(return_value="Portable Agent import")
    agent = _agent()
    agent.active_config_snapshot_id = "snapshot-1"
    agent.active_config_is_published = True
    roster_service = Mock()
    roster_service.create_backing_agent_for_app.return_value = agent
    monkeypatch.setattr("services.agent.dsl_service.AgentRosterService", Mock(return_value=roster_service))
    service._require_snapshot = Mock(return_value=_snapshot(soul=soul))
    app = SimpleNamespace(
        tenant_id="tenant-1",
        id="app-1",
        name="",
        description="",
        app_model_config=None,
        app_model_config_id=None,
    )

    result = service.import_agent_app_package(
        app=app,
        account=SimpleNamespace(id="account-1"),
        package=make_portable_agent_package(_agent(), soul),
    )

    assert result.warnings == [warning]
    assert agent.active_config_is_published is False
    assert app.name == "Portable Agent"
    assert app.description == "description"
    assert session.add.call_count == 2
    assert session.flush.call_count == 2


def test_import_workflow_packages_replaces_bindings_and_reuses_roster_package() -> None:
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
    old_binding = SimpleNamespace(id="old-binding")
    session = Mock()
    session.scalars.return_value.all.return_value = [old_binding]
    service = AgentDslService(session)
    roster_result = SimpleNamespace(
        agent=SimpleNamespace(id="roster-agent"),
        snapshot=SimpleNamespace(id="roster-snapshot"),
        warnings=[DslImportWarning(code="roster", path="agent", message="roster warning")],
    )
    inline_result = SimpleNamespace(
        agent=SimpleNamespace(id="inline-agent"),
        snapshot=SimpleNamespace(id="inline-snapshot"),
        warnings=[DslImportWarning(code="inline", path="agent", message="inline warning")],
    )
    service._create_imported_roster_agent_app = Mock(return_value=roster_result)
    service._create_imported_inline_agent = Mock(return_value=inline_result)
    workflow = SimpleNamespace(
        tenant_id="tenant-1",
        app_id="app-1",
        id="workflow-1",
        version="draft",
        graph="{}",
    )

    result, warnings = service.import_workflow_packages(
        workflow=workflow,
        portable_graph=graph,
        raw_packages={"agent_1": package.model_dump(mode="json")},
        account=SimpleNamespace(id="account-1"),
    )

    session.delete.assert_called_once_with(old_binding)
    service._create_imported_roster_agent_app.assert_called_once()
    service._create_imported_inline_agent.assert_called_once()
    assert [warning.code for warning in warnings] == ["roster", "roster", "inline"]
    assert result["nodes"][0]["data"]["agent_binding"]["agent_id"] == "roster-agent"
    assert result["nodes"][2]["data"]["agent_binding"]["agent_id"] == "inline-agent"
    assert AGENT_NODE_JOB_DSL_KEY not in result["nodes"][0]["data"]
    assert json.loads(workflow.graph) == result
    added_bindings = [item.args[0] for item in session.add.call_args_list]
    assert all(isinstance(binding, WorkflowAgentNodeBinding) for binding in added_bindings)


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
def test_import_workflow_packages_rejects_invalid_package_binding(binding: dict, error: str) -> None:
    session = Mock()
    session.scalars.return_value.all.return_value = []
    package = make_portable_agent_package(_agent(), AgentSoulConfig())

    with pytest.raises(ValueError, match=error):
        AgentDslService(session).import_workflow_packages(
            workflow=SimpleNamespace(tenant_id="tenant-1", app_id="app-1", id="workflow-1", version="draft"),
            portable_graph={"nodes": [_agent_node("node-1", binding)], "edges": []},
            raw_packages={"agent_1": package.model_dump(mode="json")},
            account=SimpleNamespace(id="account-1"),
        )


def test_clone_inline_binding_copies_soul_and_drive_rows(monkeypatch) -> None:
    session = Mock()
    service = AgentDslService(session)
    target_agent = SimpleNamespace(id="target-agent")
    target_snapshot = SimpleNamespace(id="target-snapshot")
    service._create_workflow_only_agent = Mock(return_value=(target_agent, target_snapshot))
    copy_rows = Mock()
    monkeypatch.setattr("services.agent.composer_service.AgentComposerService._copy_agent_drive_rows", copy_rows)
    source_agent = _agent()
    source_snapshot = SimpleNamespace(
        config_snapshot_dict=AgentSoulConfig(config_note="source").model_dump(mode="json")
    )
    workflow = SimpleNamespace(tenant_id="tenant-1", app_id="app-1", id="workflow-1")
    node_job = WorkflowNodeJobConfig(workflow_prompt="work")

    result = service.clone_inline_binding_for_node(
        workflow=workflow,
        node_id="target-node",
        source_agent=source_agent,
        source_snapshot=source_snapshot,
        node_job=node_job,
        account_id="account-1",
    )

    assert result == (target_agent, target_snapshot)
    create_kwargs = service._create_workflow_only_agent.call_args.kwargs
    assert create_kwargs["metadata"].name == source_agent.name
    assert create_kwargs["soul"].config_note == "source"
    assert create_kwargs["source"] == AgentSource.WORKFLOW
    copy_rows.assert_called_once_with(
        tenant_id="tenant-1",
        source_agent_id="agent-1",
        target_agent_id="target-agent",
        account_id="account-1",
        agent_soul=create_kwargs["soul"],
        node_job=node_job,
        session=session,
    )


def test_extract_package_dependencies_covers_model_tools_and_knowledge(monkeypatch) -> None:
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
                    {"provider_id": "provider/tool", "credential_type": "unauthorized"},
                    {
                        "plugin_id": "plugin-id",
                        "provider": "fallback-provider",
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

    dependencies = AgentDslService(Mock()).extract_package_dependencies(
        {"agent_1": make_portable_agent_package(_agent(), soul)}
    )

    assert dependencies == [
        "model:provider/model",
        "tool:provider/tool",
        "tool:plugin-id/fallback-provider",
        "model:provider/retrieval",
        "model:provider/rerank",
    ]


def test_create_imported_roster_agent_app_prefixes_warnings(monkeypatch) -> None:
    session = Mock()
    service = AgentDslService(session)
    service._configure_visible_agent_app_after_commit = Mock()
    result = SimpleNamespace(
        agent=_agent(),
        snapshot=_snapshot(),
        warnings=[DslImportWarning(code="setup", path="soul.model", message="setup")],
    )
    service.import_agent_app_package = Mock(return_value=result)
    send = Mock()
    monkeypatch.setattr("services.agent.dsl_service.app_was_created.send", send)

    imported = service._create_imported_roster_agent_app(
        tenant_id="tenant-1",
        account=SimpleNamespace(id="account-1"),
        package=make_portable_agent_package(_agent(), AgentSoulConfig()),
        package_path="agent_packages.agent_1",
    )

    app = session.add.call_args.args[0]
    assert isinstance(app, App)
    assert app.name == "Portable Agent"
    assert app.enable_site is True
    assert app.enable_api is True
    send.assert_called_once_with(app, account=SimpleNamespace(id="account-1"))
    assert imported.warnings[0].path == "agent_packages.agent_1.soul.model"


def test_create_imported_inline_agent_uses_import_provenance() -> None:
    service = AgentDslService(Mock())
    soul = AgentSoulConfig(config_note="inline")
    warning = DslImportWarning(code="setup", path="agent", message="setup")
    service._resolve_package_soul = Mock(return_value=(soul, [warning]))
    service._create_workflow_only_agent = Mock(return_value=(_agent(), _snapshot(soul=soul)))
    workflow = SimpleNamespace(tenant_id="tenant-1", id="workflow-1")

    result = service._create_imported_inline_agent(
        workflow=workflow,
        node_id="node-1",
        account=SimpleNamespace(id="account-1"),
        package=make_portable_agent_package(_agent(), soul),
        package_path="agent_packages.agent_1",
    )

    assert result.warnings == [warning]
    assert service._create_workflow_only_agent.call_args.kwargs["source"] == AgentSource.IMPORTED
    assert (
        service._create_workflow_only_agent.call_args.kwargs["operation"] == AgentConfigRevisionOperation.IMPORT_PACKAGE
    )


def test_create_workflow_only_agent_sets_backing_app_and_snapshot(monkeypatch) -> None:
    session = Mock()
    service = AgentDslService(session)
    roster_service = Mock()
    roster_service.create_hidden_backing_app_for_workflow_agent.return_value = SimpleNamespace(id="backing-app")
    monkeypatch.setattr("services.agent.dsl_service.AgentRosterService", Mock(return_value=roster_service))
    service._create_snapshot = Mock(return_value=SimpleNamespace(id="snapshot-1"))
    monkeypatch.setattr("services.agent.dsl_service.agent_soul_has_model", Mock(return_value=True))
    workflow = SimpleNamespace(tenant_id="tenant-1", app_id="app-1", id="workflow-1")

    agent, snapshot = service._create_workflow_only_agent(
        workflow=workflow,
        node_id="node-1",
        account_id="account-1",
        metadata=AgentPackageMetadata(name="Inline", icon_type=AgentIconType.EMOJI.value),
        soul=AgentSoulConfig(),
        source=AgentSource.IMPORTED,
        operation=AgentConfigRevisionOperation.IMPORT_PACKAGE,
    )

    assert snapshot.id == "snapshot-1"
    assert agent.scope == AgentScope.WORKFLOW_ONLY
    assert agent.backing_app_id == "backing-app"
    assert agent.active_config_snapshot_id == "snapshot-1"
    assert agent.active_config_has_model is True
    assert agent.active_config_is_published is True
    session.add.assert_called_once_with(agent)
    assert session.flush.call_count == 2


def test_resolve_package_soul_preserves_existing_and_marks_missing_knowledge(monkeypatch) -> None:
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
    monkeypatch.setattr(
        "services.agent.dsl_service.get_tenant_knowledge_dataset_rows",
        Mock(return_value={"existing": SimpleNamespace(id="existing")}),
    )

    resolved, warnings = AgentDslService(Mock())._resolve_package_soul(
        tenant_id="tenant-1",
        package=make_portable_agent_package(_agent(), soul),
        package_path="agent_packages.agent_1",
    )

    datasets = resolved.knowledge.sets[0].datasets
    assert datasets[0].id == "existing"
    assert datasets[1].id is not None
    assert datasets[1].id.startswith("missing-dataset-")
    assert {warning.code for warning in warnings} == {
        "agent_skill_omitted",
        "agent_file_omitted",
        "agent_knowledge_unresolved",
    }


def test_create_snapshot_increments_version_and_records_revision() -> None:
    session = Mock()
    session.scalar.return_value = 2
    service = AgentDslService(session)

    snapshot = service._create_snapshot(
        tenant_id="tenant-1",
        agent=_agent(),
        account_id="account-1",
        soul=AgentSoulConfig(config_note="version 3"),
        operation=AgentConfigRevisionOperation.IMPORT_PACKAGE,
    )

    assert snapshot.version == 3
    assert isinstance(session.add.call_args_list[0].args[0], AgentConfigSnapshot)
    revision = session.add.call_args_list[1].args[0]
    assert isinstance(revision, AgentConfigRevision)
    assert revision.operation == AgentConfigRevisionOperation.IMPORT_PACKAGE
    assert session.flush.call_count == 2


def test_unique_roster_name_uses_first_available_suffix() -> None:
    session = Mock()
    session.scalars.return_value.all.return_value = ["Agent", "Agent import"]

    result = AgentDslService(session)._unique_roster_name(tenant_id="tenant-1", requested="Agent")

    assert result == "Agent import 2"


def test_configure_visible_agent_app_runs_after_commit(monkeypatch) -> None:
    session = Mock()
    listener = Mock()
    monkeypatch.setattr("services.agent.dsl_service.event.listen", listener)
    service = AgentDslService(session)

    service._configure_visible_agent_app_after_commit(
        tenant_id="tenant-1",
        app_id="app-1",
        account_id="account-1",
    )

    listener.assert_called_once_with(session, "after_commit", listener.call_args.args[2], once=True)
    configure = listener.call_args.args[2]
    from services.enterprise import rbac_service
    from services.enterprise.enterprise_service import EnterpriseService
    from services.feature_service import FeatureService

    sync = Mock()
    update_access = Mock()
    monkeypatch.setattr(rbac_service, "try_sync_creator_access_policy_member_bindings", sync)
    monkeypatch.setattr(EnterpriseService.WebAppAuth, "update_app_access_mode", update_access)
    monkeypatch.setattr(
        FeatureService,
        "get_system_features",
        Mock(return_value=SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))),
    )
    configure(session)
    update_access.assert_not_called()

    FeatureService.get_system_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=True))
    configure(session)
    update_access.assert_called_once_with("app-1", "private")
    assert sync.call_args_list == [
        call("tenant-1", "account-1", rbac_service.RBACResourceType.APP, "app-1"),
        call("tenant-1", "account-1", rbac_service.RBACResourceType.APP, "app-1"),
    ]

    monkeypatch.setattr(rbac_service, "try_sync_creator_access_policy_member_bindings", Mock(side_effect=RuntimeError))
    logger = Mock()
    monkeypatch.setattr("services.agent.dsl_service.logger", logger)
    configure(session)
    logger.exception.assert_called_once()


def test_require_helpers_and_graph_detection() -> None:
    session = Mock()
    service = AgentDslService(session)
    agent = _agent()
    snapshot = _snapshot()
    session.scalar.side_effect = [agent, None, snapshot, None]

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
    assert AgentDslService._app_icon_type(IconType.IMAGE.value) == IconType.IMAGE
    assert AgentDslService._app_icon_type(None) == IconType.EMOJI
    assert is_agent_v2_graph({"nodes": [_agent_node("agent")]}) is True
    assert is_agent_v2_graph({"nodes": ["invalid", {"data": {"type": "start"}}]}) is False
