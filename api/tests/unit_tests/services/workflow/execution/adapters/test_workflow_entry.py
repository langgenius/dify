"""Single-step Agent execution loads filter-only inputs through injected owners."""

import json

import pytest
from sqlalchemy.orm import Session, sessionmaker

from graphon.runtime import VariablePool
from graphon.variables import VariableBase
from graphon.variables.variables import StringVariable
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.workflow import Workflow
from repositories.agent.runtime_repository import WorkflowAgentBindingResolver
from services.workflow.execution.adapters.agent_v2.agent_node import DifyAgentNode
from services.workflow.execution.adapters.agent_v2.runtime_request_builder import build_knowledge_layer_config
from services.workflow.execution.adapters.workflow_entry import WorkflowEntry
from services.workflow.execution.ports import WorkflowRuntime
from tests.helpers.unit.config_override import apply_config_overrides


class DraftInputs:
    """A variable-loader port backed by validated in-memory draft variables."""

    def __init__(self) -> None:
        self.requested: list[list[str]] = []
        self.value = StringVariable(name="code", value="00123", selector=["start", "code"])

    def load_variables(self, selectors: list[list[str]]) -> list[VariableBase]:
        self.requested.extend(selectors)
        return [self.value] if ["start", "code"] in selectors else []


@pytest.mark.parametrize("operator", ["=", "empty", "not empty"])
@pytest.mark.parametrize("inject_resolver", [True, False])
def test_single_step_preloads_owned_agent_metadata_filters(
    sqlite_session_factory: sessionmaker[Session],
    workflow_runtime: WorkflowRuntime,
    monkeypatch: pytest.MonkeyPatch,
    operator: str,
    inject_resolver: bool,
) -> None:
    """A real binding repository supplies the Soul; value-free filters do not load values."""
    apply_config_overrides(monkeypatch, AGENT_BACKEND_BASE_URL="http://agent-backend.invalid")
    soul = AgentSoulConfig.model_validate(
        {
            "knowledge": {
                "sets": [
                    {
                        "id": "docs",
                        "name": "Docs",
                        "datasets": [{"id": "dataset"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 4},
                        "metadata_filtering": {
                            "mode": "manual",
                            "conditions": {
                                "logical_operator": "and",
                                "conditions": [
                                    {"name": "code", "comparison_operator": operator, "value": "{{#start.code#}}"}
                                ],
                            },
                        },
                    }
                ]
            }
        }
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                Agent(
                    id="agent",
                    tenant_id="tenant",
                    name="Agent",
                    scope=AgentScope.WORKFLOW_ONLY,
                    source=AgentSource.WORKFLOW,
                ),
                AgentConfigSnapshot(
                    id="snapshot", tenant_id="tenant", agent_id="agent", version=1, config_snapshot=soul
                ),
                WorkflowAgentNodeBinding(
                    id="binding",
                    tenant_id="tenant",
                    app_id="app",
                    workflow_id="workflow",
                    workflow_version="draft",
                    node_id="node",
                    binding_type=WorkflowAgentBindingType.INLINE_AGENT,
                    agent_id="agent",
                    current_snapshot_id="snapshot",
                    node_job_config=WorkflowNodeJobConfig(),
                ),
            ]
        )
    workflow = Workflow(
        id="workflow",
        tenant_id="tenant",
        app_id="app",
        graph=json.dumps(
            {
                "nodes": [
                    {
                        "id": "node",
                        "data": {"type": "agent", "version": "2", "title": "Agent", "agent_node_kind": "dify_agent"},
                    },
                ],
                "edges": [],
            }
        ),
    )
    pool = VariablePool()
    inputs = DraftInputs()
    resolver = WorkflowAgentBindingResolver(sqlite_session_factory) if inject_resolver else None
    if not inject_resolver:
        with pytest.raises(ValueError, match="Dify Agent nodes require an injected binding resolver"):
            WorkflowEntry.single_step_run(
                workflow=workflow,
                node_id="node",
                user_id="user",
                user_inputs={},
                variable_pool=pool,
                variable_loader=inputs,
                workflow_runtime=workflow_runtime,
                agent_binding_resolver=resolver,
            )
        assert inputs.requested == []
    else:
        node, events = WorkflowEntry.single_step_run(
            workflow=workflow,
            node_id="node",
            user_id="user",
            user_inputs={},
            variable_pool=pool,
            variable_loader=inputs,
            workflow_runtime=workflow_runtime,
            agent_binding_resolver=resolver,
        )
        events.close()
        assert isinstance(node, DifyAgentNode)
        assert (["start", "code"] in inputs.requested) == (operator == "=")
        layer = build_knowledge_layer_config(soul, variable_pool=pool)
        assert layer is not None
        conditions = layer.sets[0].metadata_filtering.conditions
        assert conditions is not None
        assert conditions.conditions[0].value == ("00123" if operator == "=" else "{{#start.code#}}")
