"""One application's bounded admission queue; SQL owns accepted deliveries."""

from collections import Counter
from collections.abc import Callable
from contextlib import AbstractContextManager
from logging import Logger
from queue import Empty, Full, Queue
from threading import Event, Lock, Thread
from time import sleep

from sqlalchemy.exc import SQLAlchemyError

from core.ops.trace_data import QueuedTrace
from extensions.ext_storage import Storage
from repositories.ops_trace_delivery_repository import OpsTraceDeliveryRepository


class TraceQueue:
    def __init__(
        self,
        *,
        storage: Storage,
        delivery_repository: OpsTraceDeliveryRepository,
        publish_delivery: Callable[[str, str], None],
        open_app_context: Callable[[], AbstractContextManager],
        logger: Logger,
        max_items: int = 64,
        max_queue_bytes: int = 128 * 1024 * 1024,
        max_recording_bytes: int = 128 * 1024 * 1024,
        max_trace_bytes: int = 8 * 1024 * 1024,
    ):
        if min(max_items, max_queue_bytes, max_recording_bytes, max_trace_bytes) <= 0:
            raise ValueError("Trace budgets must be positive")
        self.storage = storage
        self.delivery_repository = delivery_repository
        self.publish_delivery = publish_delivery
        self.open_app_context = open_app_context
        self.logger = logger
        self.max_items = max_items
        self.max_queue_bytes = max_queue_bytes
        self.max_recording_bytes = max_recording_bytes
        self.max_trace_bytes = max_trace_bytes
        self.pending_traces: Queue[QueuedTrace] = Queue(maxsize=max_items)
        self.queued_bytes = 0
        self.recording_bytes = 0
        self.tenant_queued_bytes: Counter[str] = Counter()
        self.tenant_queued_items: Counter[str] = Counter()
        self.tenant_recording_bytes: Counter[str] = Counter()
        self.queue_lock = Lock()
        self.recording_lock = Lock()
        self.closed = Event()
        self.writer_thread: Thread | None = None
        self.admission_counts: Counter[str] = Counter()

    def start(self) -> None:
        with self.queue_lock:
            if self.closed.is_set():
                raise RuntimeError("Trace queue is closed")
            if self.writer_thread is None:
                self.writer_thread = Thread(target=self.write_pending_traces, name="ops-trace-writer", daemon=True)
                self.writer_thread.start()

    def submit_trace(self, queued_trace: QueuedTrace) -> bool:
        tenant_id = queued_trace.provider_settings.tenant_id
        trace_size = len(queued_trace.trace_json)
        with self.queue_lock:
            reason = None
            if self.closed.is_set():
                reason = "closed"
            elif trace_size > self.max_trace_bytes:
                reason = "trace_too_large"
            elif sum(self.tenant_queued_items.values()) >= self.max_items:
                reason = "queue_items_full"
            elif self.queued_bytes + trace_size > self.max_queue_bytes:
                reason = "queue_bytes_full"
            elif self.tenant_queued_bytes[tenant_id] + trace_size > self.max_queue_bytes // 2:
                reason = "tenant_bytes_full"
            elif self.tenant_queued_items[tenant_id] >= max(1, self.max_items // 2):
                reason = "tenant_items_full"
            if reason is None:
                try:
                    self.pending_traces.put_nowait(queued_trace)
                except Full:
                    reason = "queue_items_full"
            if reason:
                self.admission_counts[reason] += 1
                return False
            self.queued_bytes += trace_size
            self.tenant_queued_bytes[tenant_id] += trace_size
            self.tenant_queued_items[tenant_id] += 1
            self.admission_counts["admitted"] += 1
            return True

    def reserve_recording_bytes(self, tenant_id: str, byte_count: int) -> bool:
        if byte_count < 0:
            raise ValueError("Negative recording reservation")
        with self.recording_lock:
            if (
                self.closed.is_set()
                or self.recording_bytes + byte_count > self.max_recording_bytes
                or self.tenant_recording_bytes[tenant_id] + byte_count > self.max_recording_bytes // 2
            ):
                return False
            self.recording_bytes += byte_count
            self.tenant_recording_bytes[tenant_id] += byte_count
            return True

    def release_recording_bytes(self, tenant_id: str, byte_count: int) -> None:
        with self.recording_lock:
            if byte_count < 0 or byte_count > self.tenant_recording_bytes[tenant_id]:
                raise ValueError("Invalid recording release")
            self.recording_bytes -= byte_count
            self.tenant_recording_bytes[tenant_id] -= byte_count
            if not self.tenant_recording_bytes[tenant_id]:
                del self.tenant_recording_bytes[tenant_id]

    def write_pending_traces(self) -> None:
        while True:
            try:
                queued_trace = self.pending_traces.get(timeout=0.1)
            except Empty:
                if self.closed.is_set():
                    return
                continue
            try:
                with self.open_app_context():
                    self.write_trace(queued_trace)
            except Exception:
                with self.queue_lock:
                    self.admission_counts["write_failed"] += 1
                self.logger.warning(
                    "OPS trace admission lost tenant_id=%s export_id=%s",
                    queued_trace.provider_settings.tenant_id,
                    queued_trace.export_id,
                )
            finally:
                with self.queue_lock:
                    tenant_id = queued_trace.provider_settings.tenant_id
                    trace_size = len(queued_trace.trace_json)
                    self.queued_bytes -= trace_size
                    self.tenant_queued_bytes[tenant_id] -= trace_size
                    self.tenant_queued_items[tenant_id] -= 1
                    if not self.tenant_queued_items[tenant_id]:
                        del self.tenant_queued_items[tenant_id]
                        del self.tenant_queued_bytes[tenant_id]
                self.pending_traces.task_done()

    def write_trace(self, queued_trace: QueuedTrace) -> None:
        for reservation_attempt in range(3):
            try:
                delivery, owns_upload = self.delivery_repository.reserve_delivery(queued_trace)
                break
            except SQLAlchemyError:
                if reservation_attempt == 2:
                    raise
                sleep(0.1 * (reservation_attempt + 1))
        else:
            raise RuntimeError("Trace reservation attempts exhausted")
        if owns_upload:
            for upload_attempt in range(3):
                try:
                    self.storage.save(delivery.trace_storage_key(), queued_trace.trace_json)
                    break
                except Exception:
                    if upload_attempt == 2:
                        raise
                    sleep(0.1 * (upload_attempt + 1))
            if not self.delivery_repository.accept_upload(delivery):
                raise ValueError("upload_lease_expired")
        elif delivery.status not in ("pending", "sending", "succeeded"):
            raise ValueError("delivery_not_accepted")
        if owns_upload or delivery.status == "pending":
            try:
                self.publish_delivery(delivery.tenant_id, delivery.id)
            except Exception:
                # The committed pending row is sufficient for periodic recovery.
                self.logger.warning(
                    "OPS trace publication deferred tenant_id=%s delivery_id=%s", delivery.tenant_id, delivery.id
                )

    def close(self, deadline_seconds: float = 5) -> None:
        with self.queue_lock:
            self.closed.set()
            writer_thread = self.writer_thread
        if writer_thread:
            writer_thread.join(timeout=deadline_seconds)
