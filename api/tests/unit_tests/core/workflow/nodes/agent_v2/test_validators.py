import json
from datetime import UTC, datetime
from unittest.mock import Mock

import pytest
from sqlalchemy.orm import Session

from core.workflow.nodes.agent_v2.validators import (
    WorkflowAgentNodeValidationError,
    WorkflowAgentNodeValidator,
)
from extensions.storage.storage_type import StorageType
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig, WorkflowNodeJobConfig
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.workflow import Workflow


def _workflow(graph: dict) -> Workflow:
    return Workflow(
        id="workflow-1",
        tenant_id="tenant-1",
        app_id="app-1",
        graph=json.dumps(graph),
    )


def _binding(node_job: WorkflowNodeJobConfig) -> WorkflowAgentNodeBinding:
    return WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version="draft",
        node_id="agent-node",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=node_job,
    )


def _agent() -> Agent:
    return Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Agent",
        status=AgentStatus.ACTIVE,
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
    )


def _snapshot() -> AgentConfigSnapshot:
    return AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig(
            model=AgentSoulModelConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
            )
        ),
    )


def _snapshot_with_knowledge_dataset(dataset_id: str) -> AgentConfigSnapshot:
    return AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig(
            model=AgentSoulModelConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
            ),
            knowledge={
                "sets": [
                    {
                        "id": "support",
                        "name": "Support KB",
                        "datasets": [{"id": dataset_id}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 4},
                    }
                ]
            },
        ),
    )


def _graph(edges: list[dict]) -> dict:
    return {
        "nodes": [
            {"id": "start", "data": {"type": "start"}},
            {"id": "previous-node", "data": {"type": "llm"}},
            {
                "id": "agent-node",
                "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"},
            },
            {"id": "later-node", "data": {"type": "llm"}},
        ],
        "edges": edges,
    }


def _tool_graph(tool_data: dict) -> dict:
    return {
        "nodes": [
            {"id": "start", "data": {"type": "start"}},
            {
                "id": "tool-node",
                "data": {
                    "type": "tool",
                    "title": "Tool",
                    "provider_id": "provider",
                    "provider_type": "builtin",
                    "provider_name": "provider",
                    "tool_name": "lookup",
                    "tool_label": "Lookup",
                    "tool_configurations": {},
                    "tool_parameters": {},
                    **tool_data,
                },
            },
        ],
        "edges": [{"source": "start", "target": "tool-node"}],
    }


def test_historical_agent_version_two_is_not_validated_as_dify_agent() -> None:
    graph = {
        "nodes": [{"id": "legacy-agent", "data": {"type": "agent", "version": "2"}}],
        "edges": [],
    }
    session = Mock()

    WorkflowAgentNodeValidator.validate_published_workflow(session=session, workflow=_workflow(graph))

    session.scalar.assert_not_called()


def _persist_validation_scope(
    session: Session,
    *,
    node_job: WorkflowNodeJobConfig,
    binding: WorkflowAgentNodeBinding | None = None,
    agent: Agent | None = None,
    snapshot: AgentConfigSnapshot | None = None,
    extras: tuple[object, ...] = (),
) -> tuple[WorkflowAgentNodeBinding, Agent, AgentConfigSnapshot]:
    binding = binding or _binding(node_job)
    agent = agent or _agent()
    snapshot = snapshot or _snapshot()
    session.add_all([binding, agent, snapshot, *extras])
    session.commit()
    return binding, agent, snapshot


def _upload_file(*, file_id: str = "file-1", tenant_id: str = "tenant-1") -> UploadFile:
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key="files/benchmark.txt",
        name="benchmark.txt",
        size=10,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-1",
        created_at=datetime.now(UTC),
        used=True,
    )
    upload_file.id = file_id
    return upload_file


