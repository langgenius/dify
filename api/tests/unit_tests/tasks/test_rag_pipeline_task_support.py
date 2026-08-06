from collections.abc import Generator
from concurrent.futures import Future
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock

import pytest
from pytest_mock import MockerFixture

from core.app.entities.app_invoke_entities import RagPipelineGenerateEntity
from core.app.entities.task_entities import WorkflowMaintenancePausedBlockingResponse
from core.rag.pipeline.queue import TenantTaskDispatchClaimOutcome
from models.enums import IndexingStatus
from models.workflow_handoff import (
    RAG_PIPELINE_QUEUE_KIND_EXTRA_KEY,
    RAG_PIPELINE_SOURCE_BATCH_ID_EXTRA_KEY,
    RAG_PIPELINE_TENANT_ID_EXTRA_KEY,
    RAG_PIPELINE_TENANT_ISOLATED_EXTRA_KEY,
    RagPipelineHandoffGroupIdentity,
    RagPipelineQueueKind,
)
from tasks.rag_pipeline.rag_pipeline_task_support import (
    RAG_PIPELINE_DISPATCH_TOKEN_HEADER,
    RagPipelineDispatchLease,
    attach_rag_handoff_group_metadata,
    build_rag_pipeline_dispatch_owner,
    mark_rag_document_permanently_failed,
    rag_pipeline_failure_is_owned_by_handoff,
    refresh_rag_pipeline_batch_heartbeat,
    resolve_rag_batch_tenant_isolation,
    resolve_rag_pipeline_dispatch_token,
    response_created_workflow_handoff,
    wait_for_rag_pipeline_futures,
)


def test_old_batch_without_isolation_metadata_defaults_to_isolated() -> None:
    assert resolve_rag_batch_tenant_isolation([{"pipeline_id": "pipeline-1"}]) is True


@pytest.mark.parametrize("tenant_isolated", [True, False])
def test_batch_uses_embedded_isolation_metadata(tenant_isolated: bool) -> None:
    assert resolve_rag_batch_tenant_isolation([{"tenant_isolated": tenant_isolated}]) is tenant_isolated


def test_batch_rejects_mixed_isolation_metadata() -> None:
    with pytest.raises(ValueError, match="inconsistent"):
        resolve_rag_batch_tenant_isolation([{"tenant_isolated": True}, {"tenant_isolated": False}])


def test_batch_rejects_non_boolean_isolation_metadata() -> None:
    with pytest.raises(ValueError, match="must be boolean"):
        resolve_rag_batch_tenant_isolation([{"tenant_isolated": "false"}])


def test_dispatch_lease_acquire_starts_only_for_the_claim_owner(mocker: MockerFixture) -> None:
    queue = Mock()
    queue.claim_dispatch.side_effect = [
        TenantTaskDispatchClaimOutcome.BUSY,
        TenantTaskDispatchClaimOutcome.DONE,
        TenantTaskDispatchClaimOutcome.ACQUIRED,
    ]
    mocker.patch(
        "tasks.rag_pipeline.rag_pipeline_task_support.TenantIsolatedTaskQueue",
        return_value=queue,
    )
    start = mocker.patch.object(RagPipelineDispatchLease, "start")

    busy = RagPipelineDispatchLease.acquire(tenant_id="tenant-1", dispatch_token="dispatch-1", owner="worker-1")
    done = RagPipelineDispatchLease.acquire(tenant_id="tenant-1", dispatch_token="dispatch-1", owner="worker-2")
    acquired = RagPipelineDispatchLease.acquire(
        tenant_id="tenant-1",
        dispatch_token="dispatch-1",
        owner="worker-3",
    )

    assert busy == (TenantTaskDispatchClaimOutcome.BUSY, None)
    assert done == (TenantTaskDispatchClaimOutcome.DONE, None)
    assert acquired[0] == TenantTaskDispatchClaimOutcome.ACQUIRED
    assert isinstance(acquired[1], RagPipelineDispatchLease)
    start.assert_called_once_with()


