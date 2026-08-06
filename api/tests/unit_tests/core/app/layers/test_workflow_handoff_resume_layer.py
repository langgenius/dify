from datetime import datetime
from unittest.mock import Mock

import pytest

from core.app.layers.workflow_handoff_resume_layer import (
    WORKFLOW_HANDOFF_ACKNOWLEDGEMENT_ABORT_REASON,
    WorkflowHandoffAcknowledgementError,
    WorkflowHandoffAcknowledgementNotObservedError,
    WorkflowHandoffResumeAcknowledgementLayer,
)
from graphon.entities import WorkflowStartReason
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_engine.entities.commands import AbortCommand
from graphon.graph_events import GraphRunStartedEvent
from models.workflow_handoff import (
    WorkflowHandoffResumeRoute,
    WorkflowHandoffState,
    WorkflowRunHandoff,
)


def _claimed_handoff() -> WorkflowRunHandoff:
    handoff = WorkflowRunHandoff(
        workflow_run_id="run-1",
        generation=2,
        task_id="task-1",
        snapshot_object_key="snapshot.json",
        snapshot_schema_version="workflow-resumption-context/v1",
        snapshot_checksum="checksum",
        snapshot_size_bytes=5,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="old-worker",
    )
    handoff.state = WorkflowHandoffState.CLAIMED
    handoff.lease_owner = "new-worker"
    handoff.lease_token = "019c0000-0000-7000-8000-000000000001"
    return handoff


def test_resumption_start_acknowledges_claim_before_execution() -> None:
    repository = Mock()
    repository.mark_resumed.return_value = True
    now = datetime(2026, 7, 28, 12, 0, 0)
    handoff = _claimed_handoff()
    layer = WorkflowHandoffResumeAcknowledgementLayer(
        repository=repository,
        claimed_handoff=handoff,
        clock=lambda: now,
    )

    layer.on_graph_start()
    layer.on_event(GraphRunStartedEvent(reason=WorkflowStartReason.RESUMPTION))
    layer.require_acknowledged()

    repository.mark_resumed.assert_called_once_with(
        handoff_id=handoff.id,
        generation=2,
        lease_owner="new-worker",
        lease_token=handoff.lease_token,
        resumed_at=now,
    )
    assert layer.acknowledged is True


def test_initial_start_is_not_mistaken_for_handoff_resumption() -> None:
    layer = WorkflowHandoffResumeAcknowledgementLayer(
        repository=Mock(),
        claimed_handoff=_claimed_handoff(),
    )

    layer.on_event(GraphRunStartedEvent(reason=WorkflowStartReason.INITIAL))

    with pytest.raises(WorkflowHandoffAcknowledgementNotObservedError):
        layer.require_acknowledged()


def test_failed_acknowledgement_queues_abort_and_fails_explicit_check() -> None:
    repository = Mock()
    repository.mark_resumed.return_value = False
    command_channel = InMemoryChannel()
    layer = WorkflowHandoffResumeAcknowledgementLayer(
        repository=repository,
        claimed_handoff=_claimed_handoff(),
    )
    layer.command_channel = command_channel

    layer.on_event(GraphRunStartedEvent(reason=WorkflowStartReason.RESUMPTION))

    with pytest.raises(WorkflowHandoffAcknowledgementError):
        layer.require_acknowledged()
    commands = command_channel.fetch_commands()
    assert len(commands) == 1
    assert isinstance(commands[0], AbortCommand)
    assert commands[0].reason == WORKFLOW_HANDOFF_ACKNOWLEDGEMENT_ABORT_REASON


def test_constructor_rejects_non_claimed_or_incomplete_identity() -> None:
    handoff = _claimed_handoff()
    handoff.state = WorkflowHandoffState.READY
    with pytest.raises(ValueError, match="not claimed"):
        WorkflowHandoffResumeAcknowledgementLayer(repository=Mock(), claimed_handoff=handoff)

    handoff.state = WorkflowHandoffState.CLAIMED
    handoff.lease_token = None
    with pytest.raises(ValueError, match="identity is incomplete"):
        WorkflowHandoffResumeAcknowledgementLayer(repository=Mock(), claimed_handoff=handoff)
