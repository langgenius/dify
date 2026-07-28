from __future__ import annotations

import logging
import os
import socket
import threading
import uuid
from collections.abc import Generator, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, Future, wait
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import RagPipelineGenerateEntity
from core.app.entities.task_entities import WorkflowMaintenancePausedBlockingResponse
from core.rag.pipeline.queue import TenantIsolatedTaskQueue, TenantTaskDispatchClaimOutcome
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dataset import Document
from models.enums import IndexingStatus
from models.workflow_handoff import (
    RAG_PIPELINE_QUEUE_KIND_EXTRA_KEY,
    RAG_PIPELINE_SOURCE_BATCH_ID_EXTRA_KEY,
    RAG_PIPELINE_TENANT_ID_EXTRA_KEY,
    RAG_PIPELINE_TENANT_ISOLATED_EXTRA_KEY,
    RagPipelineHandoffGroupIdentity,
    RagPipelineQueueKind,
    WorkflowRunHandoff,
)

logger = logging.getLogger(__name__)

_RAG_BATCH_HEARTBEAT_INTERVAL_SECONDS = 30
_RAG_BATCH_HEARTBEAT_TTL_SECONDS = 120
RAG_PIPELINE_DISPATCH_RETRY_SECONDS = 30
RAG_PIPELINE_DISPATCH_TOKEN_HEADER = "x-dify-rag-pipeline-dispatch-token"
_RAG_PIPELINE_DISPATCH_LEASE_SECONDS = 5 * 60
_RAG_PIPELINE_DISPATCH_DONE_SECONDS = 7 * 24 * 60 * 60


