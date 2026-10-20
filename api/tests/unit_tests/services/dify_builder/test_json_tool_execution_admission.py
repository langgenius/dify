"""Owned JSON Parse draft admission through the existing preparation service.

The graph fixture is the reviewed Local native export. Only the explicit
ensure_ascii form value changes between cases; the saved draft is never
rewritten into a different Tool or parameter representation.
"""

import json
from pathlib import Path
from typing import Never

import pytest

from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.workflow import Workflow
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from services.dify_builder.application.execution_policy import scalar_inputs_digest
from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService
from services.dify_builder.json_tool_metadata import InstalledJsonParse
from tests.unit_tests.services.dify_builder.test_execution_policy_service import Owned
from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414

GRAPH_FIXTURE = Path(__file__).parents[3] / "fixtures/workflow/builder_restricted/json_parse_owned_graph.json"


@pytest.mark.parametrize(
    ("ensure_ascii", "wrapped"),
    [(True, False), (False, False), (True, True), (False, True)],
    ids=["raw-true", "raw-false", "constant-true", "constant-false"],
)
def test_owned_json_parse_prepare_persists_restricted_request(
    owned: Owned, monkeypatch: pytest.MonkeyPatch, ensure_ascii: bool, wrapped: bool
) -> None:
    from tests.unit_tests.services.dify_builder.test_json_tool_metadata import _installation, _owners

    factory, actor, app, workflow, session_id, test_input_id = owned
    metadata_calls = _owners(monkeypatch, installations=[_installation(tenant_id=actor.tenant_id)])
    graph = json.loads(GRAPH_FIXTURE.read_text())
    graph["nodes"][1]["data"]["tool_configurations"]["ensure_ascii"] = (
        {"type": "constant", "value": ensure_ascii} if wrapped else ensure_ascii
    )
    graph_json = json.dumps(graph, ensure_ascii=False)
    submitted = {"payload": '{"greeting":"café"}', "json_path": "$.greeting"}
    workflow.graph = graph_json
    with factory.begin() as db:
        saved_workflow = db.get(Workflow, workflow.id)
        assert saved_workflow is not None
        saved_workflow.graph = graph_json
        saved_input = db.get(DifyBuilderTestInput, test_input_id)
        assert saved_input is not None
        saved_input.inputs = submitted

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
    assert metadata_calls == [
        ("install", actor.tenant_id, ["langgenius/json_process"]),
        ("provider", actor.tenant_id, "langgenius/json_process/json_process"),
    ]
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
        saved_input = db.get(DifyBuilderTestInput, test_input_id)
        assert saved_input is not None
        assert saved_input.inputs == submitted


def test_json_prepare_reloads_owner_and_inputs_after_metadata(owned: Owned, monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder import execution_policy_service as service_module
    from tests.unit_tests.services.dify_builder.test_json_tool_metadata import _installation, _owners

    factory, actor, app, workflow, session_id, test_input_id = owned
    _owners(monkeypatch, installations=[_installation(tenant_id=actor.tenant_id)])
    graph_json = GRAPH_FIXTURE.read_text()
    submitted = {"payload": '{"x":"y"}', "json_path": "$.x"}
    workflow.graph = graph_json
    with factory.begin() as db:
        saved_workflow = db.get(Workflow, workflow.id)
        assert saved_workflow is not None
        saved_workflow.graph = graph_json
        saved_input = db.get(DifyBuilderTestInput, test_input_id)
        assert saved_input is not None
        saved_input.inputs = submitted
    original = service_module.resolve_installed_json_parse

    def change_saved_input(*, tenant_id: str) -> InstalledJsonParse:
        with factory.begin() as db:
            saved_input = db.get(DifyBuilderTestInput, test_input_id)
            assert saved_input is not None
            saved_input.inputs = {**submitted, "payload": "{}"}
        return original(tenant_id=tenant_id)

    monkeypatch.setattr(service_module, "resolve_installed_json_parse", change_saved_input)
    with pytest.raises(BuilderExecutionPolicyError, match="stale_execution_revision"):
        BuilderExecutionPolicyService(factory).prepare(
            session_id=session_id,
            test_input_id=test_input_id,
            app_id=app.id,
            actor=actor,
            workflow=workflow,
            submitted_inputs=submitted,
            effective_inputs=submitted,
        )
    with factory() as db:
        assert db.query(DifyBuilderExecutionRequest).count() == 0


def test_existing_restricted_policies_skip_json_metadata(owned: Owned, monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder import execution_policy_service as service_module
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import prepare_inputs

    def forbidden(*, tenant_id: str) -> Never:
        raise AssertionError(f"unexpected JSON metadata read for {tenant_id}")

    monkeypatch.setattr(service_module, "resolve_installed_json_parse", forbidden)
    context = prepare_inputs(owned)
    assert context.policy_version == "builder-restricted-v1"
