from types import SimpleNamespace
from typing import Protocol, cast
from unittest.mock import ANY, Mock

import pytest

from models.workflow_handoff import RagPipelineHandoffGroupIdentity, RagPipelineQueueKind
from services.workflow_handoff_dispatcher import WorkflowHandoffDispatchResult
from services.workflow_handoff_resume_coordinator import (
    WorkflowHandoffResumeOutcome,
    WorkflowHandoffResumeResult,
)
from services.workflow_handoff_terminal_service import WorkflowHandoffTerminalScanResult
from tasks import workflow_handoff_tasks as module


class _TaskWithExecOptions(Protocol):
    def _get_exec_options(self) -> dict[str, object]: ...


def test_scan_task_uses_capability_isolated_queue() -> None:
    task = cast(_TaskWithExecOptions, module.scan_workflow_handoffs_task)
    assert task._get_exec_options()["queue"] == module.dify_config.WORKFLOW_HANDOFF_QUEUE
    assert module.dify_config.WORKFLOW_HANDOFF_QUEUE == "workflow_handoff"


def _terminal_scan_result(**updates: int) -> WorkflowHandoffTerminalScanResult:
    values = {
        "terminal_compensated": 0,
        "terminal_compensation_errors": 0,
        "terminal_events_published": 0,
        "terminal_event_errors": 0,
        "snapshots_deleted": 0,
        "snapshots_missing": 0,
        "snapshot_gc_errors": 0,
        "cancellations_deleted": 0,
    }
    values.update(updates)
    return WorkflowHandoffTerminalScanResult(**values)


def test_scan_task_recovers_existing_rows_when_new_handoffs_are_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(module.dify_config, "WORKFLOW_HANDOFF_ENABLED", False)
    monkeypatch.setattr(module.dify_config, "WORKFLOW_HANDOFF_LEASE_SECONDS", 120)
    monkeypatch.setattr(module.dify_config, "WORKFLOW_HANDOFF_DRAIN_TIMEOUT_SECONDS", 600)
    monkeypatch.setattr(module.dify_config, "WORKFLOW_HANDOFF_MAX_ATTEMPTS", 20)
    repository = Mock()
    repository.cleanup_terminal_handoffs.return_value = 0
    repository.cleanup_completed_snapshot_gc.return_value = 0
    monkeypatch.setattr(module, "_create_repository", Mock(return_value=repository))
    dispatcher = Mock()
    dispatcher.scan.return_value = WorkflowHandoffDispatchResult(
        exhausted_failed=0,
        due=0,
        enqueued=0,
        dispatch_marked=0,
        errors=0,
        stale_prepared_failed=0,
    )
    monkeypatch.setattr(module, "WorkflowHandoffDispatcher", Mock(return_value=dispatcher))
    rag_group_service = Mock()
    rag_group_service.scan.return_value = SimpleNamespace(scanned=0, released=0, errors=0)
    monkeypatch.setattr(module, "_create_rag_handoff_group_service", Mock(return_value=rag_group_service))
    terminal_service = Mock()
    terminal_service.scan.return_value = _terminal_scan_result()
    monkeypatch.setattr(module, "_create_terminal_service", Mock(return_value=terminal_service))

    result = module.scan_workflow_handoffs_task.run()

    assert result["status"] == "ok"
    dispatcher.scan.assert_called_once()
    rag_group_service.scan.assert_called_once()
    terminal_service.scan.assert_called_once()


