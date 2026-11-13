"""Frozen cancellation, timeout and context rules using real immutable values."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Literal, Unpack

import pytest
from typing_extensions import TypedDict

from services.external_agents.context_service import context_key
from services.external_agents.invocation_agg import ExternalInvocationAgg
from services.external_agents.protocol import GatewayReceipt
from services.external_agents.runtime_contracts import (
    CancelState,
    CommandKind,
    ExecutionIdentity,
    Invocation,
    LocalState,
    RuntimeError,
    RuntimeScope,
    RuntimeSettings,
    SubmissionState,
    TimeoutPolicy,
    WaitPolicy,
)


class InvocationChanges(TypedDict, total=False, closed=True):
    policy: WaitPolicy
    cancel_state: CancelState
    cancel_trigger: Literal["timeout", "user"] | None
    cancellation_deadline: datetime | None
    remote_task_id: str | None
    submission_state: SubmissionState
    carried_context_id: str | None
    connection_revision_id: str | None
    ended_at: datetime | None
    identity: ExecutionIdentity
    local_state: LocalState
    local_wait_ended_at: datetime | None
    logical_deadline: datetime
    scope: RuntimeScope


NOW = datetime(2026, 11, 9, tzinfo=UTC)
SETTINGS = RuntimeSettings()


def invocation(**changes: Unpack[InvocationChanges]) -> Invocation:
    value = Invocation(
        id="invocation",
        scope=RuntimeScope(tenant_id="tenant", app_id="app", initiator_id="user", origin="production"),
        agent_id="agent",
        identity=ExecutionIdentity(
            execution_id="execution",
            node_id="node",
            frame_id="root",
            workflow_run_id="run",
            conversation_id="conversation",
            binding_epoch="epoch",
        ),
        message_id="message",
        parts=({"text": "Review the contract"},),
        policy=WaitPolicy(),
        declared_outputs=(),
        started_at=NOW,
        logical_deadline=NOW + timedelta(hours=1),
        connection_revision_id="revision",
        submission_state=SubmissionState.ACCEPTED,
        remote_task_id="task",
        remote_state="working",
        dispatched_at=NOW,
        wait_deadline=NOW + timedelta(minutes=10),
    )
    return replace(value, **changes)


def task(state: str, *, context_id: str | None = None) -> GatewayReceipt:
    return GatewayReceipt(kind="task", payload={}, task_id="task", state=state, context_id=context_id)


def test_end_waiting_does_not_cancel_or_replenish_budget() -> None:
    value = invocation()
    result = ExternalInvocationAgg(value, SETTINGS).expire(NOW + timedelta(minutes=10))
    assert result.invocation.local_state == LocalState.ENDED
    assert result.invocation.logical_deadline == value.logical_deadline
    assert CommandKind.CANCEL not in [item.kind for item in result.commands]
    assert result.invocation.tracking_deadline == NOW + timedelta(minutes=10, hours=24)


def test_cancel_retry_requires_authoritative_canceled_not_acknowledgment() -> None:
    value = invocation(policy=WaitPolicy(on_timeout=TimeoutPolicy.CANCEL_AND_RETRY))
    expired = ExternalInvocationAgg(value, SETTINGS).expire(NOW + timedelta(minutes=10))
    assert expired.invocation.cancel_state == CancelState.REQUESTED
    assert expired.invocation.cancel_trigger == "timeout"
    assert expired.invocation.cancellation_deadline == NOW + timedelta(minutes=10, seconds=30)
    acknowledged = ExternalInvocationAgg(expired.invocation, SETTINGS).receive(
        task("working"), NOW + timedelta(minutes=10)
    )
    assert CommandKind.RETRY not in [item.kind for item in acknowledged.commands]
    canceled = ExternalInvocationAgg(acknowledged.invocation, SETTINGS).receive(
        task("canceled"), NOW + timedelta(minutes=10, seconds=1)
    )
    assert canceled.invocation.local_state == LocalState.RETRY_PENDING
    assert canceled.invocation.cancel_state == CancelState.CONFIRMED
    assert [item.kind for item in canceled.commands] == [CommandKind.RETRY, CommandKind.DEADLINE]
    assert canceled.commands[0].not_before == NOW + timedelta(minutes=10, seconds=6)


def test_manual_stop_never_uses_timeout_retry_policy() -> None:
    value = invocation(
        policy=WaitPolicy(on_timeout=TimeoutPolicy.CANCEL_AND_RETRY),
        cancel_state=CancelState.REQUESTED,
        cancel_trigger="user",
        cancellation_deadline=NOW + timedelta(seconds=30),
    )
    result = ExternalInvocationAgg(value, SETTINGS).receive(task("canceled"), NOW + timedelta(seconds=1))
    assert result.invocation.local_state == LocalState.ENDED
    assert not any(item.kind == CommandKind.RETRY for item in result.commands)


def test_valid_completion_wins_during_cancellation_confirmation() -> None:
    value = invocation(cancel_state=CancelState.REQUESTED, cancel_trigger="timeout")
    result = ExternalInvocationAgg(value, SETTINGS).receive(
        task("completed"), NOW + timedelta(seconds=1), outputs={"text": "ok"}
    )
    assert result.invocation.local_state == LocalState.SUCCEEDED
    assert result.invocation.outputs == {"text": "ok"}
    assert [item.kind for item in result.commands] == [CommandKind.WAKE]


def test_unknown_submission_cannot_cancel_or_retry() -> None:
    value = invocation(
        policy=WaitPolicy(on_timeout=TimeoutPolicy.CANCEL_AND_RETRY),
        remote_task_id=None,
        submission_state=SubmissionState.UNKNOWN,
    )
    result = ExternalInvocationAgg(value, SETTINGS).expire(NOW + timedelta(minutes=10))
    assert result.invocation.error_code == "submission_unknown"
    assert not any(item.kind in {CommandKind.CANCEL, CommandKind.RETRY} for item in result.commands)


def test_late_completion_updates_remote_history_without_restoring_outputs() -> None:
    ended = ExternalInvocationAgg(invocation(), SETTINGS).expire(NOW + timedelta(minutes=10)).invocation
    observed = ExternalInvocationAgg(ended, SETTINGS).receive(task("completed"), NOW + timedelta(minutes=11))
    assert observed.invocation.local_state == LocalState.ENDED
    assert observed.invocation.remote_state == "completed"
    assert observed.invocation.outputs is None
    assert observed.invocation.ended_at == ended.ended_at
    assert observed.commands == ()


def test_confirmation_timeout_and_retry_interval_keep_original_call_end() -> None:
    value = invocation(cancel_state=CancelState.REQUESTED, cancellation_deadline=NOW + timedelta(seconds=30))
    ended = ExternalInvocationAgg(value, SETTINGS).expire(NOW + timedelta(seconds=30))
    assert ended.invocation.cancel_state == CancelState.UNCONFIRMED
    assert not any(item.kind == CommandKind.RETRY for item in ended.commands)
    pending = invocation(
        local_state=LocalState.RETRY_PENDING,
        ended_at=NOW,
        local_wait_ended_at=NOW,
        logical_deadline=NOW + timedelta(seconds=3),
    )
    expired = ExternalInvocationAgg(pending, SETTINGS).expire(NOW + timedelta(seconds=3))
    assert expired.invocation.ended_at == NOW


def test_output_failure_does_not_retry_remote_business() -> None:
    result = ExternalInvocationAgg(invocation(), SETTINGS).output_failed(
        task("completed"), NOW, code="output_validation_error", message="Required output missing."
    )
    assert result.invocation.local_state == LocalState.FAILED
    assert result.invocation.remote_state == "completed"
    assert not any(item.kind in {CommandKind.DISPATCH, CommandKind.RETRY} for item in result.commands)
    assert result.invocation.terminal_receipt is None


def test_correlation_conflicts_rejected_before_normalization() -> None:
    with pytest.raises(RuntimeError, match="context"):
        ExternalInvocationAgg(invocation(carried_context_id="original"), SETTINGS).validate_observation(
            task("completed", context_id="different")
        )


def test_full_context_scope_and_debug_isolation() -> None:
    first = context_key(invocation())
    assert first is not None
    assert first.frame_scope == ""
    assert context_key(invocation(identity=replace(invocation().identity, binding_epoch="new"))) != first
    assert context_key(invocation(connection_revision_id="new-revision")) != first
    loop = context_key(invocation(identity=replace(invocation().identity, frame_id="container:iteration:0")))
    assert loop is not None
    assert loop.frame_scope == "container:iteration:0"
    assert context_key(invocation(scope=replace(invocation().scope, origin="node_debug"))) is None


def test_denied_read_does_not_change_accepted_submission_or_reschedule_queries() -> None:
    result = ExternalInvocationAgg(invocation(), SETTINGS).observation_failed(
        NOW, code="permission_denied", message="External service rejected access."
    )
    assert result.invocation.submission_state == SubmissionState.ACCEPTED
    assert result.invocation.remote_state == "working"
    assert [item.kind for item in result.commands] == [CommandKind.WAKE]
