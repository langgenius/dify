from contextlib import contextmanager
from datetime import datetime, timedelta
from threading import Event
from unittest.mock import Mock

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
    def heartbeat(lease: WorkflowHandoffLease):
        captured_leases.append(lease)
        lifecycle.append("enter")
        yield
        lifecycle.append("exit")

    dispatcher = Mock()
    dispatcher.dispatch.side_effect = lambda request: lifecycle.append("dispatch")
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

    def renew_lease(**kwargs) -> bool:
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
