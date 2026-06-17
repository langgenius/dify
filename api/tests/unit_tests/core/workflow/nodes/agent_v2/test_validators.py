import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.workflow.nodes.agent_v2.validators import (
    WorkflowAgentNodeValidationError,
    WorkflowAgentNodeValidator,
)
from models.agent import Agent, AgentConfigSnapshot, AgentStatus, WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig, WorkflowNodeJobConfig
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
        node_id="agent-node",
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=node_job,
    )


def _agent() -> Agent:
    return Agent(id="agent-1", tenant_id="tenant-1", name="Agent", status=AgentStatus.ACTIVE)


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


def _graph(edges: list[dict]) -> dict:
    return {
        "nodes": [
            {"id": "start", "data": {"type": "start"}},
            {"id": "previous-node", "data": {"type": "llm"}},
            {"id": "agent-node", "data": {"type": "agent", "version": "2"}},
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


def test_publish_validation_accepts_upstream_previous_output_ref():
    node_job = WorkflowNodeJobConfig.model_validate(
        {"previous_node_output_refs": [{"node_id": "previous-node", "output": "text"}]}
    )
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), _snapshot()]

    WorkflowAgentNodeValidator.validate_published_workflow(
        session=session,
        workflow=_workflow(
            _graph(
                [
                    {"source": "start", "target": "previous-node"},
                    {"source": "previous-node", "target": "agent-node"},
                ]
            )
        ),
    )


def test_publish_validation_uses_active_snapshot_for_roster_agent():
    node_job = WorkflowNodeJobConfig()
    binding = _binding(node_job)
    binding.binding_type = WorkflowAgentBindingType.ROSTER_AGENT
    binding.current_snapshot_id = "old-snapshot"
    agent = _agent()
    agent.active_config_snapshot_id = "active-snapshot"
    snapshot = _snapshot()
    snapshot.id = "active-snapshot"
    session = Mock()
    session.scalar.side_effect = [binding, agent, snapshot]

    WorkflowAgentNodeValidator.validate_published_workflow(
        session=session,
        workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
    )


def test_publish_validation_rejects_non_upstream_previous_output_ref():
    node_job = WorkflowNodeJobConfig.model_validate(
        {"previous_node_output_refs": [{"node_id": "later-node", "output": "text"}]}
    )
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), _snapshot()]

    with pytest.raises(WorkflowAgentNodeValidationError, match="non-upstream"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(
                _graph(
                    [
                        {"source": "start", "target": "agent-node"},
                        {"source": "agent-node", "target": "later-node"},
                    ]
                )
            ),
        )


def test_draft_validation_allows_unbound_agent_node():
    session = Mock()
    session.scalar.return_value = None

    WorkflowAgentNodeValidator.validate_draft_workflow(
        session=session,
        workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
    )


def test_publish_validation_requires_binding():
    session = Mock()
    session.scalar.return_value = None

    with pytest.raises(WorkflowAgentNodeValidationError, match="requires a binding"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_duplicate_output_names():
    node_job = WorkflowNodeJobConfig.model_validate(
        {
            "declared_outputs": [
                {"name": "summary", "type": "string"},
                {"name": "summary", "type": "number"},
            ]
        }
    )
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), _snapshot()]

    with pytest.raises(WorkflowAgentNodeValidationError, match="duplicate output name"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_missing_agent_soul_model():
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

    with pytest.raises(WorkflowAgentNodeValidationError, match="requires Agent Soul model"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_dedupes_provider_level_tool_entries():
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
                {"provider_id": "langgenius/duckduckgo/duckduckgo", "credential_type": "unauthorized"},
                {"provider_id": "langgenius/duckduckgo/duckduckgo", "credential_type": "unauthorized"},
            ]
        },
    )
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), snapshot]

    with pytest.raises(WorkflowAgentNodeValidationError, match="duplicate Dify Plugin Tool"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_accepts_provider_level_plus_explicit_tool_entry():
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
                {"provider_id": "langgenius/duckduckgo/duckduckgo", "credential_type": "unauthorized"},
                {
                    "provider_id": "langgenius/duckduckgo/duckduckgo",
                    "tool_name": "ddg_search",
                    "credential_type": "unauthorized",
                },
            ]
        },
    )
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), snapshot]

    WorkflowAgentNodeValidator.validate_published_workflow(
        session=session,
        workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
    )


