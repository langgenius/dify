"""Owned JSON Parse draft admission through the existing preparation service.

The graph fixture is the reviewed Local native export. Only the explicit
ensure_ascii form value changes between cases; the saved draft is never
rewritten into a different Tool or parameter representation.
"""

import json
from pathlib import Path

import pytest

from core.dify_builder.execution_policy import scalar_inputs_digest
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.workflow import Workflow
from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService
from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414

GRAPH_FIXTURE = Path(__file__).parents[3] / "fixtures/workflow/builder_restricted/json_parse_owned_graph.json"


@pytest.mark.parametrize(
    ("ensure_ascii", "wrapped"),
    [(True, False), (False, False), (True, True), (False, True)],
    ids=["raw-true", "raw-false", "constant-true", "constant-false"],
)
def test_owned_json_parse_prepare_persists_restricted_request(owned, ensure_ascii: bool, wrapped: bool) -> None:
    factory, actor, app, workflow, session_id, test_input_id = owned
    graph = json.loads(GRAPH_FIXTURE.read_text())
    graph["nodes"][1]["data"]["tool_configurations"]["ensure_ascii"] = (
        {"type": "constant", "value": ensure_ascii} if wrapped else ensure_ascii
    )
    graph_json = json.dumps(graph, ensure_ascii=False)
    submitted = {"payload": '{"greeting":"café"}', "json_path": "$.greeting"}
    workflow.graph = graph_json
    with factory.begin() as db:
        db.get(Workflow, workflow.id).graph = graph_json
        db.get(DifyBuilderTestInput, test_input_id).inputs = submitted

    context = BuilderExecutionPolicyService(factory).prepare(
        session_id=session_id,
        test_input_id=test_input_id,
        app_id=app.id,
        actor=actor,
        workflow=workflow,
        submitted_inputs=submitted,
        effective_inputs=submitted,
    )

    assert context.policy_version == "builder-json-parse-v1"
    assert context.mode == "restricted"
    assert context.sandbox_profile == "disabled"
    assert context.submitted_inputs_digest == scalar_inputs_digest(submitted)
    assert context.effective_inputs_digest == scalar_inputs_digest(submitted)
    assert [(node.node_id, node.implementation, node.node_version) for node in context.admitted_nodes] == [
        ("node1", "graphon.nodes.start.start_node.StartNode", "1"),
        ("node2", "graphon.nodes.tool.tool_node.ToolNode", "1"),
        ("node3", "graphon.nodes.end.end_node.EndNode", "1"),
    ]
    with factory() as db:
        request = db.get(DifyBuilderExecutionRequest, context.request_id)
        assert request is not None
        assert request.state == "prepared"
        assert request.tenant_id == actor.tenant_id
        assert request.actor_id == actor.account_id
        assert request.app_id == app.id
        assert request.workflow_id == workflow.id
        assert request.session_id == session_id
        assert request.test_input_id == test_input_id
        assert request.context == context.model_dump(mode="json")
        assert request.context_digest == context.context_digest
        assert db.get(DifyBuilderTestInput, test_input_id).inputs == submitted