def test_dispatch_lease_completion_is_owner_fenced() -> None:
    queue = Mock()
    queue.complete_dispatch_claim.return_value = False
    lease = RagPipelineDispatchLease(
        queue=queue,
        dispatch_token="dispatch-1",
        owner="stale-worker",
    )

    with pytest.raises(RuntimeError, match="lease was lost"):
        lease.complete()

    queue.complete_dispatch_claim.assert_called_once()


def test_dispatch_lease_start_is_idempotent_and_complete_stops_renewal(mocker: MockerFixture) -> None:
    queue = Mock()
    queue.complete_dispatch_claim.return_value = True
    thread = Mock()
    thread_class = mocker.patch(
        "tasks.rag_pipeline.rag_pipeline_task_support.threading.Thread",
        return_value=thread,
    )
    lease = RagPipelineDispatchLease(queue=queue, dispatch_token="dispatch-1", owner="worker-1")

    lease.start()
    lease.start()
    lease.complete()

    thread_class.assert_called_once()
    thread.start.assert_called_once_with()
    thread.join.assert_called_once_with(timeout=1)
    queue.complete_dispatch_claim.assert_called_once_with(
        dispatch_token="dispatch-1",
        owner="worker-1",
        done_ttl=7 * 24 * 60 * 60,
    )


def test_dispatch_lease_abandon_stops_renewal_without_completing_claim(mocker: MockerFixture) -> None:
    queue = Mock()
    lease = RagPipelineDispatchLease(queue=queue, dispatch_token="dispatch-1", owner="worker-1")
    stop_renewal = mocker.patch.object(lease, "_stop_renewal")

    lease.abandon()

    stop_renewal.assert_called_once_with()
    queue.complete_dispatch_claim.assert_not_called()


def test_dispatch_lease_renew_loop_stops_when_ownership_is_lost() -> None:
    queue = Mock()
    queue.renew_dispatch_claim.return_value = False
    lease = RagPipelineDispatchLease(
        queue=queue,
        dispatch_token="dispatch-1",
        owner="worker-1",
        lease_seconds=3,
    )
    lease._stop = Mock()
    lease._stop.wait.return_value = False

    lease._renew_loop()

    lease._stop.wait.assert_called_once_with(1)
    queue.renew_dispatch_claim.assert_called_once_with(
        dispatch_token="dispatch-1",
        owner="worker-1",
        lease_ttl=3,
    )


def test_dispatch_lease_renew_loop_retries_after_redis_error() -> None:
    queue = Mock()
    queue.renew_dispatch_claim.side_effect = RuntimeError("redis unavailable")
    lease = RagPipelineDispatchLease(queue=queue, dispatch_token="dispatch-1", owner="worker-1")
    lease._stop = Mock()
    lease._stop.wait.side_effect = [False, True]

    lease._renew_loop()

    queue.renew_dispatch_claim.assert_called_once()


def test_dispatch_owner_distinguishes_worker_processes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("tasks.rag_pipeline.rag_pipeline_task_support.os.getpid", lambda: 42)

    assert build_rag_pipeline_dispatch_owner(task_id="celery-1", hostname="worker-a") == "worker-a:42:celery-1"


def test_dispatch_token_uses_rolling_safe_header_with_explicit_fallback_precedence() -> None:
    headers = {RAG_PIPELINE_DISPATCH_TOKEN_HEADER: "header-token"}

    assert resolve_rag_pipeline_dispatch_token(explicit_token=None, request_headers=headers) == "header-token"
    assert (
        resolve_rag_pipeline_dispatch_token(explicit_token="explicit-token", request_headers=headers)
        == "explicit-token"
    )
    assert resolve_rag_pipeline_dispatch_token(explicit_token=None, request_headers={}) is None


def test_dispatch_token_rejects_non_string_header_and_none_headers() -> None:
    assert (
        resolve_rag_pipeline_dispatch_token(
            explicit_token=None,
            request_headers={RAG_PIPELINE_DISPATCH_TOKEN_HEADER: b"not-a-string"},
        )
        is None
    )
    assert resolve_rag_pipeline_dispatch_token(explicit_token=None, request_headers=None) is None


