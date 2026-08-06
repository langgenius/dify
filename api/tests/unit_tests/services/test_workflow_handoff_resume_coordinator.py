from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime, timedelta
from threading import Event
from unittest.mock import Mock

import pytest

from models.workflow_handoff import (
    WorkflowHandoffResumeRoute,
    WorkflowHandoffState,
    WorkflowRunHandoff,
)
from services.workflow_handoff_resume_coordinator import (
    MappingWorkflowHandoffResumeDispatcher,
    WorkflowHandoffLease,
    WorkflowHandoffResumeCoordinator,
    WorkflowHandoffResumeOutcome,
    _WorkflowHandoffLeaseHeartbeat,
)
from services.workflow_handoff_service import WorkflowHandoffSnapshotIntegrityError


def _handoff(*, state: WorkflowHandoffState = WorkflowHandoffState.CLAIMED) -> WorkflowRunHandoff:
    handoff = WorkflowRunHandoff(
        workflow_run_id="run-1",
        generation=1,
        task_id="task-1",
        snapshot_object_key="snapshot.json",
        snapshot_schema_version="workflow-resumption-context/v1",
        snapshot_checksum="checksum",
        snapshot_size_bytes=5,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="old-worker",
    )
    handoff.state = state
    if state == WorkflowHandoffState.CLAIMED:
        handoff.lease_owner = "new-worker"
        handoff.lease_token = "019c0000-0000-7000-8000-000000000001"
    if state == WorkflowHandoffState.RESUMED:
        handoff.resumed_at = datetime(2026, 7, 28, 12, 0, 1)
    if state == WorkflowHandoffState.FAILED:
        handoff.failed_at = datetime(2026, 7, 28, 12, 0, 1)
    return handoff


def _coordinator(repository: Mock, service: Mock) -> WorkflowHandoffResumeCoordinator:
    return WorkflowHandoffResumeCoordinator(
        repository=repository,
        handoff_service=service,
        lease_duration=timedelta(seconds=120),
        retry_delay=timedelta(seconds=15),
        max_attempts=20,
        clock=lambda: datetime(2026, 7, 28, 12, 0, 1),
    )


def test_duplicate_delivery_only_dispatches_the_claim_winner() -> None:
    repository = Mock()
    service = Mock()
    claimed = _handoff()
    resumed = _handoff(state=WorkflowHandoffState.RESUMED)
    repository.claim.side_effect = [claimed, None]
    repository.renew_lease.return_value = True
    repository.get.return_value = resumed
    service.load_and_verify_state.return_value = b"state"
    dispatcher = Mock()
    coordinator = _coordinator(repository, service)
    now = datetime(2026, 7, 28, 12, 0, 0)

    winner = coordinator.resume(
        handoff_id=claimed.id,
        generation=1,
        lease_owner="worker-a",
        now=now,
        dispatcher=dispatcher,
    )
    duplicate = coordinator.resume(
        handoff_id=claimed.id,
        generation=1,
        lease_owner="worker-b",
        now=now,
        dispatcher=dispatcher,
    )

    assert winner.outcome == WorkflowHandoffResumeOutcome.RESUMED
    assert duplicate.outcome == WorkflowHandoffResumeOutcome.CLAIM_NOT_ACQUIRED
    dispatcher.dispatch.assert_called_once()


def test_transient_snapshot_load_failure_releases_claim_for_scanner_retry() -> None:
    repository = Mock()
    service = Mock()
    claimed = _handoff()
    ready = _handoff(state=WorkflowHandoffState.READY)
    repository.claim.return_value = claimed
    repository.record_failure.return_value = ready
    service.load_and_verify_state.side_effect = OSError("object storage unavailable")

    result = _coordinator(repository, service).resume(
        handoff_id=claimed.id,
        generation=1,
        lease_owner="worker-a",
        now=datetime(2026, 7, 28, 12, 0, 0),
        dispatcher=Mock(),
    )

    assert result.outcome == WorkflowHandoffResumeOutcome.RETRY_SCHEDULED
    repository.record_failure.assert_called_once()
    assert repository.record_failure.call_args.kwargs["retry_at"] == datetime(2026, 7, 28, 12, 0, 16)


