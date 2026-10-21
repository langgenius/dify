"""Durable recovery handoff for RAG pipeline queue payloads."""

from typing import Protocol

from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.rag_pipeline.tenant_task_queue import (
    RagPipelineTaskClaimLostError,
    RagPipelineTenantTaskQueue,
)


class PipelinePayloadRecoveryMetadataMissingError(RuntimeError):
    """A rolling-upgrade queue payload has no exact document owner chain."""


class PipelinePayloadRecoveryWriter(Protocol):
    def enqueue_pipeline_payload_recovery(
        self,
        ref: DocumentRef,
        *,
        expected_generation: str,
        actor_id: str | None = None,
    ) -> bool: ...


def persist_pipeline_payload_recovery(
    *,
    queue: RagPipelineTenantTaskQueue,
    receipt: str,
    tenant_id: str,
    documents: PipelinePayloadRecoveryWriter,
) -> None:
    """Persist exact-generation repair work before a queue payload is discarded."""

    task = queue.get_claimed_task(receipt)
    if task is None:
        raise RagPipelineTaskClaimLostError(f"RAG pipeline queue claim was lost during recovery: {receipt}")
    if not task.document_recoveries:
        raise PipelinePayloadRecoveryMetadataMissingError(
            f"RAG pipeline queue claim has no document recovery metadata: {receipt}"
        )
    for recovery in task.document_recoveries:
        documents.enqueue_pipeline_payload_recovery(
            DatasetRef(tenant_id, recovery.dataset_id).document(recovery.document_id),
            expected_generation=recovery.indexing_generation,
            actor_id=recovery.actor_id,
        )