@pytest.mark.parametrize("payloads", [None, "payload", b"payload", {"tenant_isolated": True}])
def test_batch_rejects_non_sequence_payload(payloads: object) -> None:
    with pytest.raises(ValueError, match="must be a sequence"):
        resolve_rag_batch_tenant_isolation(payloads)


def test_batch_rejects_non_mapping_entity() -> None:
    with pytest.raises(ValueError, match="invalid invoke entity"):
        resolve_rag_batch_tenant_isolation([object()])


def test_refresh_batch_heartbeat_uses_durable_ttl(mocker: MockerFixture) -> None:
    setex = mocker.patch("tasks.rag_pipeline.rag_pipeline_task_support.redis_client.setex")

    refresh_rag_pipeline_batch_heartbeat("heartbeat-key")

    setex.assert_called_once_with("heartbeat-key", 120, 1)


def test_wait_for_pipeline_futures_collects_handoff_and_ignores_child_error(mocker: MockerFixture) -> None:
    handoff = Future[bool]()
    handoff.set_result(True)
    failed = Future[bool]()
    failed.set_exception(RuntimeError("child failed"))
    refresh = mocker.patch("tasks.rag_pipeline.rag_pipeline_task_support.refresh_rag_pipeline_batch_heartbeat")

    result = wait_for_rag_pipeline_futures(futures=[handoff, failed], heartbeat_key="heartbeat-key")

    assert result is True
    assert refresh.call_count == 2
    refresh.assert_called_with("heartbeat-key")


def test_attach_handoff_group_metadata_preserves_existing_extras() -> None:
    entity = Mock()
    entity.extras = {"existing": "value"}
    copied = Mock()
    entity.model_copy.return_value = copied

    result = attach_rag_handoff_group_metadata(
        entity,
        source_batch_id="batch-1",
        tenant_id="tenant-1",
        queue_kind=RagPipelineQueueKind.PRIORITY,
        tenant_isolated=False,
    )

    assert result is copied
    assert entity.model_copy.call_args.kwargs["update"]["extras"] == {
        "existing": "value",
        RAG_PIPELINE_SOURCE_BATCH_ID_EXTRA_KEY: "batch-1",
        RAG_PIPELINE_TENANT_ID_EXTRA_KEY: "tenant-1",
        RAG_PIPELINE_QUEUE_KIND_EXTRA_KEY: "priority",
        RAG_PIPELINE_TENANT_ISOLATED_EXTRA_KEY: False,
    }


def test_response_created_workflow_handoff_recognizes_all_supported_response_shapes() -> None:
    blocking = WorkflowMaintenancePausedBlockingResponse(task_id="task-1", workflow_run_id="run-1")

    def responses() -> Generator[dict[str, str], None, None]:
        yield {"event": "message"}
        yield {"event": "workflow_maintenance_paused"}

    assert response_created_workflow_handoff(blocking) is True
    assert response_created_workflow_handoff({"event": "workflow_maintenance_paused"}) is True
    assert response_created_workflow_handoff(responses()) is True
    assert response_created_workflow_handoff({"event": "message"}) is False
    assert response_created_workflow_handoff(object()) is False


def _session_context(session: Mock) -> MagicMock:
    context = MagicMock()
    context.__enter__.return_value = session
    return context


def test_mark_rag_document_permanently_failed_updates_owned_document(mocker: MockerFixture) -> None:
    failed_at = datetime(2026, 7, 28, tzinfo=UTC)
    entity = RagPipelineGenerateEntity.model_construct(document_id="document-1", dataset_id="dataset-1")
    document = SimpleNamespace(indexing_status=IndexingStatus.INDEXING, error=None, stopped_at=None)
    session = MagicMock()
    session.scalar.return_value = document
    mocker.patch("tasks.rag_pipeline.rag_pipeline_task_support.db", SimpleNamespace(engine=object()))
    mocker.patch(
        "tasks.rag_pipeline.rag_pipeline_task_support.Session",
        return_value=_session_context(session),
    )

    mark_rag_document_permanently_failed(
        entity=entity,
        tenant_id="tenant-1",
        error=RuntimeError("pipeline failed"),
        failed_at=failed_at,
    )

    assert document.indexing_status == IndexingStatus.ERROR
    assert document.error == "pipeline failed"
    assert document.stopped_at == failed_at


