"""Native JSON context construction and execution-policy receipt ownership."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.system_variables import SystemVariableKey, system_variable_selector
from graphon.entities import GraphInitParams
from graphon.nodes.tool.tool_node import ToolNode
from graphon.runtime import GraphRuntimeState, VariablePool
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.workflow import Workflow
from services.dify_builder.execution_contracts import (
    BuilderExecutionObservation,
    BuilderExecutionPolicyError,
    JsonToolExecutionContext,
    canonical_digest,
)
from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService
from services.dify_builder.json_tool_metadata import InstalledJsonParse
from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414
from tests.unit_tests.services.dify_builder.test_json_tool_execution_admission import GRAPH_FIXTURE
from tests.unit_tests.services.dify_builder.test_json_tool_metadata import _installation, _owners

if TYPE_CHECKING:
    from core.dify_builder.models import Actor
    from models.model import App

    type Owned = tuple[sessionmaker[Session], Actor, App, Workflow, str, str]


@dataclass(frozen=True)
class PreparedJson:
    factory: sessionmaker[Session]
    workflow: Workflow
    service: BuilderExecutionPolicyService
    context: JsonToolExecutionContext


@pytest.fixture
def prepared_json(owned: Owned, monkeypatch: pytest.MonkeyPatch) -> PreparedJson:
    factory, actor, app, workflow, sid, tid = owned
    _owners(monkeypatch, installations=[_installation(tenant_id=actor.tenant_id)])
    inputs = {"payload": '{"name":"Ada"}', "json_path": "$.name"}
    workflow.graph = GRAPH_FIXTURE.read_text()
    with factory.begin() as db:
        stored_workflow = db.get(Workflow, workflow.id)
        test_input = db.get(DifyBuilderTestInput, tid)
        assert stored_workflow is not None
        assert test_input is not None
        stored_workflow.graph = workflow.graph
        test_input.inputs = inputs
    service = BuilderExecutionPolicyService(factory)
    context = service.prepare(
        session_id=sid,
        test_input_id=tid,
        app_id=app.id,
        actor=actor,
        workflow=workflow,
        submitted_inputs=inputs,
        effective_inputs=inputs,
    )
    assert isinstance(context, JsonToolExecutionContext)
    service.claim_launch(context=context, native_run_id="native-run", task_id="native-task")
    return PreparedJson(factory, workflow, service, context)


def test_native_json_factory_constructs_tool_with_typed_run_context(prepared_json: PreparedJson) -> None:
    context = prepared_json.context
    pool = VariablePool()
    pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_EXECUTION_ID), "native-run")
    graph = prepared_json.workflow.graph_dict
    factory = DifyNodeFactory(
        graph_init_params=GraphInitParams(
            workflow_id=context.workflow_id,
            graph_config=graph,
            call_depth=0,
            run_context=build_dify_run_context(
                tenant_id=context.tenant_id,
                app_id=context.app_id,
                user_id=context.actor_id,
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                builder_execution=context,
            ),
        ),
        graph_runtime_state=GraphRuntimeState(variable_pool=pool, start_at=0),
        execution_recorder=prepared_json.service.recorder(
            context=context, native_run_id="native-run", task_id="native-task"
        ),
    )

    assert isinstance(factory.create_node(graph["nodes"][1]), ToolNode)


def test_json_completion_receipt_is_recorded_without_http_fixture_fields(prepared_json: PreparedJson) -> None:
    context = prepared_json.context
    binding = context.qualified_tool
    installation = InstalledJsonParse(
        **{name: getattr(binding, name) for name in InstalledJsonParse.__dataclass_fields__}
    )
    receipt = BuilderExecutionObservation(
        observation_id="native-node",
        invocation_id="native-node",
        request_id=context.request_id,
        node_id=binding.node_id,
        kind="qualified_json_completed",
        implementation_version=f"{context.admitted_nodes[1].implementation}:1",
        reason_code="completed",
        native_node_execution_id="native-node",
        qualification_digest=binding.qualification_digest,
        installed_binding_digest=installation.binding_digest,
        final_parameters_digest=binding.final_parameters_digest,
        pre_binding_digest=installation.binding_digest,
        post_binding_digest=installation.binding_digest,
        native_text_output_digest=canonical_digest("Ada"),
        text_bytes=3,
        text_messages=1,
    )

    prepared_json.service.record(
        context=context, native_run_id="native-run", task_id="native-task", observation=receipt
    )

    with prepared_json.factory() as db:
        request = db.get(DifyBuilderExecutionRequest, context.request_id)
        assert request is not None
        assert request.observations == [receipt.model_dump(mode="json")]


@pytest.mark.parametrize("kind", ["fixture_served", "effect_blocked"])
def test_json_execution_cannot_record_http_receipts(prepared_json: PreparedJson, kind: str) -> None:
    context = prepared_json.context
    receipt = BuilderExecutionObservation.model_validate(
        {
            "observation_id": "http-receipt",
            "invocation_id": "http-receipt",
            "request_id": context.request_id,
            "node_id": context.qualified_tool.node_id,
            "kind": kind,
            "implementation_version": f"{context.admitted_nodes[1].implementation}:1",
            "reason_code": "http_fixture_served" if kind == "fixture_served" else "http_fixture_missing",
            "fixture_digest": "a" * 64 if kind == "fixture_served" else None,
        }
    )

    with pytest.raises(BuilderExecutionPolicyError, match="observation_binding_mismatch"):
        prepared_json.service.record(
            context=context, native_run_id="native-run", task_id="native-task", observation=receipt
        )

    with prepared_json.factory() as db:
        request = db.get(DifyBuilderExecutionRequest, context.request_id)
        assert request is not None
        assert request.observations == []
