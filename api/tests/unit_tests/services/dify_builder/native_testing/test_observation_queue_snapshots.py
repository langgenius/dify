"""New native resume metadata is copied with content redacted, never trusted as authority."""

import pytest

from core.app.entities.queue_entities import NodeExecutionSnapshot, QueueWorkflowStartedEvent
from graphon.entities import WorkflowStartReason
from services.dify_builder.native_testing.http_binding import build_native_http_profile
from services.dify_builder.native_testing.observation_adapters import NativeObservationError, NativeObservationGuard
from services.dify_builder.native_testing.observation_privacy import NativeHttpObservationPolicy
from services.dify_builder.native_testing.observation_stream import project_native_queue_event
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import NOW, SENTINEL, context


@pytest.fixture
def guard():
    return NativeObservationGuard(
        policy=NativeHttpObservationPolicy.qualify(context=context(), profile=build_native_http_profile()),
        on_failure=lambda: None,
    )


def snapshot():
    return NodeExecutionSnapshot(execution_id="execution", title=SENTINEL, index=1, start_at=NOW)


def test_empty_start_snapshots_are_supported(guard):
    event = QueueWorkflowStartedEvent()
    result = project_native_queue_event(guard=guard, event=event)
    assert result.node_execution_snapshots == ()
    assert result is not event


def test_nonempty_start_snapshots_preserve_correlation_and_redact_title(guard):
    raw = snapshot()
    event = QueueWorkflowStartedEvent(node_execution_snapshots=(raw,))
    result = project_native_queue_event(guard=guard, event=event)
    copied = result.node_execution_snapshots[0]
    assert copied is not raw
    assert copied.execution_id == raw.execution_id
    assert copied.index == raw.index
    assert copied.start_at == raw.start_at
    assert copied.iteration_id == copied.loop_id == ""
    assert copied.title == "[native content redacted]"
    assert SENTINEL not in result.model_dump_json()
    assert raw.title == SENTINEL
    repeated = project_native_queue_event(guard=guard, event=result)
    assert repeated == result
    assert repeated.node_execution_snapshots[0] is not copied


@pytest.mark.parametrize(
    "changes", [{"inputs": {"secret": SENTINEL}}, {"outputs": SENTINEL}, {"index": -1}, {"loop_id": 1}]
)
def test_unchecked_snapshot_fields_fail_closed(guard, changes):
    raw = snapshot().model_copy(update=changes)
    event = QueueWorkflowStartedEvent.model_construct(node_execution_snapshots=(raw,))
    with pytest.raises(NativeObservationError):
        project_native_queue_event(guard=guard, event=event)


def test_snapshot_metadata_never_supplies_resume_provenance(guard):
    event = QueueWorkflowStartedEvent(reason=WorkflowStartReason.RESUMPTION, node_execution_snapshots=(snapshot(),))
    with pytest.raises(NativeObservationError):
        project_native_queue_event(guard=guard, event=event)
