"""Compatibility helpers for building dataset ownership chains."""

from models.dataset import Dataset, Document
from services.knowledge.resource_scope import DatasetRef as _DatasetRef
from services.knowledge.resource_scope import DocumentRef as _DocumentRef
from services.knowledge.resource_scope import SegmentRef as _SegmentRef


class DatasetRefService:
    """Build child locators from validated dataset roots."""

    @staticmethod
    def create_dataset_ref(dataset: Dataset) -> _DatasetRef:
        """Create a root ref from a dataset already validated by the caller."""
        return _DatasetRef(tenant_id=dataset.tenant_id, dataset_id=dataset.id)

    @staticmethod
    def create_document_ref(dataset_ref: _DatasetRef, document: Document) -> _DocumentRef | None:
        if document.tenant_id != dataset_ref.tenant_id or document.dataset_id != dataset_ref.dataset_id:
            return None
        return DatasetRefService.create_document_ref_from_id(dataset_ref, document.id)

    @staticmethod
    def create_document_ref_from_id(dataset_ref: _DatasetRef, document_id: str) -> _DocumentRef:
        """Bind a candidate document ID; ownership is enforced when the ref is consumed."""
        return dataset_ref.document(document_id)

    @staticmethod
    def create_segment_ref(document_ref: _DocumentRef, segment_id: str) -> _SegmentRef:
        """Bind a candidate segment ID; ownership is enforced when the ref is consumed."""
        return document_ref.segment(segment_id)