def test_publish_validation_rejects_duplicate_cli_tool_names():
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
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), snapshot]

    with pytest.raises(WorkflowAgentNodeValidationError, match="duplicate CLI Tool name pytest"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_unauthorized_cli_tool():
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
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), snapshot]

    with pytest.raises(WorkflowAgentNodeValidationError, match="unauthorized CLI Tool"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_unacknowledged_dangerous_cli_tool():
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
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), snapshot]

    with pytest.raises(WorkflowAgentNodeValidationError, match="unacknowledged dangerous CLI Tool"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_unauthorized_secret_ref():
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
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), snapshot]

    with pytest.raises(WorkflowAgentNodeValidationError, match="unauthorized secret reference API_TOKEN"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_cli_tool_scoped_env_conflicts_and_unauthorized_secret_refs():
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
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), snapshot]

    with pytest.raises(WorkflowAgentNodeValidationError, match="duplicate env/secret name TOKEN"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
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
    session.scalar.side_effect = [_binding(node_job), _agent(), snapshot]

    with pytest.raises(WorkflowAgentNodeValidationError, match="unauthorized secret reference GITHUB_TOKEN"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_missing_previous_node():
    node_job = WorkflowNodeJobConfig.model_validate(
        {"previous_node_output_refs": [{"node_id": "missing-node", "output": "text"}]}
    )
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), _snapshot()]

    with pytest.raises(WorkflowAgentNodeValidationError, match="references missing previous node"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_self_previous_output_ref():
    node_job = WorkflowNodeJobConfig.model_validate(
        {"previous_node_output_refs": [{"node_id": "agent-node", "output": "text"}]}
    )
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), _snapshot()]

    with pytest.raises(WorkflowAgentNodeValidationError, match="non-upstream"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_locked_agent_soul_override_in_metadata():
    node_job = WorkflowNodeJobConfig.model_validate({"metadata": {"agent_soul": {"tools": []}}})
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), _snapshot()]

    with pytest.raises(WorkflowAgentNodeValidationError, match="cannot override locked Agent Soul fields"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_invalid_human_contact_ref():
    node_job = WorkflowNodeJobConfig.model_validate({"human_contacts": [{"channel": "slack"}]})
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), _snapshot()]

    with pytest.raises(WorkflowAgentNodeValidationError, match="invalid human contact ref"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_rejects_out_of_scope_human_contact_ref():
    node_job = WorkflowNodeJobConfig.model_validate(
        {"human_contacts": [{"contact_id": "human-1", "tenant_id": "other-tenant", "channel": "slack"}]}
    )
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), _snapshot()]

    with pytest.raises(WorkflowAgentNodeValidationError, match="out-of-scope human contact"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_accepts_tenant_scoped_file_ref():
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
    session = Mock()
    session.scalar.side_effect = [
        _binding(node_job),
        _agent(),
        _snapshot(),
        SimpleNamespace(id="file-1", tenant_id="tenant-1"),
    ]

    WorkflowAgentNodeValidator.validate_published_workflow(
        session=session,
        workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
    )


def test_publish_validation_rejects_missing_file_ref():
    node_job = WorkflowNodeJobConfig.model_validate({"metadata": {"file_refs": [{"upload_file_id": "missing-file"}]}})
    session = Mock()
    session.scalar.side_effect = [_binding(node_job), _agent(), _snapshot(), None]

    with pytest.raises(WorkflowAgentNodeValidationError, match="missing or out-of-scope metadata file ref"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_graph([{"source": "start", "target": "agent-node"}])),
        )


def test_publish_validation_accepts_tool_node_agentic_manual_mode():
    session = Mock()

    WorkflowAgentNodeValidator.validate_published_workflow(
        session=session,
        workflow=_workflow(_tool_graph({"agentic_mode": {"state": "manual"}})),
    )


def test_publish_validation_accepts_tool_node_agentic_parameter_draft():
    session = Mock()

    WorkflowAgentNodeValidator.validate_published_workflow(
        session=session,
        workflow=_workflow(_tool_graph({"agentic_mode": {"state": "agentic", "parameter_draft": {"query": "x"}}})),
    )


def test_publish_validation_rejects_incomplete_tool_node_agentic_config():
    session = Mock()

    with pytest.raises(WorkflowAgentNodeValidationError, match="incomplete agentic mode config"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_tool_graph({"agentic_mode": True})),
        )

    with pytest.raises(WorkflowAgentNodeValidationError, match="incomplete agentic mode config"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_tool_graph({"agentic_mode": {"state": "agentic", "complete": False}})),
        )


def test_publish_validation_rejects_unauthorized_tool_node_agentic_config():
    session = Mock()

    with pytest.raises(WorkflowAgentNodeValidationError, match="unauthorized agentic mode config"):
        WorkflowAgentNodeValidator.validate_published_workflow(
            session=session,
            workflow=_workflow(_tool_graph({"agentic_mode": {"state": "agentic", "permission": {"allowed": False}}})),
        )
