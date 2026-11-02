"""Document inputs and persistence required by pipeline execution."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import uuid4

from models.dataset import Document


@dataclass(frozen=True)
class PipelineDocumentSeed:
    name: str
    data_source_type: str
    data_source_info: Mapping[str, Any]
    doc_metadata: Mapping[str, Any]
    id: str = field(default_factory=lambda: str(uuid4()))


class PipelineDocumentStore(Protocol):
    def prepare_pipeline_documents(
        self,
        *,
        tenant_id: str,
        pipeline_id: str,
        dataset_id: str,
        user_id: str,
        batch: str,
        start_node_id: str,
        inputs: Mapping[str, Any],
        seeds: Sequence[PipelineDocumentSeed],
        original_document_id: str | None,
    ) -> list[Document]: ...

    def exists(self, *, workspace_id: str, dataset_id: str, document_id: str) -> bool: ...
    def mark_failed(self, *, workspace_id: str, dataset_id: str, document_id: str, error: str) -> None: ...
