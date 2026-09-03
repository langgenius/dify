"""ORM-backed compatibility helpers for dataset ownership chains."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.entities.dataset_reference import DatasetRef, DocumentRef, SegmentRef
from models.dataset import Dataset, Document


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
        return dataset_ref.document(document_id)

    @staticmethod
    def create_segment_ref(document_ref: DocumentRef, segment_id: str) -> SegmentRef:
        """Bind a candidate segment ID; ownership is enforced when the ref is consumed."""
        return document_ref.segment(segment_id)

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