class RagPipelineDispatchLease:
    """Receiver-side fence for one logical tenant-queue dispatch.

    A release scanner may publish the same logical batch more than once if its
    process exits after broker publication but before recording the release.
    Only one delivery owns this renewable lease; later deliveries retry until
    the owner finishes and atomically replaces the lease with a durable done
    marker. A hard-killed Celery worker stops renewing, allowing a late-acked
    redelivery to recover after the bounded lease.
    """

    def __init__(
        self,
        *,
        queue: TenantIsolatedTaskQueue,
        dispatch_token: str,
        owner: str,
        lease_seconds: int = _RAG_PIPELINE_DISPATCH_LEASE_SECONDS,
        done_seconds: int = _RAG_PIPELINE_DISPATCH_DONE_SECONDS,
    ) -> None:
        self._queue = queue
        self._dispatch_token = dispatch_token
        self._owner = owner
        self._lease_seconds = lease_seconds
        self._done_seconds = done_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @classmethod
    def acquire(
        cls,
        *,
        tenant_id: str,
        dispatch_token: str,
        owner: str,
    ) -> tuple[TenantTaskDispatchClaimOutcome, RagPipelineDispatchLease | None]:
        queue = TenantIsolatedTaskQueue(tenant_id, "pipeline")
        outcome = queue.claim_dispatch(
            dispatch_token=dispatch_token,
            owner=owner,
            lease_ttl=_RAG_PIPELINE_DISPATCH_LEASE_SECONDS,
        )
        if outcome != TenantTaskDispatchClaimOutcome.ACQUIRED:
            return outcome, None
        lease = cls(queue=queue, dispatch_token=dispatch_token, owner=owner)
        lease.start()
        return outcome, lease

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._renew_loop,
            name="rag-pipeline-dispatch-lease",
            daemon=True,
        )
        self._thread.start()

    def complete(self) -> None:
        try:
            completed = self._queue.complete_dispatch_claim(
                dispatch_token=self._dispatch_token,
                owner=self._owner,
                done_ttl=self._done_seconds,
            )
        finally:
            # Keep renewing while the completion CAS is in flight so a slow
            # Redis response cannot open a takeover window before DONE lands.
            self._stop_renewal()
        if not completed:
            raise RuntimeError("RAG pipeline dispatch lease was lost before completion")

    def abandon(self) -> None:
        """Stop renewal while leaving the lease to expire for redelivery."""
        self._stop_renewal()

    def _stop_renewal(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1)

    def _renew_loop(self) -> None:
        renew_interval = max(1, self._lease_seconds // 3)
        while not self._stop.wait(renew_interval):
            try:
                renewed = self._queue.renew_dispatch_claim(
                    dispatch_token=self._dispatch_token,
                    owner=self._owner,
                    lease_ttl=self._lease_seconds,
                )
            except Exception:
                logger.exception("Failed to renew RAG pipeline dispatch lease")
                continue
            if not renewed:
                logger.error("RAG pipeline dispatch lease ownership was lost")
                return


def build_rag_pipeline_dispatch_owner(*, task_id: str | None, hostname: str | None) -> str:
    return f"{hostname or socket.gethostname()}:{os.getpid()}:{task_id or uuid.uuid4()}"


def resolve_rag_pipeline_dispatch_token(
    *,
    explicit_token: str | None,
    request_headers: Mapping[str, object] | None,
) -> str | None:
    """Read the token from an optional argument or a rolling-safe header.

    Producers put new tokens in Celery headers rather than task kwargs, so an
    older worker can still deserialize the original two-argument task during
    an adjacent-version rolling deployment.
    """
    if explicit_token is not None:
        return explicit_token
    if request_headers is None:
        return None
    header_token = request_headers.get(RAG_PIPELINE_DISPATCH_TOKEN_HEADER)
    return header_token if isinstance(header_token, str) else None


def resolve_rag_batch_tenant_isolation(payloads: object) -> bool:
    """Read rolling-update-safe ownership metadata from an uploaded batch.

    Old producers omit the field and historically all workers performed the
    tenant-isolated cleanup, so missing values deliberately default to True.
    """
    if not isinstance(payloads, Sequence) or isinstance(payloads, str | bytes | bytearray):
        raise ValueError("RAG pipeline batch must be a sequence of invoke entities")
    ownership: set[bool] = set()
    for payload in payloads:
        if not isinstance(payload, Mapping):
            raise ValueError("RAG pipeline batch contains an invalid invoke entity")
        tenant_isolated = payload.get("tenant_isolated")
        if tenant_isolated is None:
            tenant_isolated = True
        if not isinstance(tenant_isolated, bool):
            raise ValueError("RAG pipeline tenant isolation metadata must be boolean")
        ownership.add(tenant_isolated)
    if len(ownership) > 1:
        raise ValueError("RAG pipeline batch has inconsistent tenant isolation metadata")
    return next(iter(ownership), True)


def refresh_rag_pipeline_batch_heartbeat(heartbeat_key: str) -> None:
    redis_client.setex(heartbeat_key, _RAG_BATCH_HEARTBEAT_TTL_SECONDS, 1)


def wait_for_rag_pipeline_futures(*, futures: Sequence[Future[bool]], heartbeat_key: str) -> bool:
    """Collect child outcomes while keeping the durable group open."""
    pending = set(futures)
    batch_has_handoff = False
    refresh_rag_pipeline_batch_heartbeat(heartbeat_key)
    while pending:
        done, pending = wait(
            pending,
            timeout=_RAG_BATCH_HEARTBEAT_INTERVAL_SECONDS,
            return_when=FIRST_COMPLETED,
        )
        refresh_rag_pipeline_batch_heartbeat(heartbeat_key)
        for future in done:
            try:
                batch_has_handoff = future.result() or batch_has_handoff
            except Exception:
                logger.exception("Error in pipeline task")
    return batch_has_handoff


def attach_rag_handoff_group_metadata(
    entity: RagPipelineGenerateEntity,
    *,
    source_batch_id: str,
    tenant_id: str,
    queue_kind: RagPipelineQueueKind,
    tenant_isolated: bool,
) -> RagPipelineGenerateEntity:
    extras = {
        **entity.extras,
        RAG_PIPELINE_SOURCE_BATCH_ID_EXTRA_KEY: source_batch_id,
        RAG_PIPELINE_TENANT_ID_EXTRA_KEY: tenant_id,
        RAG_PIPELINE_QUEUE_KIND_EXTRA_KEY: queue_kind.value,
        RAG_PIPELINE_TENANT_ISOLATED_EXTRA_KEY: tenant_isolated,
    }
    return entity.model_copy(update={"extras": extras})


def response_created_workflow_handoff(response: object) -> bool:
    """Consume a background response and report its maintenance boundary."""
    if isinstance(response, WorkflowMaintenancePausedBlockingResponse):
        return True
    if isinstance(response, Mapping):
        return response.get("event") == "workflow_maintenance_paused"
    if isinstance(response, Generator):
        return any(response_created_workflow_handoff(item) for item in response)
    return False


def mark_rag_document_permanently_failed(
    *,
    entity: RagPipelineGenerateEntity,
    tenant_id: str,
    error: Exception,
    failed_at: datetime | None = None,
) -> None:
    """Best-effort owner-scoped repair for failures before GraphRunFailedEvent."""
    if entity.document_id is None:
        return
    error_text = (str(error) or error.__class__.__name__)[:4000]
    resolved_failed_at = failed_at or naive_utc_now()
    try:
        with Session(db.engine) as session, session.begin():
            document = session.scalar(
                select(Document).where(
                    Document.id == entity.document_id,
                    Document.dataset_id == entity.dataset_id,
                    Document.tenant_id == tenant_id,
                )
            )
            if document is None:
                return
            if document.indexing_status == IndexingStatus.COMPLETED:
                return
            document.indexing_status = IndexingStatus.ERROR
            document.error = error_text
            document.stopped_at = resolved_failed_at
    except Exception:
        logger.exception("Failed to mark RAG pipeline document %s as permanently failed", entity.document_id)


def rag_pipeline_failure_is_owned_by_handoff(
    *, workflow_run_id: str | None, identity: RagPipelineHandoffGroupIdentity
) -> bool:
    """Avoid declaring a document failed when a durable resume owns the run."""
    if not workflow_run_id:
        return False
    try:
        with Session(db.engine) as session:
            return bool(
                session.scalar(
                    select(
                        WorkflowRunHandoff.id,
                    )
                    .where(
                        WorkflowRunHandoff.workflow_run_id == workflow_run_id,
                        WorkflowRunHandoff.rag_source_batch_id == identity.source_batch_id,
                        WorkflowRunHandoff.rag_tenant_id == identity.tenant_id,
                        WorkflowRunHandoff.rag_queue_kind == identity.queue_kind,
                    )
                    .limit(1)
                )
            )
    except Exception:
        # A database failure also prevents the compensating ERROR update. Treat
        # ownership as possible and let the durable scanner decide on retry.
        logger.exception("Failed to inspect RAG handoff ownership for workflow run %s", workflow_run_id)
        return True


__all__ = [
    "RAG_PIPELINE_DISPATCH_RETRY_SECONDS",
    "RAG_PIPELINE_DISPATCH_TOKEN_HEADER",
    "RagPipelineDispatchLease",
    "attach_rag_handoff_group_metadata",
    "build_rag_pipeline_dispatch_owner",
    "mark_rag_document_permanently_failed",
    "rag_pipeline_failure_is_owned_by_handoff",
    "refresh_rag_pipeline_batch_heartbeat",
    "resolve_rag_batch_tenant_isolation",
    "resolve_rag_pipeline_dispatch_token",
    "response_created_workflow_handoff",
    "wait_for_rag_pipeline_futures",
]