def test_corrupt_snapshot_fails_permanently_without_dispatch() -> None:
    repository = Mock()
    service = Mock()
    claimed = _handoff()
    repository.claim.return_value = claimed
    repository.mark_failed.return_value = True
    service.load_and_verify_state.side_effect = WorkflowHandoffSnapshotIntegrityError("checksum mismatch")
    dispatcher = Mock()

    result = _coordinator(repository, service).resume(
        handoff_id=claimed.id,
        generation=1,
        lease_owner="worker-a",
        now=datetime(2026, 7, 28, 12, 0, 0),
        dispatcher=dispatcher,
    )

    assert result.outcome == WorkflowHandoffResumeOutcome.FAILED
    dispatcher.dispatch.assert_not_called()
    repository.mark_failed.assert_called_once()


def test_handler_return_before_acknowledgement_is_retried() -> None:
    repository = Mock()
    service = Mock()
    claimed = _handoff()
    ready = _handoff(state=WorkflowHandoffState.READY)
    repository.claim.return_value = claimed
    repository.renew_lease.return_value = True
    repository.get.return_value = claimed
    repository.record_failure.return_value = ready
    service.load_and_verify_state.return_value = b"state"

    result = _coordinator(repository, service).resume(
        handoff_id=claimed.id,
        generation=1,
        lease_owner="worker-a",
        now=datetime(2026, 7, 28, 12, 0, 0),
        dispatcher=Mock(),
    )

    assert result.outcome == WorkflowHandoffResumeOutcome.RETRY_SCHEDULED
    assert "before acknowledgement" in repository.record_failure.call_args.kwargs["error"]


def test_post_ack_stream_failure_reports_durable_failed_outcome_without_retry() -> None:
    repository = Mock()
    service = Mock()
    claimed = _handoff()
    failed = _handoff(state=WorkflowHandoffState.FAILED)
    failed.last_error = "resumed stream failed"
    failed.terminal_compensated_at = datetime(2026, 7, 28, 12, 0, 1)
    repository.claim.return_value = claimed
    repository.renew_lease.return_value = True
    repository.get.return_value = failed
    service.load_and_verify_state.return_value = b"state"
    dispatcher = Mock()
    dispatcher.dispatch.side_effect = RuntimeError("stream failed after acknowledgement")

    result = _coordinator(repository, service).resume(
        handoff_id=claimed.id,
        generation=1,
        lease_owner="worker-a",
        now=datetime(2026, 7, 28, 12, 0, 0),
        dispatcher=dispatcher,
    )

    assert result.outcome == WorkflowHandoffResumeOutcome.FAILED
    assert result.error == "resumed stream failed"
    repository.record_failure.assert_not_called()


def test_unconfigured_route_is_failed_permanently() -> None:
    repository = Mock()
    service = Mock()
    claimed = _handoff()
    repository.claim.return_value = claimed
    repository.renew_lease.return_value = True
    repository.mark_failed.return_value = True
    service.load_and_verify_state.return_value = b"state"

    result = _coordinator(repository, service).resume(
        handoff_id=claimed.id,
        generation=1,
        lease_owner="worker-a",
        now=datetime(2026, 7, 28, 12, 0, 0),
        dispatcher=MappingWorkflowHandoffResumeDispatcher({}),
    )

    assert result.outcome == WorkflowHandoffResumeOutcome.FAILED
    assert "No workflow handoff resume handler" in repository.mark_failed.call_args.kwargs["error"]


