from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import Mock, call

import pytest
from pytest_mock import MockerFixture

from models.workflow_handoff import RagPipelineHandoffGroupIdentity, RagPipelineQueueKind
from repositories.rag_pipeline_handoff_group_repository import (
    RagPipelineHandoffGroupRepository,
    RagPipelineHandoffGroupSnapshot,
)
from services.rag_pipeline.rag_pipeline_handoff_group_service import (
    RagPipelineHandoffGroupOutcome,
    RagPipelineHandoffGroupService,
)

NOW = datetime(2026, 7, 28, 12, 0, tzinfo=UTC)
IDENTITY = RagPipelineHandoffGroupIdentity(
    source_batch_id="source-batch-1",
    tenant_id="tenant-1",
    queue_kind=RagPipelineQueueKind.REGULAR,
)


def _snapshot(
    *,
    sealed_at: datetime | None = NOW,
    released_at: datetime | None = None,
    tenant_isolated: bool = True,
    has_running_workflow_runs: bool = False,
) -> RagPipelineHandoffGroupSnapshot:
    return RagPipelineHandoffGroupSnapshot(
        identity=IDENTITY,
        sealed_at=sealed_at,
        released_at=released_at,
        tenant_isolated=tenant_isolated,
        has_running_workflow_runs=has_running_workflow_runs,
    )


def _make_service(*, repository: Mock, redis: Mock) -> tuple[RagPipelineHandoffGroupService, Mock, Mock]:
    regular_enqueue = Mock()
    priority_enqueue = Mock()
    service = RagPipelineHandoffGroupService(
        repository=repository,
        regular_enqueue=regular_enqueue,
        priority_enqueue=priority_enqueue,
        redis=redis,
    )
    return service, regular_enqueue, priority_enqueue


@pytest.mark.parametrize(
    ("sealed_at", "has_running_workflow_runs", "renews_tenant_slot"),
    [
        (None, False, False),
        (NOW, True, True),
    ],
    ids=["unsealed", "running"],
)
def test_reconcile_group_waits_for_sealed_group_with_no_running_runs(
    mocker: MockerFixture,
    sealed_at: datetime | None,
    has_running_workflow_runs: bool,
    renews_tenant_slot: bool,
) -> None:
    repository = Mock(spec=RagPipelineHandoffGroupRepository)
    repository.mark_failed_documents.return_value = 0
    repository.get_group.return_value = _snapshot(
        sealed_at=sealed_at,
        has_running_workflow_runs=has_running_workflow_runs,
    )
    redis = Mock()
    service, regular_enqueue, priority_enqueue = _make_service(repository=repository, redis=redis)
    queue_class = mocker.patch("services.rag_pipeline.rag_pipeline_handoff_group_service.TenantIsolatedTaskQueue")

    outcome = service.reconcile_group(identity=IDENTITY, now=NOW)

    assert outcome == RagPipelineHandoffGroupOutcome.NOT_READY
    repository.mark_failed_documents.assert_called_once_with(identity=IDENTITY, marked_at=NOW)
    repository.mark_released_once.assert_not_called()
    redis.lock.assert_not_called()
    regular_enqueue.assert_not_called()
    priority_enqueue.assert_not_called()
    if renews_tenant_slot:
        queue_class.assert_called_once_with(IDENTITY.tenant_id, "pipeline")
        assert queue_class.return_value.set_task_waiting_time.call_args.kwargs["ttl"] >= 7 * 24 * 60 * 60
    else:
        queue_class.assert_not_called()


def test_reconcile_group_retries_after_redis_lock_is_busy(mocker: MockerFixture) -> None:
    repository = Mock(spec=RagPipelineHandoffGroupRepository)
    repository.mark_failed_documents.return_value = 0
    repository.get_group.return_value = _snapshot()
    repository.mark_released_once.return_value = True

    busy_lock = Mock()
    busy_lock.acquire.return_value = False
    acquired_lock = Mock()
    acquired_lock.acquire.return_value = True
    redis = Mock()
    redis.lock.side_effect = [busy_lock, acquired_lock]
    redis.get.return_value = "release-side-effect-already-recorded"
    service, _, _ = _make_service(repository=repository, redis=redis)
    queue_class = mocker.patch("services.rag_pipeline.rag_pipeline_handoff_group_service.TenantIsolatedTaskQueue")

    first_outcome = service.reconcile_group(identity=IDENTITY, now=NOW)
    second_outcome = service.reconcile_group(identity=IDENTITY, now=NOW)

    assert first_outcome == RagPipelineHandoffGroupOutcome.LOCK_BUSY
    assert second_outcome == RagPipelineHandoffGroupOutcome.RELEASED
    assert repository.mark_failed_documents.call_count == 2
    repository.mark_released_once.assert_called_once_with(identity=IDENTITY, released_at=NOW)
    busy_lock.release.assert_not_called()
    acquired_lock.release.assert_called_once_with()
    queue_class.assert_not_called()


