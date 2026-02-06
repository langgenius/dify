from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from core.rag.entities.metadata_entities import MetadataCondition


class DatasetEntity(Protocol):
    @property
    def id(self) -> str: ...

    @property
    def tenant_id(self) -> str: ...

    @property
    def provider(self) -> str: ...

    @property
    def name(self) -> str: ...

    @property
    def description(self) -> str | None: ...

    @property
    def indexing_technique(self) -> str | None: ...

    @property
    def retrieval_model(self) -> Mapping[str, Any] | None: ...


class DocumentEntity(Protocol):
    @property
    def id(self) -> str: ...

    @property
    def tenant_id(self) -> str: ...

    @property
    def dataset_id(self) -> str: ...

    @property
    def indexing_status(self) -> str: ...

    @property
    def enabled(self) -> bool: ...

    @property
    def archived(self) -> bool: ...

    @property
    def doc_metadata(self) -> dict[str, Any] | None: ...

    @property
    def name(self) -> str: ...

    @property
    def data_source_type(self) -> str: ...


class DatasetMetadataEntity(Protocol):
    @property
    def name(self) -> str: ...


class KnowledgeRepository(Protocol):
    """
    Repository interface for accessing Knowledge Base data (Datasets, Documents).
    """

    def get_datasets_with_available_documents(
        self, tenant_id: str, dataset_ids: Sequence[str]
    ) -> Sequence[DatasetEntity]:
        """
        Fetch datasets that have available documents (or are external providers).
        """
        ...

    def get_dataset(self, tenant_id: str, dataset_id: str) -> DatasetEntity | None:
        """
        Fetch a dataset by ID.
        """
        ...

    def get_document(self, tenant_id: str, document_id: str) -> DocumentEntity | None:
        """
        Fetch a single document by ID.
        """
        ...

    def get_documents_by_dataset_ids(self, tenant_id: str, dataset_ids: Sequence[str]) -> Sequence[DocumentEntity]:
        """
        Fetch documents by dataset IDs.
        """
        ...

    def get_metadata_fields(self, tenant_id: str, dataset_ids: Sequence[str]) -> Sequence[DatasetMetadataEntity]:
        """
        Fetch metadata fields for the given datasets.
        """
        ...

    def get_document_ids_by_filtering(
        self, tenant_id: str, dataset_ids: Sequence[str], filters: MetadataCondition | None
    ) -> dict[str, list[str]] | None:
        """
        Fetch document IDs grouped by dataset after applying metadata filters.
        """
        ...

    def add_rate_limit_log(self, tenant_id: str, subscription_plan: str, operation: str) -> None:
        """
        Persist a rate limit log entry.
        """
        ...

    def close_session(self) -> None:
        """
        Close the database session.
        """
        ...
