"""Admission and upload failures must preserve tenant budgets and accepted deliveries."""

import logging
from contextlib import nullcontext
from queue import Empty, Full
from unittest.mock import Mock, call

import pytest
from sqlalchemy.exc import SQLAlchemyError

from core.ops.trace_queue import TraceQueue
from tests.unit_tests.core.ops.test_trace_delivery import make_queued_trace


def make_queue(
    *, max_items: int = 64, max_queue_bytes: int = 134217728, max_trace_bytes: int = 8388608
) -> tuple[TraceQueue, Mock, Mock, Mock]:
    repository, storage, publish = Mock(), Mock(), Mock()
    queue = TraceQueue(
        storage=storage,
        delivery_repository=repository,
        publish_delivery=publish,
        open_app_context=nullcontext,
        logger=logging.getLogger(__name__),
        max_items=max_items,
        max_queue_bytes=max_queue_bytes,
        max_trace_bytes=max_trace_bytes,
        max_recording_bytes=100,
    )
    return queue, repository, storage, publish


@pytest.mark.parametrize("budget", ["max_items", "max_queue_bytes", "max_trace_bytes"])
def test_invalid_queue_budget_is_rejected(budget: str) -> None:
    with pytest.raises(ValueError, match="budgets must be positive"):
        make_queue(**{budget: 0})


@pytest.mark.parametrize("reason", ["trace_too_large", "queue_items_full", "queue_bytes_full", "tenant_bytes_full"])
def test_admission_rejection_does_not_charge_tenant_budget(reason: str) -> None:
    queued = make_queued_trace()
    size = len(queued.trace_json)
    queue, _, _, _ = make_queue(
        max_items=2 if reason == "queue_items_full" else 64,
        max_queue_bytes=size * (3 if reason == "queue_bytes_full" else 2),
        max_trace_bytes=size - 1 if reason == "trace_too_large" else size,
    )
    initial = {
        "trace_too_large": [],
        "queue_items_full": [queued, make_queued_trace()],
        "queue_bytes_full": [queued, make_queued_trace(), make_queued_trace()],
        "tenant_bytes_full": [queued],
    }[reason]
    for trace in initial:
        assert queue.submit_trace(trace)
    charged_bytes = queue.queued_bytes
    charged_items = dict(queue.tenant_queued_items)
    assert not queue.submit_trace(queued)
    assert queue.admission_counts[reason] == 1
    assert queue.queued_bytes == charged_bytes
    assert dict(queue.tenant_queued_items) == charged_items


def test_full_underlying_queue_does_not_charge_admission(monkeypatch: pytest.MonkeyPatch) -> None:
    queue, _, _, _ = make_queue()
    monkeypatch.setattr(queue.pending_traces, "put_nowait", Mock(side_effect=Full))
    assert not queue.submit_trace(make_queued_trace())
    assert queue.admission_counts["queue_items_full"] == 1
    assert queue.queued_bytes == 0
    assert not queue.tenant_queued_items


def test_recording_reservations_cannot_release_another_tenant_budget() -> None:
    queue, _, _, _ = make_queue()
    assert queue.reserve_recording_bytes("tenant-a", 40)
    with pytest.raises(ValueError, match="Negative recording"):
        queue.reserve_recording_bytes("tenant-a", -1)
    with pytest.raises(ValueError, match="Invalid recording release"):
        queue.release_recording_bytes("tenant-b", 1)
    with pytest.raises(ValueError, match="Invalid recording release"):
        queue.release_recording_bytes("tenant-a", -1)
    with pytest.raises(ValueError, match="Invalid recording release"):
        queue.release_recording_bytes("tenant-a", 41)
    queue.release_recording_bytes("tenant-a", 10)
    assert queue.recording_bytes == 30
    assert queue.tenant_recording_bytes["tenant-a"] == 30
    queue.release_recording_bytes("tenant-a", 30)
    assert queue.recording_bytes == 0
    assert not queue.tenant_recording_bytes["tenant-a"]
    queue.close()
    assert not queue.reserve_recording_bytes("tenant-a", 1)
    with pytest.raises(RuntimeError, match="queue is closed"):
        queue.start()


