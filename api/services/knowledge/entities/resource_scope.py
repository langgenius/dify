"""Typed owner chains used by knowledge application and persistence ports."""

from __future__ import annotations

from typing import NamedTuple


class DatasetRef(NamedTuple):
    """Identify a dataset inside its owning workspace."""

    tenant_id: str
    dataset_id: str

    def document(self, document_id: str) -> DocumentRef:
        return DocumentRef(dataset=self, document_id=document_id)


class DocumentRef(NamedTuple):
    """Identify a document through its complete dataset owner chain."""

    dataset: DatasetRef
    document_id: str

    def segment(self, segment_id: str) -> SegmentRef:
        return SegmentRef(document=self, segment_id=segment_id)


class SegmentRef(NamedTuple):
    """Identify a segment through its complete document owner chain."""

    document: DocumentRef
    segment_id: str
