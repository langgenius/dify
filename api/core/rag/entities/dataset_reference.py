"""Framework-neutral owner chains for knowledge resources."""

from __future__ import annotations

from typing import NamedTuple


class DatasetRef(NamedTuple):
    """Identify a dataset inside its owning workspace."""

    tenant_id: str
    dataset_id: str

    def document(self, document_id: str) -> DocumentRef:
        """Bind a document identifier to this trusted dataset owner."""

        return DocumentRef(dataset=self, document_id=document_id)


class DocumentRef(NamedTuple):
    """Identify a document through its complete dataset owner chain."""

    dataset: DatasetRef
    document_id: str

    def segment(self, segment_id: str) -> SegmentRef:
        """Bind a segment identifier to this trusted document owner."""

        return SegmentRef(document=self, segment_id=segment_id)

    def matches(self, *, tenant_id: str, dataset_id: str, document_id: str) -> bool:
        """Return whether raw resource identifiers belong to this reference."""

        return (
            tenant_id == self.dataset.tenant_id
            and dataset_id == self.dataset.dataset_id
            and document_id == self.document_id
        )


class SegmentRef(NamedTuple):
    """Identify a segment through its complete document owner chain."""

    document: DocumentRef
    segment_id: str

    def matches(self, *, tenant_id: str, dataset_id: str, document_id: str, segment_id: str) -> bool:
        """Return whether raw resource identifiers belong to this reference."""

        return (
            self.document.matches(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_id=document_id,
            )
            and segment_id == self.segment_id
        )
