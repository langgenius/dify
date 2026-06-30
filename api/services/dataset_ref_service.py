"""Typed resource references for dataset ownership chains."""

from typing import NamedTuple

from models.dataset import Dataset, Document


class DatasetRef(NamedTuple):
    """Dataset identifiers used to scope downstream resource lookups."""

    tenant_id: str
    dataset_id: str


class DocumentRef(NamedTuple):
    """Document identifiers used to scope downstream resource lookups."""

    tenant_id: str
    dataset_id: str
    document_id: str


class SegmentRef(NamedTuple):
    """Segment identifiers used to scope downstream resource lookups."""

    tenant_id: str
    dataset_id: str
    document_id: str
    segment_id: str


class DatasetRefService:
    """Factory helpers for dataset, document, and segment refs."""

    @staticmethod
    def create_dataset_ref(dataset: Dataset) -> DatasetRef:
        return DatasetRef(tenant_id=dataset.tenant_id, dataset_id=dataset.id)

    @staticmethod
    def create_document_ref(dataset_ref: DatasetRef, document: Document) -> DocumentRef | None:
        if document.tenant_id != dataset_ref.tenant_id or document.dataset_id != dataset_ref.dataset_id:
            return None
        return DocumentRef(
            tenant_id=dataset_ref.tenant_id,
            dataset_id=dataset_ref.dataset_id,
            document_id=document.id,
        )

    @staticmethod
    def create_segment_ref(document_ref: DocumentRef, segment_id: str) -> SegmentRef:
        return SegmentRef(
            tenant_id=document_ref.tenant_id,
            dataset_id=document_ref.dataset_id,
            document_id=document_ref.document_id,
            segment_id=segment_id,
        )
