"""Typed resource references for dataset ownership chains.

Controllers and other trust-boundary code should build these refs after
resolving and authorizing the outer resource. Downstream service queries can
then require the full tenant -> dataset -> document -> segment chain instead of
receiving loosely related raw ids.
"""

from typing import NamedTuple

from models.dataset import Dataset, Document

_DATASET_REF_CTOR_TOKEN = object()


class _DatasetRefBase(NamedTuple):
    tenant_id: str
    dataset_id: str
    ctor_token: object


class DatasetRef(_DatasetRefBase):
    """Tenant-scoped dataset reference with token-gated construction."""

    __slots__ = ()

    def __new__(cls, tenant_id: str, dataset_id: str, ctor_token: object) -> "DatasetRef":
        if ctor_token is not _DATASET_REF_CTOR_TOKEN:
            raise ValueError("DatasetRef must be created by DatasetRefService.")
        return super().__new__(cls, tenant_id, dataset_id, ctor_token)

    def __repr__(self) -> str:
        return f"DatasetRef(tenant_id={self.tenant_id!r}, dataset_id={self.dataset_id!r})"


class DocumentRef(NamedTuple):
    """Document reference bound to a trusted dataset reference."""

    dataset: DatasetRef
    document_id: str

    @property
    def tenant_id(self) -> str:
        return self.dataset.tenant_id

    @property
    def dataset_id(self) -> str:
        return self.dataset.dataset_id


class SegmentRef(NamedTuple):
    """Segment reference bound to a trusted document reference."""

    document: DocumentRef
    segment_id: str

    @property
    def tenant_id(self) -> str:
        return self.document.tenant_id

    @property
    def dataset_id(self) -> str:
        return self.document.dataset_id

    @property
    def document_id(self) -> str:
        return self.document.document_id


class DatasetRefService:
    """Factory for trusted dataset, document, and segment refs."""

    @staticmethod
    def create_dataset_ref(dataset: Dataset) -> DatasetRef:
        return DatasetRef(dataset.tenant_id, dataset.id, _DATASET_REF_CTOR_TOKEN)

    @staticmethod
    def create_document_ref(dataset_ref: DatasetRef, document: Document) -> DocumentRef | None:
        if document.tenant_id != dataset_ref.tenant_id or document.dataset_id != dataset_ref.dataset_id:
            return None
        return DocumentRef(dataset=dataset_ref, document_id=document.id)

    @staticmethod
    def create_segment_ref(document_ref: DocumentRef, segment_id: str) -> SegmentRef:
        return SegmentRef(document=document_ref, segment_id=segment_id)