def test_route_mapping_passes_verified_request_to_callback() -> None:
    callback = Mock()
    dispatcher = MappingWorkflowHandoffResumeDispatcher({WorkflowHandoffResumeRoute.WORKFLOW: callback})
    request = Mock()
    request.handoff.resume_route = WorkflowHandoffResumeRoute.WORKFLOW

    dispatcher.dispatch(request)

    callback.assert_called_once_with(request)


def test_dispatch_is_wrapped_in_claim_lease_heartbeat() -> None:
    repository = Mock()
    service = Mock()
    claimed = _handoff()
    resumed = _handoff(state=WorkflowHandoffState.RESUMED)
    repository.claim.return_value = claimed
    repository.renew_lease.return_value = True
    repository.get.return_value = resumed
    service.load_and_verify_state.return_value = b"state"
    lifecycle: list[str] = []
    captured_leases: list[WorkflowHandoffLease] = []

    @contextmanager
    def heartbeat(lease: WorkflowHandoffLease) -> Generator[None, None, None]:
        captured_leases.append(lease)
        lifecycle.append("enter")
        yield
        lifecycle.append("exit")

    dispatcher = Mock()
    dispatcher.dispatch.side_effect = lambda _request: lifecycle.append("dispatch")
    coordinator = WorkflowHandoffResumeCoordinator(
        repository=repository,
        handoff_service=service,
        lease_duration=timedelta(seconds=120),
        retry_delay=timedelta(seconds=15),
        max_attempts=20,
        clock=lambda: datetime(2026, 7, 28, 12, 0, 1),
        lease_heartbeat_factory=heartbeat,
    )

    result = coordinator.resume(
        handoff_id=claimed.id,
        generation=1,
        lease_owner="worker-a",
        now=datetime(2026, 7, 28, 12, 0, 0),
        dispatcher=dispatcher,
    )

    assert result.outcome == WorkflowHandoffResumeOutcome.RESUMED
    assert lifecycle == ["enter", "dispatch", "exit"]
    assert captured_leases[0].lease_token == claimed.lease_token


def test_default_heartbeat_renews_until_ack_or_lease_loss() -> None:
    repository = Mock()
    renewed = Event()

    def renew_lease(**_kwargs: object) -> bool:
        renewed.set()
        return False

    repository.renew_lease.side_effect = renew_lease
    lease = WorkflowHandoffLease(
        repository=repository,
        handoff_id="handoff-1",
        generation=1,
        lease_owner="worker-a",
        lease_token="lease-token",
        lease_duration=timedelta(seconds=120),
    )
    heartbeat = _WorkflowHandoffLeaseHeartbeat(
        lease=lease,
        clock=lambda: datetime(2026, 7, 28, 12, 0, 1),
        interval=timedelta(milliseconds=1),
    )

    with heartbeat:
        assert renewed.wait(timeout=1)

    repository.renew_lease.assert_called_once_with(
        handoff_id="handoff-1",
        generation=1,
        lease_owner="worker-a",
        lease_token="lease-token",
        lease_duration=timedelta(seconds=120),
        now=datetime(2026, 7, 28, 12, 0, 1),
    )


@pytest.mark.parametrize(
    ("lease_duration", "retry_delay", "max_attempts", "error"),
    [
        (timedelta(0), timedelta(seconds=1), 1, "lease_duration must be positive"),
        (timedelta(seconds=1), timedelta(seconds=-1), 1, "retry_delay must be non-negative"),
        (timedelta(seconds=1), timedelta(seconds=1), 0, "max_attempts must be positive"),
    ],
)
def test_coordinator_rejects_invalid_retry_and_lease_settings(
    lease_duration: timedelta,
    retry_delay: timedelta,
    max_attempts: int,
    error: str,
) -> None:
    with pytest.raises(ValueError, match=error):
        WorkflowHandoffResumeCoordinator(
            repository=Mock(),
            handoff_service=Mock(),
            lease_duration=lease_duration,
            retry_delay=retry_delay,
            max_attempts=max_attempts,
        )


