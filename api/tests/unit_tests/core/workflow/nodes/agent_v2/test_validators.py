import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.workflow.nodes.agent_v2.validators import (
    WorkflowAgentNodeValidationError,
    WorkflowAgentNodeValidator,
)
from models.agent import Agent, AgentConfigSnapshot, AgentStatus, WorkflowAgentNodeBinding
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
