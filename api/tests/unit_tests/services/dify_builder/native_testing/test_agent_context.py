"""The confirmed Agent marker survives server carriers without granting authority."""

from core.app.entities.app_invoke_entities import (
    DifyRunContext,
    InvokeFrom,
    UserFrom,
    build_dify_run_context,
)
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from runtime_contracts.builder.native.agent_context import BuilderAgentExecutionContext
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from tests.unit_tests.core.app.entities.test_app_invoke_entities import _create_workflow_generate_entity, _trace_scope


def marker() -> BuilderAgentExecutionContext:
    return BuilderAgentExecutionContext(
        ref=NativeTestContextRef(request_id="request", invocation_id="invocation", context_digest="a" * 64),
        native_run_id="2bde426e-1b66-4cbd-b2a8-226c4141805c",
    )


def test_marker_round_trips_graph_context_and_pause_entity() -> None:
    context = marker()
    run = build_dify_run_context(
        tenant_id="tenant",
        app_id="app",
        user_id="actor",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        builder_agent_execution=context,
    )["_dify"]
    assert DifyRunContext.model_validate_json(run.model_dump_json()).builder_agent_execution == context
    entity = _create_workflow_generate_entity(trace_scope=_trace_scope()).model_copy(
        update={"builder_agent_execution": context}
    )
    pause = WorkflowResumptionContext(
        serialized_graph_runtime_state="{}",
        generate_entity=_WorkflowGenerateEntityWrapper(entity=entity),
    )
    restored = WorkflowResumptionContext.loads(pause.dumps()).get_generate_entity()
    assert restored.builder_agent_execution == context
    assert restored.native_test_required is False
    assert restored.native_test_ref is None


def test_ordinary_context_has_no_agent_marker() -> None:
    run = build_dify_run_context(
        tenant_id="tenant",
        app_id="app",
        user_id="actor",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )["_dify"]
    assert run.builder_agent_execution is None
