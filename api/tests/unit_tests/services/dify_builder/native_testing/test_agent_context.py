"""The confirmed Agent marker survives server carriers without granting authority."""

import pytest
from pydantic import ValidationError

from core.app.entities.app_invoke_entities import (
    DifyRunContext,
    InvokeFrom,
    UserFrom,
    build_dify_run_context,
)
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from runtime_contracts.builder.native.agent_context import BuilderAgentExecutionContext
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from tests.unit_tests.core.app.entities.test_app_invoke_entities import _create_workflow_generate_entity


def marker():
    return BuilderAgentExecutionContext(
        ref=NativeTestContextRef(request_id="request", invocation_id="invocation", context_digest="a" * 64),
        native_run_id="2bde426e-1b66-4cbd-b2a8-226c4141805c",
    )


@pytest.mark.parametrize(
    "run_id", ["not-a-uuid", "2BDE426E-1B66-4CBD-B2A8-226C4141805C", "2bde426e1b664cbdb2a8226c4141805c", 1]
)
def test_marker_requires_canonical_uuid_string(run_id):
    with pytest.raises(ValidationError):
        BuilderAgentExecutionContext(ref=marker().ref, native_run_id=run_id)


def test_marker_is_frozen_and_ref_has_no_credentials():
    context = marker()
    assert context.schema_version == "builder-agent-confirmed-v1"
    assert set(context.model_dump()) == {"schema_version", "ref", "native_run_id"}
    with pytest.raises(ValidationError):
        context.native_run_id = "2bde426e-1b66-4cbd-b2a8-226c4141805d"
    with pytest.raises(ValidationError):
        BuilderAgentExecutionContext(**context.model_dump(), credentials={"token": "secret"})


def test_marker_round_trips_graph_context_and_pause_entity():
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
    entity = _create_workflow_generate_entity().model_copy(update={"builder_agent_execution": context})
    pause = WorkflowResumptionContext(
        serialized_graph_runtime_state="{}",
        generate_entity=_WorkflowGenerateEntityWrapper(entity=entity),
    )
    restored = WorkflowResumptionContext.loads(pause.dumps()).get_generate_entity()
    assert restored.builder_agent_execution == context
    assert restored.native_test_required is False
    assert restored.native_test_ref is None


def test_ordinary_context_has_no_agent_marker():
    run = build_dify_run_context(
        tenant_id="tenant",
        app_id="app",
        user_id="actor",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )["_dify"]
    assert run.builder_agent_execution is None
