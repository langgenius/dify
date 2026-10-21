"""Serializable contracts for queued RAG pipeline execution."""

from collections.abc import Sequence
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class RagPipelineWorkflowSnapshot(BaseModel):
    """The immutable workflow content a queued run was prepared against."""

    model_config = ConfigDict(frozen=True)

    id: str
    tenant_id: str
    app_id: str
    type: str
    kind: str | None = None
    version: str
    version_number: int | None = None
    marked_name: str
    marked_comment: str
    graph: str
    features: str
    created_by: str
    created_at: datetime
    updated_by: str | None = None
    updated_at: datetime
    environment_variables: str
    conversation_variables: str
    rag_pipeline_variables: str


class RagPipelineInvokeEntity(BaseModel):
    pipeline_id: str
    application_generate_entity: dict[str, Any]
    user_id: str
    tenant_id: str
    workflow_id: str
    workflow_snapshot: RagPipelineWorkflowSnapshot | None = None
    streaming: bool
    workflow_execution_id: str | None = None
    workflow_thread_pool_id: str | None = None
    # New snapshot-batch producers bind every document run to the generation
    # assigned by the preparation transaction.  Missing values are reserved
    # for rolling-upgrade deliveries created before generations were carried.
    indexing_generation: str | None = None


class RagPipelineInvokeBatch(BaseModel):
    """One immutable workflow snapshot shared by every invocation in a queued file."""

    workflow_snapshot: RagPipelineWorkflowSnapshot
    invoke_entities: list[RagPipelineInvokeEntity]


class RagPipelineDocumentRecovery(BaseModel):
    """Trusted document owner chain retained beside an uploaded queue payload."""

    model_config = ConfigDict(frozen=True)

    dataset_id: str
    document_id: str
    indexing_generation: str
    actor_id: str


def collect_pipeline_document_recoveries(
    invoke_entities: Sequence[RagPipelineInvokeEntity],
    *,
    tenant_id: str,
) -> tuple[RagPipelineDocumentRecovery, ...]:
    """Capture exact document generations before the uploaded payload can become unreadable."""

    recoveries: dict[tuple[str, str, str], RagPipelineDocumentRecovery] = {}
    for entity in invoke_entities:
        if entity.indexing_generation is None:
            continue
        if entity.tenant_id != tenant_id:
            raise ValueError("RAG pipeline recovery metadata tenant mismatch")
        dataset_id = entity.application_generate_entity.get("dataset_id")
        document_id = entity.application_generate_entity.get("document_id")
        if not isinstance(dataset_id, str) or not dataset_id:
            raise ValueError("RAG pipeline recovery metadata requires a dataset ID")
        if not isinstance(document_id, str) or not document_id:
            raise ValueError("RAG pipeline recovery metadata requires a document ID")
        recovery = RagPipelineDocumentRecovery(
            dataset_id=dataset_id,
            document_id=document_id,
            indexing_generation=entity.indexing_generation,
            actor_id=entity.user_id,
        )
        recoveries[(dataset_id, document_id, entity.indexing_generation)] = recovery
    return tuple(recoveries.values())