def test_release_marker_prevents_duplicate_tenant_queue_release_after_database_retry(
    mocker: MockerFixture,
) -> None:
    repository = Mock(spec=RagPipelineHandoffGroupRepository)
    repository.mark_failed_documents.return_value = 0
    repository.get_group.return_value = _snapshot()
    repository.mark_released_once.side_effect = [False, True]

    lock = Mock()
    lock.acquire.return_value = True
    redis = Mock()
    redis.lock.return_value = lock
    redis.get.side_effect = [None, "1"]
    service, regular_enqueue, priority_enqueue = _make_service(repository=repository, redis=redis)

    queue = Mock()
    queue.claim_task_once.return_value = (True, "queued-source-batch")
    queue_class = mocker.patch(
        "services.rag_pipeline.rag_pipeline_handoff_group_service.TenantIsolatedTaskQueue",
        return_value=queue,
    )

    with pytest.raises(RuntimeError, match="Failed to persist RAG tenant-slot release marker"):
        service.reconcile_group(identity=IDENTITY, now=NOW)

    retry_outcome = service.reconcile_group(identity=IDENTITY, now=NOW)

    assert retry_outcome == RagPipelineHandoffGroupOutcome.RELEASED
    queue_class.assert_called_once_with(IDENTITY.tenant_id, "pipeline")
    queue.claim_task_once.assert_called_once()
    assert "release_claim" in queue.claim_task_once.call_args.kwargs["claim_key"]
    assert queue.claim_task_once.call_args.kwargs["ttl"] > 0
    regular_enqueue.assert_called_once()
    file_id, tenant_id, dispatch_token = regular_enqueue.call_args.args
    assert file_id == "queued-source-batch"
    assert tenant_id == IDENTITY.tenant_id
    assert dispatch_token.startswith("rag-pipeline-handoff:")
    priority_enqueue.assert_not_called()
    redis.set.assert_called_once()
    assert redis.set.call_args.args[1] == "1"
    assert redis.set.call_args.kwargs["ex"] > 0
    assert repository.mark_released_once.call_count == 2
    assert lock.release.call_count == 2


def test_enqueue_crash_reuses_receiver_dispatch_token_without_consuming_another_queue_item(
    mocker: MockerFixture,
) -> None:
    repository = Mock(spec=RagPipelineHandoffGroupRepository)
    repository.mark_failed_documents.return_value = 0
    repository.get_group.return_value = _snapshot()
    repository.mark_released_once.return_value = True

    lock = Mock()
    lock.acquire.return_value = True
    redis = Mock()
    redis.lock.return_value = lock
    redis.get.return_value = None
    service, regular_enqueue, _ = _make_service(repository=repository, redis=redis)

    queue = Mock()
    queue.claim_task_once.return_value = (True, "queued-source-batch")
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_handoff_group_service.TenantIsolatedTaskQueue",
        return_value=queue,
    )
    regular_enqueue.side_effect = [RuntimeError("publisher crashed after broker accepted message"), None]

    with pytest.raises(RuntimeError, match="publisher crashed"):
        service.reconcile_group(identity=IDENTITY, now=NOW)

    outcome = service.reconcile_group(identity=IDENTITY, now=NOW)

    assert outcome == RagPipelineHandoffGroupOutcome.RELEASED
    assert queue.claim_task_once.call_count == 2
    assert regular_enqueue.call_count == 2
    first_args = regular_enqueue.call_args_list[0].args
    second_args = regular_enqueue.call_args_list[1].args
    assert first_args == second_args
    assert first_args[:2] == ("queued-source-batch", IDENTITY.tenant_id)
    assert first_args[2].startswith("rag-pipeline-handoff:")
    redis.set.assert_called_once()
    repository.mark_released_once.assert_called_once_with(identity=IDENTITY, released_at=NOW)


