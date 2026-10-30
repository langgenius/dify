"""Document indexing values shared independently of application services."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import NamedTuple

from services.knowledge.entities.resource_scope import DatasetRef, DocumentRef

PENDING_UPLOAD_CLEANUP_IDS_KEY = "_pending_upload_cleanup_ids"


def pending_upload_cleanup_ids(source_info: Mapping[str, object] | None) -> tuple[str, ...]:
    """Return durable file-cleanup evidence stored with an indexing source."""

    if source_info is None:
        return ()
    value = source_info.get(PENDING_UPLOAD_CLEANUP_IDS_KEY)
    if not isinstance(value, list):
        return ()
    return tuple(dict.fromkeys(file_id for file_id in value if isinstance(file_id, str) and file_id))


class DatasetEstimateRecord(NamedTuple):
    """Dataset state required to estimate stored documents."""

    id: str
    workspace_id: str
    indexing_technique: str | None


class EstimateDocumentRecord(NamedTuple):
    """Document state required by the stored-document estimate use case."""

    id: str
    workspace_id: str
    dataset_id: str
    data_source_type: str
    data_source_info: Mapping[str, object] | None
    indexing_status: str
    doc_form: str
    doc_language: str | None
    dataset_process_rule_id: str | None

    @property
    def ref(self) -> DocumentRef:
        return DatasetRef(self.workspace_id, self.dataset_id).document(self.id)


class StoredSource(NamedTuple):
    """A persisted extraction source bound to its owning document."""

    document_ref: DocumentRef
    source_type: str
    source_info: Mapping[str, object] | None
    document_model: str

    @classmethod
    def from_document(cls, document: EstimateDocumentRecord) -> "StoredSource":
        return cls(
            document_ref=document.ref,
            source_type=document.data_source_type,
            source_info=document.data_source_info,
            document_model=document.doc_form,
        )


@dataclass(frozen=True)
class IndexingDocument:
    source: StoredSource
    processing_rule: Mapping[str, object]
    doc_language: str
    need_summary: bool

    @property
    def ref(self) -> DocumentRef:
        return self.source.document_ref

    @property
    def doc_form(self) -> str:
        return self.source.document_model
