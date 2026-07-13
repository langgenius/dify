"""Typed resource references for dataset ownership chains."""

from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.dataset import Dataset, Document


class DatasetRef(NamedTuple):
    """Dataset identifiers used to scope downstream resource lookups."""

    tenant_id: str
    dataset_id: str


class DocumentRef(NamedTuple):
    """Owner-bound lookup coordinates, not proof that a document is authorized or exists."""

    dataset: DatasetRef
    document_id: str


class SegmentRef(NamedTuple):
    """Segment identifiers used to scope downstream resource lookups."""

    document: DocumentRef
    segment_id: str


class DatasetRefService:
    """Build child locators from validated dataset roots and resolve them with owner predicates."""

    @staticmethod
    def create_dataset_ref(dataset: Dataset) -> DatasetRef:
        """Create a root ref from a dataset already validated by the caller."""
        return DatasetRef(tenant_id=dataset.tenant_id, dataset_id=dataset.id)

    @staticmethod
    def create_document_ref(dataset_ref: DatasetRef, document: Document) -> DocumentRef | None:
        if document.tenant_id != dataset_ref.tenant_id or document.dataset_id != dataset_ref.dataset_id:
            return None
        return DatasetRefService.create_document_ref_from_id(dataset_ref, document.id)

    @staticmethod
    def create_document_ref_from_id(dataset_ref: DatasetRef, document_id: str) -> DocumentRef:
        """Bind a candidate document ID; ownership is enforced when the ref is consumed."""
        return DocumentRef(dataset=dataset_ref, document_id=document_id)

    @staticmethod
    def create_segment_ref(document_ref: DocumentRef, segment_id: str) -> SegmentRef:
        return SegmentRef(document=document_ref, segment_id=segment_id)

    @staticmethod
    def get_document_by_ref(document_ref: DocumentRef, *, session: Session) -> Document | None:
        """Resolve a document through its complete tenant and dataset ownership chain."""
        return session.scalar(
            select(Document).where(
                Document.id == document_ref.document_id,
                Document.dataset_id == document_ref.dataset.dataset_id,
                Document.tenant_id == document_ref.dataset.tenant_id,
            )
        )