def test_priority_group_dispatches_compatible_wrapped_queue_payload_with_token(mocker: MockerFixture) -> None:
    priority_identity = RagPipelineHandoffGroupIdentity(
        source_batch_id="priority-source-batch",
        tenant_id=IDENTITY.tenant_id,
        queue_kind=RagPipelineQueueKind.PRIORITY,
    )
    repository = Mock(spec=RagPipelineHandoffGroupRepository)
    repository.mark_failed_documents.return_value = 0
    repository.get_group.return_value = _snapshot()
    repository.mark_released_once.return_value = True
    lock = Mock()
    lock.acquire.return_value = True
    redis = Mock()
    redis.lock.return_value = lock
    redis.get.return_value = None
    service, regular_enqueue, priority_enqueue = _make_service(repository=repository, redis=redis)
    queue = Mock()
    queue.claim_task_once.return_value = (True, {"file_id": "queued-priority-batch"})
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_handoff_group_service.TenantIsolatedTaskQueue",
        return_value=queue,
    )

    outcome = service.reconcile_group(identity=priority_identity, now=NOW)

    assert outcome == RagPipelineHandoffGroupOutcome.RELEASED
    regular_enqueue.assert_not_called()
    priority_enqueue.assert_called_once()
    assert priority_enqueue.call_args.args[:2] == ("queued-priority-batch", priority_identity.tenant_id)
    assert priority_enqueue.call_args.args[2].startswith("rag-pipeline-handoff:")


def test_direct_group_marks_released_without_touching_tenant_queue(
    mocker: MockerFixture,
) -> None:
    repository = Mock(spec=RagPipelineHandoffGroupRepository)
    repository.mark_failed_documents.return_value = 0
    repository.get_group.return_value = _snapshot(tenant_isolated=False)
    repository.mark_released_once.return_value = True
    redis = Mock()
    service, regular_enqueue, priority_enqueue = _make_service(repository=repository, redis=redis)
    queue_class = mocker.patch("services.rag_pipeline.rag_pipeline_handoff_group_service.TenantIsolatedTaskQueue")

    outcome = service.reconcile_group(identity=IDENTITY, now=NOW)

    assert outcome == RagPipelineHandoffGroupOutcome.RELEASED
    repository.mark_released_once.assert_called_once_with(identity=IDENTITY, released_at=NOW)
    queue_class.assert_not_called()
    redis.lock.assert_not_called()
    redis.get.assert_not_called()
    redis.set.assert_not_called()
    regular_enqueue.assert_not_called()
    priority_enqueue.assert_not_called()


def test_failed_document_reconciliation_runs_before_already_released_short_circuit() -> None:
    repository = Mock(spec=RagPipelineHandoffGroupRepository)
    repository.mark_failed_documents.return_value = 2
    repository.get_group.return_value = _snapshot(released_at=NOW)
    redis = Mock()
    service, _, _ = _make_service(repository=repository, redis=redis)

    outcome = service.reconcile_group(identity=IDENTITY, now=NOW)

    assert outcome == RagPipelineHandoffGroupOutcome.ALREADY_RELEASED
    assert repository.mock_calls[:2] == [
        call.mark_failed_documents(identity=IDENTITY, marked_at=NOW),
        call.get_group(IDENTITY),
    ]
    repository.mark_released_once.assert_not_called()
    redis.lock.assert_not_called()


def test_scanner_seals_safe_compensation_candidate_before_reconcile() -> None:
    repository = Mock(spec=RagPipelineHandoffGroupRepository)
    repository.list_reconcilable_groups.return_value = [IDENTITY]
    repository.seal_group.return_value = 1
    repository.mark_failed_documents.return_value = 0
    repository.get_group.return_value = _snapshot(tenant_isolated=False)
    repository.mark_released_once.return_value = True
    redis = Mock()
    redis.get.return_value = None
    service, _, _ = _make_service(repository=repository, redis=redis)

    result = service.scan(now=NOW, limit=10)

    assert result.scanned == 1
    assert result.released == 1
    repository.seal_group.assert_called_once_with(identity=IDENTITY, sealed_at=NOW)


def test_scanner_does_not_seal_group_with_live_batch_heartbeat() -> None:
    repository = Mock(spec=RagPipelineHandoffGroupRepository)
    repository.list_reconcilable_groups.return_value = [IDENTITY]
    redis = Mock()
    redis.get.return_value = "alive"
    service, _, _ = _make_service(repository=repository, redis=redis)

    result = service.scan(now=NOW, limit=10)

    assert result.scanned == 1
    assert result.not_ready == 1
    repository.seal_group.assert_not_called()
    repository.get_group.assert_not_called()