def test_start_is_idempotent_and_idle_writer_waits_until_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    queue, _, _, _ = make_queue()
    reads = 0

    def read(*, timeout: float) -> None:
        nonlocal reads
        assert timeout > 0
        reads += 1
        if reads == 2:
            queue.closed.set()
        raise Empty

    monkeypatch.setattr(queue.pending_traces, "get", read)
    queue.write_pending_traces()
    assert reads == 2
    queue, _, _, _ = make_queue()
    thread = Mock()
    create_thread = Mock(return_value=thread)
    monkeypatch.setattr("core.ops.trace_queue.Thread", create_thread)
    queue.start()
    queue.start()
    queue.close(deadline_seconds=0.5)
    create_thread.assert_called_once()
    thread.start.assert_called_once()
    thread.join.assert_called_once_with(timeout=0.5)


@pytest.mark.parametrize("failed_step", ["reservation", "upload"])
@pytest.mark.parametrize("recovers", [False, True])
def test_write_retries_transient_failures_before_acceptance(
    monkeypatch: pytest.MonkeyPatch, failed_step: str, recovers: bool
) -> None:
    queue, repository, storage, publish = make_queue()
    queued = make_queued_trace()
    delivery = Mock(tenant_id=queued.provider_settings.tenant_id, id=queued.export_id)
    repository.reserve_delivery.return_value = delivery, True
    repository.accept_upload.return_value = True
    failure = (
        SQLAlchemyError("database unavailable") if failed_step == "reservation" else OSError("storage unavailable")
    )
    operation = repository.reserve_delivery if failed_step == "reservation" else storage.save
    success = (delivery, True) if failed_step == "reservation" else None
    operation.side_effect = [failure, failure, success if recovers else failure]
    sleep = Mock()
    monkeypatch.setattr("core.ops.trace_queue.sleep", sleep)
    if recovers:
        queue.write_trace(queued)
        repository.accept_upload.assert_called_once_with(delivery)
        publish.assert_called_once_with(delivery.tenant_id, delivery.id)
    else:
        with pytest.raises(type(failure), match="unavailable"):
            queue.write_trace(queued)
        repository.accept_upload.assert_not_called()
        publish.assert_not_called()
    assert operation.call_count == 3
    assert sleep.call_args_list == [call(0.1), call(0.2)]


@pytest.mark.parametrize("status", ["pending", "sending", "succeeded", "staging", "cancelled"])
def test_duplicate_delivery_never_uploads_again(status: str) -> None:
    queue, repository, storage, publish = make_queue()
    queued = make_queued_trace()
    delivery = Mock(tenant_id=queued.provider_settings.tenant_id, id=queued.export_id, status=status)
    repository.reserve_delivery.return_value = delivery, False
    if status in {"staging", "cancelled"}:
        with pytest.raises(ValueError, match="delivery_not_accepted"):
            queue.write_trace(queued)
    else:
        queue.write_trace(queued)
    storage.save.assert_not_called()
    repository.accept_upload.assert_not_called()
    if status == "pending":
        publish.assert_called_once_with(delivery.tenant_id, delivery.id)
    else:
        publish.assert_not_called()


def test_expired_upload_lease_never_publishes_delivery() -> None:
    queue, repository, storage, publish = make_queue()
    queued = make_queued_trace()
    delivery = Mock()
    repository.reserve_delivery.return_value = delivery, True
    repository.accept_upload.return_value = False
    with pytest.raises(ValueError, match="upload_lease_expired"):
        queue.write_trace(queued)
    storage.save.assert_called_once_with(delivery.trace_storage_key.return_value, queued.trace_json)
    publish.assert_not_called()
