"""Asynchronously classify empty KnowledgeFS Workflow retrievals for quality follow-up."""

from __future__ import annotations

import logging
import uuid
from typing import Literal

from celery import shared_task
from pydantic import ValidationError

from core.db.session_factory import session_factory
from services.knowledge_fs.app_admission_service import KnowledgeFSAppAdmissionError
from services.knowledge_fs.app_execution_capability import KnowledgeResourceRef
from services.knowledge_fs.product_dto import KnowledgeFSWorkflowFailedRetrievalCapturePayload
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
)
from services.knowledge_fs.runtime import get_knowledge_fs_runtime

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_RETRY_DELAY_SECONDS = 30


@shared_task(queue="dataset", bind=True, max_retries=_MAX_RETRIES, default_retry_delay=_RETRY_DELAY_SECONDS)
def capture_workflow_failed_retrieval_task(
    self,
    *,
    event_id: str,
    tenant_id: str,
    app_id: str,
    control_space_id: str,
    query: str,
    mode: Literal["deep", "fast", "research"],
    retrieval_trace_id: str,
) -> None:
    """Re-authorize a Workflow app and ask KnowledgeFS to classify one empty retrieval.

    ``event_id`` is the stable business idempotency key across Celery retries. Capability transport
    traces are minted independently on every attempt so uncertain delivery can be retried safely.
    """

    context = {
        "app_id": app_id,
        "control_space_id": control_space_id,
        "event_id": event_id,
        "tenant_id": tenant_id,
    }
    try:
        payload = KnowledgeFSWorkflowFailedRetrievalCapturePayload.model_validate(
            {
                "eventId": event_id,
                "query": query,
                "mode": mode,
                "retrievalTraceId": retrieval_trace_id,
            }
        )
        capability = get_knowledge_fs_runtime(session_factory.get_session_maker()).app_capabilities
        result = capability.capture_workflow_failed_retrieval(
            tenant_id=tenant_id,
            app_id=app_id,
            resource=KnowledgeResourceRef(kind="knowledge_fs", control_space_id=control_space_id),
            payload=payload,
        )
    except (
        KnowledgeFSAppAdmissionError,
        KnowledgeFSOperationUnavailableError,
        KnowledgeFSProductResourceNotFoundError,
        ValidationError,
    ):
        logger.exception("KnowledgeFS Workflow failed-retrieval capture was rejected", extra=context)
        return
    except KnowledgeFSProductRequestRejectedError as exc:
        if exc.status_code != 429:
            logger.exception("KnowledgeFS Workflow failed-retrieval capture was rejected", extra=context)
            return
        _retry_capture(self, exc=exc, context=context)
    except Exception as exc:
        _retry_capture(self, exc=exc, context=context)
    else:
        logger.info(
            "KnowledgeFS Workflow failed-retrieval capture completed",
            extra={
                **context,
                "bad_case_id": str(result.bad_case_id) if result.bad_case_id else None,
                "failed_query_id": str(result.failed_query_id),
                "verdict": result.verdict,
            },
        )


def enqueue_workflow_failed_retrieval_capture(
    *,
    tenant_id: str,
    app_id: str,
    control_space_id: str,
    query: str,
    mode: Literal["deep", "fast", "research"],
    retrieval_trace_id: str,
    event_id: str | None = None,
) -> None:
    """Best-effort dispatch that never changes the completed Workflow node outcome."""

    capture_event_id = event_id or str(uuid.uuid4())
    try:
        payload = KnowledgeFSWorkflowFailedRetrievalCapturePayload.model_validate(
            {
                "eventId": capture_event_id,
                "query": query,
                "mode": mode,
                "retrievalTraceId": retrieval_trace_id,
            }
        )
        capture_workflow_failed_retrieval_task.delay(
            event_id=str(payload.event_id),
            tenant_id=tenant_id,
            app_id=app_id,
            control_space_id=control_space_id,
            query=payload.query,
            mode=payload.mode,
            retrieval_trace_id=payload.retrieval_trace_id,
        )
    except Exception:
        logger.exception(
            "Failed to enqueue KnowledgeFS Workflow failed-retrieval capture",
            extra={
                "app_id": app_id,
                "control_space_id": control_space_id,
                "event_id": capture_event_id,
                "tenant_id": tenant_id,
            },
        )


def _retry_capture(self, *, exc: Exception, context: dict[str, str]) -> None:
    if self.request.retries >= _MAX_RETRIES:
        logger.exception(
            "KnowledgeFS Workflow failed-retrieval capture retry budget exhausted",
            extra=context,
        )
        raise exc
    logger.warning(
        "KnowledgeFS Workflow failed-retrieval capture failed; scheduling retry %d/%d",
        self.request.retries + 1,
        _MAX_RETRIES,
        extra=context,
        exc_info=True,
    )
    raise self.retry(exc=exc, countdown=_RETRY_DELAY_SECONDS * (2**self.request.retries))


__all__ = [
    "capture_workflow_failed_retrieval_task",
    "enqueue_workflow_failed_retrieval_capture",
]
