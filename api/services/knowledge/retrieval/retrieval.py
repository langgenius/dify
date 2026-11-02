"""Knowledge queries and the external candidate source used internally."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from services.knowledge.entities.external import (
    ExternalRetrievalCandidate,
    ExternalRetrievalConfig,
)
from services.knowledge.entities.metadata import Condition, MetadataFilteringCondition
from services.knowledge.entities.retrieval import (
    KnowledgeRetrievalRequest,
    KnowledgeRetrievalResult,
    RetrievableDataset,
)


class KnowledgeRetriever(Protocol):
    """Retrieve final sources for an admitted caller, with privately owned sessions."""

    def list_datasets(self, *, tenant_id: str, dataset_ids: Sequence[str]) -> list[RetrievableDataset]:
        """Describe available datasets in the caller's requested order."""
        ...

    def retrieve(
        self,
        request: KnowledgeRetrievalRequest,
        *,
        request_metadata: Mapping[str, object] | None,
    ) -> KnowledgeRetrievalResult:
        """Run one query; None omits optional trace metadata for this invocation."""
        ...


@dataclass(frozen=True, slots=True)
class RetrievalDatasetSnapshot:
    """Detached dataset state required to plan one retrieval execution."""

    id: str
    tenant_id: str
    name: str
    description: str | None
    provider: str
    retrieval_model: dict[str, object] | None
    indexing_technique: str | None
    embedding_model_provider: str | None
    embedding_model: str | None


class RetrievalRepository(Protocol):
    """Persisted retrieval state and side effects, each in its own short session."""

    def list_available_datasets(
        self, *, tenant_id: str, dataset_ids: Sequence[str]
    ) -> list[RetrievalDatasetSnapshot]: ...

    def get_available_dataset(self, *, tenant_id: str, dataset_id: str) -> RetrievalDatasetSnapshot | None: ...

    def list_metadata_field_names(self, *, tenant_id: str, dataset_ids: Sequence[str]) -> list[str]: ...

    def filter_document_ids(
        self,
        *,
        tenant_id: str,
        dataset_ids: Sequence[str],
        logical_operator: str,
        conditions: Sequence[Condition] | None,
    ) -> dict[str, list[str]]: ...

    def expand_document_ids_filter(
        self, *, tenant_id: str, dataset_id: str, document_ids: Sequence[str]
    ) -> tuple[str, ...]: ...

    def record_app_query(
        self,
        *,
        tenant_id: str,
        dataset_ids: Sequence[str],
        query: str | None,
        attachment_ids: Sequence[str] | None,
        app_id: str,
        user_from: str,
        user_id: str,
    ) -> None: ...

    def increment_segment_hit_counts(self, segment_ids: Sequence[str]) -> None: ...


class ExternalDatasetRetriever(Protocol):
    """Retrieve normalized candidates from a tenant-owned external dataset."""

    def retrieve(
        self,
        *,
        tenant_id: str,
        dataset_id: str,
        query: str,
        retrieval_model: ExternalRetrievalConfig | None,
        metadata_filters: MetadataFilteringCondition | None,
    ) -> list[ExternalRetrievalCandidate]:
        """Use the dataset's effective settings when retrieval_model is None."""
        ...
