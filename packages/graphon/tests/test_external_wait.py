"""Generic external-wait identity survives existing events and frame snapshots."""

import pytest
from pydantic import TypeAdapter, ValidationError

from graphon.engine_events.graph import GraphRunPausedEvent
from graphon.entities.pause_reason import ExternalWaitReason, HitlRequired, PauseReason
from graphon.runtime import RuntimeState, VariablePool


def reason(frame_id: str = "root") -> ExternalWaitReason:
    return ExternalWaitReason(
        wait_id="external-work-1",
        node_id="agent",
        node_title="External worker",
        execution_id=f"execution:{frame_id}",
        frame_id=frame_id,
    )


def test_external_wait_validates_as_its_own_reason() -> None:
    value = TypeAdapter(PauseReason).validate_json(reason().model_dump_json())
    assert isinstance(value, ExternalWaitReason)
    assert value.TYPE == "external_wait"
    event = GraphRunPausedEvent(reasons=[value])
    assert isinstance(
        GraphRunPausedEvent.model_validate_json(event.model_dump_json()).reasons[0],
        ExternalWaitReason,
    )


def test_frame_execution_identities_survive_runtime_snapshot() -> None:
    state = RuntimeState(
        variable_pool=VariablePool(), start_at=0, workflow_id="workflow"
    )
    first = state.graph_execution.get_or_create_node_execution(
        frame_id="iteration:0", node_id="agent"
    )
    second = state.graph_execution.get_or_create_node_execution(
        frame_id="iteration:1", node_id="agent"
    )
    state.graph_execution.pause(reason("iteration:0"))
    state.graph_execution.pause(reason("iteration:1"))
    restored = RuntimeState.from_snapshot(state.dumps())
    assert restored.graph_execution.paused
    assert [item.frame_id for item in restored.graph_execution.pause_reasons] == [
        "iteration:0",
        "iteration:1",
    ]
    assert first.execution_id != second.execution_id
    assert (
        restored.graph_execution.get_or_create_node_execution(
            frame_id="iteration:0", node_id="agent"
        ).execution_id
        == first.execution_id
    )


def test_legacy_human_input_reason_still_decodes() -> None:
    decoded = TypeAdapter(PauseReason).validate_python({
        "TYPE": "human_input_required",
        "form_id": "form",
        "node_id": "human",
        "node_title": "Review",
    })
    assert isinstance(decoded, HitlRequired)
    assert decoded.session_id == "form"


def test_external_wait_rejects_missing_identity_and_host_policy() -> None:
    with pytest.raises(ValidationError):
        ExternalWaitReason.model_validate({"TYPE": "external_wait", "wait_id": "work"})
    with pytest.raises(ValidationError):
        ExternalWaitReason.model_validate({
            **reason().model_dump(),
            "tenant_id": "not-framework-state",
        })


def test_active_engine_cannot_be_snapshotted() -> None:
    state = RuntimeState(
        variable_pool=VariablePool(), start_at=0, workflow_id="workflow"
    )
    with state.graph_execution.track_execution(), pytest.raises(RuntimeError):
        state.dumps()


def test_boolean_node_defaults_are_supported_without_scalar_coercion() -> None:
    from graphon.entities.base_node_data import DefaultValue

    assert DefaultValue(type="boolean", key="accepted", value=False).value is False
    assert DefaultValue(type="array[boolean]", key="flags", value=[True, False]).value == [True, False]
    with pytest.raises(ValueError):
        DefaultValue(type="boolean", key="accepted", value="false")
    # Existing Native compatibility remains unchanged.
    assert DefaultValue(type="number", key="legacy", value="2").value == 2