def test_scan_task_uses_lease_as_redispatch_window(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(module.dify_config, "WORKFLOW_HANDOFF_ENABLED", True)
    monkeypatch.setattr(module.dify_config, "WORKFLOW_HANDOFF_LEASE_SECONDS", 120)
    monkeypatch.setattr(module.dify_config, "WORKFLOW_HANDOFF_DRAIN_TIMEOUT_SECONDS", 600)
    monkeypatch.setattr(module.dify_config, "WORKFLOW_HANDOFF_MAX_ATTEMPTS", 20)
    repository = Mock()
    repository.cleanup_terminal_handoffs.return_value = 7
    repository.cleanup_completed_snapshot_gc.return_value = 8
    monkeypatch.setattr(module, "_create_repository", Mock(return_value=repository))
    dispatcher = Mock()
    dispatcher.scan.return_value = WorkflowHandoffDispatchResult(
        exhausted_failed=1,
        due=2,
        enqueued=2,
        dispatch_marked=2,
        errors=0,
        stale_prepared_failed=3,
        stale_ready_failed=4,
    )
    dispatcher_type = Mock(return_value=dispatcher)
    monkeypatch.setattr(module, "WorkflowHandoffDispatcher", dispatcher_type)
    rag_group_service = Mock()
    rag_group_service.scan.return_value = SimpleNamespace(scanned=0, released=0, errors=0)
    monkeypatch.setattr(module, "_create_rag_handoff_group_service", Mock(return_value=rag_group_service))
    terminal_service = Mock()
    terminal_service.scan.return_value = _terminal_scan_result(
        terminal_compensated=5,
        terminal_compensation_errors=1,
        terminal_events_published=4,
        terminal_event_errors=2,
        snapshots_deleted=3,
        snapshots_missing=1,
        snapshot_gc_errors=1,
        cancellations_deleted=6,
    )
    terminal_service_factory = Mock(return_value=terminal_service)
    monkeypatch.setattr(module, "_create_terminal_service", terminal_service_factory)

    result = module.scan_workflow_handoffs_task.run()

    assert result["enqueued"] == 2
    assert result["stale_prepared_failed"] == 3
    assert result["stale_ready_failed"] == 4
    assert result["rag_groups_scanned"] == 0
    assert result["rag_groups_released"] == 0
    assert result["rag_group_errors"] == 0
    assert result["terminal_compensated"] == 5
    assert result["terminal_compensation_errors"] == 1
    assert result["terminal_events_published"] == 4
    assert result["terminal_event_errors"] == 2
    assert result["snapshots_deleted"] == 3
    assert result["snapshots_missing"] == 1
    assert result["snapshot_gc_errors"] == 1
    assert result["cancellations_deleted"] == 6
    assert result["terminal_handoffs_deleted"] == 7
    assert result["completed_snapshot_gc_deleted"] == 8
    assert result["retention_errors"] == 0
    assert dispatcher.scan.call_args.kwargs["redispatch_interval"].total_seconds() == 120
    assert dispatcher.scan.call_args.kwargs["prepared_timeout"].total_seconds() == 600
    dispatcher_type.assert_called_once_with(
        repository=repository,
        enqueue=module._enqueue_workflow_handoff_resume,
    )
    rag_group_service.scan.assert_called_once_with(now=ANY, limit=module.WORKFLOW_HANDOFF_SCAN_BATCH_SIZE)
    terminal_service_factory.assert_called_once_with(repository)
    terminal_service.scan.assert_called_once_with(
        now=ANY,
        limit=module.WORKFLOW_HANDOFF_SCAN_BATCH_SIZE,
        retry_delay=ANY,
    )
    repository.cleanup_terminal_handoffs.assert_called_once_with(
        terminal_before=ANY,
        limit=module.WORKFLOW_HANDOFF_SCAN_BATCH_SIZE,
    )
    repository.cleanup_completed_snapshot_gc.assert_called_once_with(
        deleted_before=ANY,
        limit=module.WORKFLOW_HANDOFF_SCAN_BATCH_SIZE,
    )


def test_enqueue_targets_configured_queue(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(module.dify_config, "WORKFLOW_HANDOFF_QUEUE", "handoff-priority")
    apply_async = Mock()
    monkeypatch.setattr(module.resume_workflow_handoff_task, "apply_async", apply_async)

    module._enqueue_workflow_handoff_resume("handoff-1", 3)

    apply_async.assert_called_once_with(
        kwargs={"handoff_id": "handoff-1", "generation": 3},
        queue="handoff-priority",
    )


def test_rag_group_release_targets_handoff_capability_queue(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(module.dify_config, "WORKFLOW_HANDOFF_QUEUE", "handoff-priority")
    monkeypatch.setattr(module, "db", Mock(engine=object()))
    monkeypatch.setattr(module, "sessionmaker", Mock(return_value=Mock()))
    monkeypatch.setattr(module, "SQLAlchemyRagPipelineHandoffGroupRepository", Mock(return_value=Mock()))
    regular_apply_async = Mock()
    priority_apply_async = Mock()
    from tasks.rag_pipeline.priority_rag_pipeline_run_task import priority_rag_pipeline_run_task
    from tasks.rag_pipeline.rag_pipeline_run_task import rag_pipeline_run_task

    monkeypatch.setattr(rag_pipeline_run_task, "apply_async", regular_apply_async)
    monkeypatch.setattr(priority_rag_pipeline_run_task, "apply_async", priority_apply_async)
    service = module._create_rag_handoff_group_service()

    service._regular_enqueue("regular-file", "tenant-1", "regular-token")
    service._priority_enqueue("priority-file", "tenant-1", "priority-token")

    assert regular_apply_async.call_args.kwargs["queue"] == "handoff-priority"
    assert priority_apply_async.call_args.kwargs["queue"] == "handoff-priority"


def test_lease_owner_keeps_uniqueness_when_hostname_is_long() -> None:
    first = module._build_lease_owner(hostname="h" * 253, process_id=42, celery_task_id="task-a")
    second = module._build_lease_owner(hostname="h" * 253, process_id=42, celery_task_id="task-b")

    assert len(first) <= 255
    assert len(second) <= 255
    assert first != second


def test_resume_task_passes_unique_worker_identity_to_coordinator(monkeypatch: pytest.MonkeyPatch) -> None:
    # Disabling creation must not strand a durable handoff that already exists.
    monkeypatch.setattr(module.dify_config, "WORKFLOW_HANDOFF_ENABLED", False)
    repository = Mock()
    monkeypatch.setattr(module, "_create_repository", Mock(return_value=repository))
    coordinator = Mock()
    coordinator.resume.return_value = WorkflowHandoffResumeResult(
        outcome=WorkflowHandoffResumeOutcome.RESUMED,
        handoff_id="handoff-1",
        generation=3,
    )
    monkeypatch.setattr(module, "_create_resume_coordinator", Mock(return_value=coordinator))
    route_dispatcher = Mock()
    monkeypatch.setattr(module, "_create_resume_dispatcher", Mock(return_value=route_dispatcher))

    result = module.resume_workflow_handoff_task.run(handoff_id="handoff-1", generation=3)

    assert result["status"] == WorkflowHandoffResumeOutcome.RESUMED.value
    kwargs = coordinator.resume.call_args.kwargs
    assert kwargs["handoff_id"] == "handoff-1"
    assert kwargs["generation"] == 3
    assert kwargs["dispatcher"] is route_dispatcher
    assert isinstance(kwargs["lease_owner"], str)
    assert kwargs["lease_owner"]


def test_resume_task_reconciles_owning_rag_handoff_group(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(module.dify_config, "WORKFLOW_HANDOFF_ENABLED", True)
    identity = RagPipelineHandoffGroupIdentity(
        source_batch_id="source-batch-1",
        tenant_id="tenant-1",
        queue_kind=RagPipelineQueueKind.PRIORITY,
    )
    repository = Mock()
    repository.get.return_value = SimpleNamespace(
        rag_source_batch_id=identity.source_batch_id,
        rag_tenant_id=identity.tenant_id,
        rag_queue_kind=identity.queue_kind,
    )
    monkeypatch.setattr(module, "_create_repository", Mock(return_value=repository))
    coordinator = Mock()
    coordinator.resume.return_value = WorkflowHandoffResumeResult(
        outcome=WorkflowHandoffResumeOutcome.RESUMED,
        handoff_id="handoff-1",
        generation=3,
    )
    monkeypatch.setattr(module, "_create_resume_coordinator", Mock(return_value=coordinator))
    monkeypatch.setattr(module, "_create_resume_dispatcher", Mock(return_value=Mock()))
    group_service = Mock()
    monkeypatch.setattr(module, "_create_rag_handoff_group_service", Mock(return_value=group_service))

    result = module.resume_workflow_handoff_task.run(handoff_id="handoff-1", generation=3)

    assert result["status"] == WorkflowHandoffResumeOutcome.RESUMED.value
    repository.get.assert_called_once_with("handoff-1", 3)
    group_service.reconcile_group.assert_called_once_with(identity=identity, now=ANY)