@pytest.mark.parametrize("document", [None, SimpleNamespace(indexing_status=IndexingStatus.COMPLETED)])
def test_mark_rag_document_permanently_failed_preserves_missing_or_completed_document(
    mocker: MockerFixture,
    document: SimpleNamespace | None,
) -> None:
    session = MagicMock()
    session.scalar.return_value = document
    mocker.patch("tasks.rag_pipeline.rag_pipeline_task_support.db", SimpleNamespace(engine=object()))
    mocker.patch(
        "tasks.rag_pipeline.rag_pipeline_task_support.Session",
        return_value=_session_context(session),
    )

    mark_rag_document_permanently_failed(
        entity=RagPipelineGenerateEntity.model_construct(document_id="document-1", dataset_id="dataset-1"),
        tenant_id="tenant-1",
        error=RuntimeError("pipeline failed"),
    )

    if document is not None:
        assert document.indexing_status == IndexingStatus.COMPLETED


def test_mark_rag_document_permanently_failed_is_best_effort(mocker: MockerFixture) -> None:
    mocker.patch("tasks.rag_pipeline.rag_pipeline_task_support.db", SimpleNamespace(engine=object()))
    mocker.patch(
        "tasks.rag_pipeline.rag_pipeline_task_support.Session",
        side_effect=RuntimeError("database unavailable"),
    )

    mark_rag_document_permanently_failed(
        entity=RagPipelineGenerateEntity.model_construct(document_id="document-1", dataset_id="dataset-1"),
        tenant_id="tenant-1",
        error=RuntimeError(),
    )


def test_mark_rag_document_permanently_failed_skips_entity_without_document(mocker: MockerFixture) -> None:
    session_class = mocker.patch("tasks.rag_pipeline.rag_pipeline_task_support.Session")

    mark_rag_document_permanently_failed(
        entity=RagPipelineGenerateEntity.model_construct(document_id=None, dataset_id="dataset-1"),
        tenant_id="tenant-1",
        error=RuntimeError("pipeline failed"),
    )

    session_class.assert_not_called()


def test_handoff_ownership_query_returns_database_result(mocker: MockerFixture) -> None:
    identity = RagPipelineHandoffGroupIdentity(
        source_batch_id="batch-1",
        tenant_id="tenant-1",
        queue_kind=RagPipelineQueueKind.REGULAR,
    )
    session = Mock()
    session.scalar.return_value = "handoff-id"
    mocker.patch("tasks.rag_pipeline.rag_pipeline_task_support.db", SimpleNamespace(engine=object()))
    mocker.patch(
        "tasks.rag_pipeline.rag_pipeline_task_support.Session",
        return_value=_session_context(session),
    )

    assert rag_pipeline_failure_is_owned_by_handoff(workflow_run_id="run-1", identity=identity) is True
    assert session.scalar.call_count == 1


def test_handoff_ownership_is_conservative_on_database_error(mocker: MockerFixture) -> None:
    identity = RagPipelineHandoffGroupIdentity(
        source_batch_id="batch-1",
        tenant_id="tenant-1",
        queue_kind=RagPipelineQueueKind.REGULAR,
    )
    mocker.patch("tasks.rag_pipeline.rag_pipeline_task_support.db", SimpleNamespace(engine=object()))
    mocker.patch(
        "tasks.rag_pipeline.rag_pipeline_task_support.Session",
        side_effect=RuntimeError("database unavailable"),
    )

    assert rag_pipeline_failure_is_owned_by_handoff(workflow_run_id="run-1", identity=identity) is True
    assert rag_pipeline_failure_is_owned_by_handoff(workflow_run_id=None, identity=identity) is False