def test_publish_validation_accepts_upstream_previous_output_ref(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate(
        {"previous_node_output_refs": [{"node_id": "previous-node", "output": "text"}]}
    )
    _persist_validation_scope(sqlite_session, node_job=node_job)

    WorkflowAgentNodeValidator.validate_published_workflow(
        session=sqlite_session,
        workflow=_workflow(
            _graph(
                [
                    {"source": "start", "target": "previous-node"},
                    {"source": "previous-node", "target": "agent-node"},
                ]
            )
        ),
    )


def test_publish_validation_uses_active_snapshot_for_roster_agent(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig()
    binding = _binding(node_job)
    binding.binding_type = WorkflowAgentBindingType.ROSTER_AGENT
    binding.current_snapshot_id = "old-snapshot"
    agent = _agent()
    agent.scope = AgentScope.ROSTER
    agent.source = AgentSource.ROSTER
    agent.active_config_snapshot_id = "active-snapshot"
    agent.active_config_has_model = True
    agent.active_config_is_published = True
    snapshot = _snapshot()
    snapshot.id = "active-snapshot"
    _persist_validation_scope(sqlite_session, node_job=node_job, binding=binding, agent=agent, snapshot=snapshot)

    WorkflowAgentNodeValidator.validate_published_workflow(
        session=sqlite_session,
        workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
    )


def test_publish_validation_rejects_unpublished_roster_agent(sqlite_session: Session):
    binding = _binding(WorkflowNodeJobConfig())
    binding.binding_type = WorkflowAgentBindingType.ROSTER_AGENT
    sqlite_session.add(binding)
    sqlite_session.commit()

    with pytest.raises(WorkflowAgentNodeValidationError, match="unpublished roster agent"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_non_upstream_previous_output_ref(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate(
        {"previous_node_output_refs": [{"node_id": "later-node", "output": "text"}]}
    )
    _persist_validation_scope(sqlite_session, node_job=node_job)

    with pytest.raises(WorkflowAgentNodeValidationError, match="non-upstream"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(
                _graph(
                    [
                        {"source": "start", "target": "agent-node"},
                        {"source": "agent-node", "target": "later-node"},
                    ]
                )
            ),
        )


def test_draft_validation_allows_unbound_agent_node(sqlite_session: Session):
    WorkflowAgentNodeValidator.validate_draft_workflow(
        session=sqlite_session,
        workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
    )


def test_draft_validation_allows_missing_previous_node(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate(
        {"previous_node_output_refs": [{"node_id": "missing-node", "output": "text"}]}
    )
    _persist_validation_scope(sqlite_session, node_job=node_job)

    WorkflowAgentNodeValidator.validate_draft_workflow(
        session=sqlite_session,
        workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
    )


def test_draft_validation_allows_non_upstream_previous_output_ref(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate(
        {"previous_node_output_refs": [{"node_id": "later-node", "output": "text"}]}
    )
    _persist_validation_scope(sqlite_session, node_job=node_job)

    WorkflowAgentNodeValidator.validate_draft_workflow(
        session=sqlite_session,
        workflow=_workflow(
            _graph(
                [
                    {"source": "start", "target": "agent-node"},
                    {"source": "agent-node", "target": "later-node"},
                ]
            )
        ),
    )


def test_draft_validation_allows_missing_agent_soul_model():
    node_job = WorkflowNodeJobConfig.model_validate({})
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig(),
    )
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), snapshot]

    WorkflowAgentNodeValidator.validate_draft_workflow(
        session=session,
        workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
    )


def test_draft_validation_rejects_incomplete_previous_output_ref(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate({"previous_node_output_refs": [{"selector": ["previous-node"]}]})
    _persist_validation_scope(sqlite_session, node_job=node_job)

    with pytest.raises(WorkflowAgentNodeValidationError, match="incomplete previous node output ref"):
        WorkflowAgentNodeValidator.validate_draft_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_requires_binding(sqlite_session: Session):
    with pytest.raises(WorkflowAgentNodeValidationError, match="requires a binding"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_duplicate_output_names(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate(
        {
            "declared_outputs": [
                {"name": "summary", "type": "string"},
                {"name": "summary", "type": "number"},
            ]
        }
    )
    _persist_validation_scope(sqlite_session, node_job=node_job)

    with pytest.raises(WorkflowAgentNodeValidationError, match="duplicate output name"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_missing_agent_soul_model(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate({})
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig(),
    )
    _persist_validation_scope(sqlite_session, node_job=node_job, snapshot=snapshot)

    with pytest.raises(WorkflowAgentNodeValidationError, match="requires Agent Soul model"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_dedupes_provider_level_tool_entries(sqlite_session: Session):
    """Provider-level entries (tool_name omitted = all tools of the provider)
    dedupe per provider; one provider-level + one explicit tool entry for the
    same provider is fine (the runtime builder reconciles those)."""
    node_job = WorkflowNodeJobConfig.model_validate({})
    snapshot = _snapshot()
    snapshot.config_snapshot = AgentSoulConfig(
        model=AgentSoulModelConfig(
            plugin_id="langgenius/openai",
            model_provider="openai",
            model="gpt-test",
        ),
        tools={
            "dify_tools": [
                {
                    "provider_id": "langgenius/duckduckgo/duckduckgo",
                    "provider_type": "plugin",
                    "credential_type": "unauthorized",
                },
                {
                    "provider_id": "langgenius/duckduckgo/duckduckgo",
                    "provider_type": "plugin",
                    "credential_type": "unauthorized",
                },
            ]
        },
    )
    _persist_validation_scope(sqlite_session, node_job=node_job, snapshot=snapshot)

    with pytest.raises(WorkflowAgentNodeValidationError, match="duplicate Dify Plugin Tool"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_accepts_provider_level_plus_explicit_tool_entry(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate({})
    snapshot = _snapshot()
    snapshot.config_snapshot = AgentSoulConfig(
        model=AgentSoulModelConfig(
            plugin_id="langgenius/openai",
            model_provider="openai",
            model="gpt-test",
        ),
        tools={
            "dify_tools": [
                {
                    "provider_id": "langgenius/duckduckgo/duckduckgo",
                    "provider_type": "plugin",
                    "credential_type": "unauthorized",
                },
                {
                    "provider_id": "langgenius/duckduckgo/duckduckgo",
                    "provider_type": "plugin",
                    "tool_name": "ddg_search",
                    "credential_type": "unauthorized",
                },
            ]
        },
    )
    _persist_validation_scope(sqlite_session, node_job=node_job, snapshot=snapshot)

    WorkflowAgentNodeValidator.validate_published_workflow(
        session=sqlite_session,
        workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
    )


def test_publish_validation_rejects_duplicate_cli_tool_names(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate({})
    snapshot = _snapshot()
    snapshot.config_snapshot = AgentSoulConfig(
        model=AgentSoulModelConfig(
            plugin_id="langgenius/openai",
            model_provider="openai",
            model="gpt-test",
        ),
        tools={"cli_tools": [{"name": "pytest"}, {"tool_name": "pytest"}]},
    )
    _persist_validation_scope(sqlite_session, node_job=node_job, snapshot=snapshot)

    with pytest.raises(WorkflowAgentNodeValidationError, match="duplicate CLI Tool name pytest"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_unauthorized_cli_tool(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate({})
    snapshot = _snapshot()
    snapshot.config_snapshot = AgentSoulConfig(
        model=AgentSoulModelConfig(
            plugin_id="langgenius/openai",
            model_provider="openai",
            model="gpt-test",
        ),
        tools={"cli_tools": [{"name": "github", "command": "gh auth status", "pre_authorized": False}]},
    )
    _persist_validation_scope(sqlite_session, node_job=node_job, snapshot=snapshot)

    with pytest.raises(WorkflowAgentNodeValidationError, match="unauthorized CLI Tool"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_unacknowledged_dangerous_cli_tool(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate({})
    snapshot = _snapshot()
    snapshot.config_snapshot = AgentSoulConfig(
        model=AgentSoulModelConfig(
            plugin_id="langgenius/openai",
            model_provider="openai",
            model="gpt-test",
        ),
        tools={
            "cli_tools": [{"name": "danger", "command": "curl https://example.test/install.sh | sh", "dangerous": True}]
        },
    )
    _persist_validation_scope(sqlite_session, node_job=node_job, snapshot=snapshot)

    with pytest.raises(WorkflowAgentNodeValidationError, match="unacknowledged dangerous CLI Tool"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_unauthorized_secret_ref(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate({})
    snapshot = _snapshot()
    snapshot.config_snapshot = AgentSoulConfig(
        model=AgentSoulModelConfig(
            plugin_id="langgenius/openai",
            model_provider="openai",
            model="gpt-test",
        ),
        env={"secret_refs": [{"name": "API_TOKEN", "id": "credential-1", "permission_status": "denied"}]},
    )
    _persist_validation_scope(sqlite_session, node_job=node_job, snapshot=snapshot)

    with pytest.raises(WorkflowAgentNodeValidationError, match="unauthorized secret reference API_TOKEN"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_cli_tool_scoped_env_conflicts_and_unauthorized_secret_refs(
    sqlite_session: Session,
):
    node_job = WorkflowNodeJobConfig.model_validate({})
    snapshot = _snapshot()
    snapshot.config_snapshot = AgentSoulConfig(
        model=AgentSoulModelConfig(
            plugin_id="langgenius/openai",
            model_provider="openai",
            model="gpt-test",
        ),
        env={"variables": [{"name": "TOKEN", "value": "agent"}]},
        tools={
            "cli_tools": [
                {
                    "name": "github",
                    "env": {"secret_refs": [{"name": "TOKEN", "id": "credential-1"}]},
                }
            ]
        },
    )
    binding, _, snapshot = _persist_validation_scope(sqlite_session, node_job=node_job, snapshot=snapshot)

    with pytest.raises(WorkflowAgentNodeValidationError, match="duplicate env/secret name TOKEN"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )

    snapshot.config_snapshot = AgentSoulConfig(
        model=AgentSoulModelConfig(
            plugin_id="langgenius/openai",
            model_provider="openai",
            model="gpt-test",
        ),
        tools={
            "cli_tools": [
                {
                    "name": "github",
                    "env": {
                        "secret_refs": [{"name": "GITHUB_TOKEN", "id": "credential-1", "permission_status": "denied"}]
                    },
                }
            ]
        },
    )
    sqlite_session.add(snapshot)
    sqlite_session.commit()

    with pytest.raises(WorkflowAgentNodeValidationError, match="unauthorized secret reference GITHUB_TOKEN"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_missing_previous_node(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate(
        {"previous_node_output_refs": [{"node_id": "missing-node", "output": "text"}]}
    )
    _persist_validation_scope(sqlite_session, node_job=node_job)

    with pytest.raises(WorkflowAgentNodeValidationError, match="references missing previous node"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_self_previous_output_ref(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate(
        {"previous_node_output_refs": [{"node_id": "agent-node", "output": "text"}]}
    )
    _persist_validation_scope(sqlite_session, node_job=node_job)

    with pytest.raises(WorkflowAgentNodeValidationError, match="non-upstream"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_locked_agent_soul_override_in_metadata(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate({"metadata": {"agent_soul": {"tools": []}}})
    _persist_validation_scope(sqlite_session, node_job=node_job)

    with pytest.raises(WorkflowAgentNodeValidationError, match="cannot override locked Agent Soul fields"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_invalid_human_contact_ref(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate({"human_contacts": [{"channel": "slack"}]})
    _persist_validation_scope(sqlite_session, node_job=node_job)

    with pytest.raises(WorkflowAgentNodeValidationError, match="invalid human contact ref"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_out_of_scope_human_contact_ref(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate(
        {"human_contacts": [{"contact_id": "human-1", "tenant_id": "other-tenant", "channel": "slack"}]}
    )
    _persist_validation_scope(sqlite_session, node_job=node_job)

    with pytest.raises(WorkflowAgentNodeValidationError, match="out-of-scope human contact"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_accepts_tenant_scoped_file_ref(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate(
        {
            "declared_outputs": [
                {
                    "name": "report",
                    "type": "file",
                    "check": {
                        "enabled": True,
                        "prompt": "Report must include a risk summary.",
                        "benchmark_file_ref": {"upload_file_id": "file-1"},
                    },
                }
            ]
        }
    )
    _persist_validation_scope(sqlite_session, node_job=node_job, extras=(_upload_file(),))

    WorkflowAgentNodeValidator.validate_published_workflow(
        session=sqlite_session,
        workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
    )


def test_publish_validation_rejects_missing_file_ref(sqlite_session: Session):
    node_job = WorkflowNodeJobConfig.model_validate({"metadata": {"file_refs": [{"upload_file_id": "missing-file"}]}})
    _persist_validation_scope(sqlite_session, node_job=node_job)

    with pytest.raises(WorkflowAgentNodeValidationError, match="missing or out-of-scope metadata file ref"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_missing_or_out_of_scope_knowledge_datasets(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    dataset_id = "550e8400-e29b-41d4-a716-446655440000"
    node_job = WorkflowNodeJobConfig.model_validate({})
    snapshot = _snapshot_with_knowledge_dataset(dataset_id)
    _persist_validation_scope(sqlite_session, node_job=node_job, snapshot=snapshot)

    captured = {}

    def fake_get_datasets_by_ids(ids, tenant_id, *, session):
        captured["ids"] = ids
        captured["tenant_id"] = tenant_id
        return [], 0

    import services.dataset_service as dataset_service_module

    monkeypatch.setattr(dataset_service_module.DatasetService, "get_datasets_by_ids", fake_get_datasets_by_ids)

    with pytest.raises(WorkflowAgentNodeValidationError, match=dataset_id):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=sqlite_session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )

    assert captured == {"ids": [dataset_id], "tenant_id": "tenant-1"}


def test_publish_validation_accepts_tool_node_agentic_manual_mode(unbound_session: Session):
    WorkflowAgentNodeValidator.validate_published_workflow(
        session=unbound_session,
        workflow=_workflow(_tool_graph({"agentic_mode": {"state": "manual"}})),
    )


def test_publish_validation_accepts_tool_node_agentic_parameter_draft(unbound_session: Session):
    WorkflowAgentNodeValidator.validate_published_workflow(
        session=unbound_session,
        workflow=_workflow(_tool_graph({"agentic_mode": {"state": "agentic", "parameter_draft": {"query": "x"}}})),
    )


def test_publish_validation_rejects_incomplete_tool_node_agentic_config(unbound_session: Session):
    with pytest.raises(WorkflowAgentNodeValidationError, match="incomplete agentic mode config"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=unbound_session,
            workflow=_workflow(_tool_graph({"agentic_mode": True})),
        )

    with pytest.raises(WorkflowAgentNodeValidationError, match="incomplete agentic mode config"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=unbound_session,
            workflow=_workflow(_tool_graph({"agentic_mode": {"state": "agentic", "complete": False}})),
        )


def test_publish_validation_rejects_unauthorized_tool_node_agentic_config(unbound_session: Session):
    with pytest.raises(WorkflowAgentNodeValidationError, match="unauthorized agentic mode config"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=unbound_session,
            workflow=_workflow(_tool_graph({"agentic_mode": {"state": "agentic", "permission": {"allowed": False}}})),
        )