def test_heartbeat_rejects_non_positive_interval() -> None:
    lease = WorkflowHandoffLease(
        repository=Mock(),
        handoff_id="handoff-1",
        generation=1,
        lease_owner="worker-a",
        lease_token="lease-token",
        lease_duration=timedelta(seconds=120),
    )

    with pytest.raises(ValueError, match="heartbeat interval must be positive"):
        _WorkflowHandoffLeaseHeartbeat(
            lease=lease,
            clock=lambda: datetime(2026, 7, 28, 12, 0, 1),
            interval=timedelta(0),
        )


def test_heartbeat_survives_transient_renewal_failure() -> None:
    repository = Mock()
    second_renewal = Event()
    renewal_count = 0

    def renew_lease(**_kwargs: object) -> bool:
        nonlocal renewal_count
        renewal_count += 1
        if renewal_count == 1:
            raise RuntimeError("database temporarily unavailable")
        second_renewal.set()
        return False

    repository.renew_lease.side_effect = renew_lease
    heartbeat = _WorkflowHandoffLeaseHeartbeat(
        lease=WorkflowHandoffLease(
            repository=repository,
            handoff_id="handoff-1",
            generation=1,
            lease_owner="worker-a",
            lease_token="lease-token",
            lease_duration=timedelta(seconds=120),
        ),
        clock=lambda: datetime(2026, 7, 28, 12, 0, 1),
        interval=timedelta(milliseconds=1),
    )

    with heartbeat:
        assert second_renewal.wait(timeout=1)

    assert repository.renew_lease.call_count == 2


def test_resume_stops_before_dispatch_when_initial_lease_renewal_is_lost() -> None:
    repository = Mock()
    service = Mock()
    claimed = _handoff()
    repository.claim.return_value = claimed
    repository.renew_lease.return_value = False
    service.load_and_verify_state.return_value = b"state"
    dispatcher = Mock()

    result = _coordinator(repository, service).resume(
        handoff_id=claimed.id,
        generation=1,
        lease_owner="worker-a",
        now=datetime(2026, 7, 28, 12, 0, 0),
        dispatcher=dispatcher,
    )

    assert result.outcome == WorkflowHandoffResumeOutcome.LEASE_LOST
    assert result.error == "workflow handoff lease was lost before dispatch"
    dispatcher.dispatch.assert_not_called()


def test_post_ack_runtime_failure_reports_resumed_without_retry() -> None:
    repository = Mock()
    service = Mock()
    claimed = _handoff()
    repository.claim.return_value = claimed
    repository.renew_lease.return_value = True
    repository.get.return_value = _handoff(state=WorkflowHandoffState.RESUMED)
    service.load_and_verify_state.return_value = b"state"
    dispatcher = Mock()
    dispatcher.dispatch.side_effect = RuntimeError("stream failed after acknowledgement")

    result = _coordinator(repository, service).resume(
        handoff_id=claimed.id,
        generation=1,
        lease_owner="worker-a",
        now=datetime(2026, 7, 28, 12, 0, 0),
        dispatcher=dispatcher,
    )

    assert result.outcome == WorkflowHandoffResumeOutcome.RESUMED
    assert result.error == "stream failed after acknowledgement"
    repository.record_failure.assert_not_called()


def test_pre_ack_runtime_failure_schedules_retry_when_claim_still_exists() -> None:
    repository = Mock()
    service = Mock()
    claimed = _handoff()
    repository.claim.return_value = claimed
    repository.renew_lease.return_value = True
    repository.get.return_value = None
    repository.record_failure.return_value = _handoff(state=WorkflowHandoffState.READY)
    service.load_and_verify_state.return_value = b"state"
    dispatcher = Mock()
    dispatcher.dispatch.side_effect = RuntimeError("plugin startup failed")

    result = _coordinator(repository, service).resume(
        handoff_id=claimed.id,
        generation=1,
        lease_owner="worker-a",
        now=datetime(2026, 7, 28, 12, 0, 0),
        dispatcher=dispatcher,
    )

    assert result.outcome == WorkflowHandoffResumeOutcome.RETRY_SCHEDULED
    assert result.error == "plugin startup failed"


@pytest.mark.parametrize(
    ("current", "expected", "error"),
    [
        (None, WorkflowHandoffResumeOutcome.LEASE_LOST, "workflow handoff disappeared after dispatch"),
        (_handoff(state=WorkflowHandoffState.FAILED), WorkflowHandoffResumeOutcome.FAILED, None),
    ],
)
def test_dispatch_result_reflects_missing_or_failed_durable_state(
    current: WorkflowRunHandoff | None,
    expected: WorkflowHandoffResumeOutcome,
    error: str | None,
) -> None:
    repository = Mock()
    service = Mock()
    claimed = _handoff()
    repository.claim.return_value = claimed
    repository.renew_lease.return_value = True
    repository.get.return_value = current
    service.load_and_verify_state.return_value = b"state"

    result = _coordinator(repository, service).resume(
        handoff_id=claimed.id,
        generation=1,
        lease_owner="worker-a",
        now=datetime(2026, 7, 28, 12, 0, 0),
        dispatcher=Mock(),
    )

    assert result.outcome == expected
    assert result.error == error


def test_claim_with_incomplete_lease_identity_is_rejected() -> None:
    repository = Mock()
    service = Mock()
    claimed = _handoff()
    claimed.lease_token = None
    repository.claim.return_value = claimed

    with pytest.raises(RuntimeError, match="incomplete lease identity"):
        _coordinator(repository, service).resume(
            handoff_id=claimed.id,
            generation=1,
            lease_owner="worker-a",
            now=datetime(2026, 7, 28, 12, 0, 0),
            dispatcher=Mock(),
        )


def test_retry_without_lease_identity_reports_lease_lost() -> None:
    claimed = _handoff()
    claimed.lease_owner = None

    result = _coordinator(Mock(), Mock())._schedule_retry(
        claimed=claimed,
        error=RuntimeError("claim disappeared"),
        now=datetime(2026, 7, 28, 12, 0, 0),
    )

    assert result.outcome == WorkflowHandoffResumeOutcome.LEASE_LOST
    assert result.error == "claim disappeared"


@pytest.mark.parametrize(
    ("updated", "expected"),
    [
        (None, WorkflowHandoffResumeOutcome.LEASE_LOST),
        (_handoff(state=WorkflowHandoffState.FAILED), WorkflowHandoffResumeOutcome.FAILED),
    ],
)
def test_retry_reports_repository_terminal_or_lease_outcome(
    updated: WorkflowRunHandoff | None,
    expected: WorkflowHandoffResumeOutcome,
) -> None:
    repository = Mock()
    repository.record_failure.return_value = updated
    claimed = _handoff()

    result = _coordinator(repository, Mock())._schedule_retry(
        claimed=claimed,
        error=RuntimeError("resume setup failed"),
        now=datetime(2026, 7, 28, 12, 0, 0),
    )

    assert result.outcome == expected


def test_permanent_failure_reports_lease_lost_when_fenced_update_loses() -> None:
    repository = Mock()
    service = Mock()
    claimed = _handoff()
    repository.claim.return_value = claimed
    repository.mark_failed.return_value = False
    service.load_and_verify_state.side_effect = WorkflowHandoffSnapshotIntegrityError("checksum mismatch")

    result = _coordinator(repository, service).resume(
        handoff_id=claimed.id,
        generation=1,
        lease_owner="worker-a",
        now=datetime(2026, 7, 28, 12, 0, 0),
        dispatcher=Mock(),
    )

    assert result.outcome == WorkflowHandoffResumeOutcome.LEASE_LOST
