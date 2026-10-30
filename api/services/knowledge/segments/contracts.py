"""Detached data contracts shared by segment use cases and their adapters."""

from dataclasses import dataclass
from datetime import datetime

from services.knowledge.dataset_access import DatasetAccessSnapshot
from services.knowledge.entities.resource_scope import DatasetRef, DocumentRef
from services.knowledge.entities.segments import (
    ChildChunkRecord,
    SegmentReadSnapshot,
    SegmentRecord,
)


@dataclass(frozen=True, slots=True)
class SegmentDatasetRecord:
    id: str
    workspace_id: str
    indexing_technique: str
    embedding_model_provider: str | None
    embedding_model: str | None


@dataclass(frozen=True, slots=True)
class SegmentDocumentRecord:
    id: str
    dataset_id: str
    workspace_id: str
    doc_form: str

    @property
    def ref(self) -> DocumentRef:
        return DatasetRef(self.workspace_id, self.dataset_id).document(self.id)


@dataclass(frozen=True, slots=True)
class SegmentScope:
    dataset: SegmentDatasetRecord | None
    document: SegmentDocumentRecord | None
    access_snapshot: DatasetAccessSnapshot | None = None


@dataclass(frozen=True, slots=True)
class SegmentListFilter:
    page: int = 1
    limit: int = 20
    statuses: tuple[str, ...] = ()
    hit_count_gte: int | None = None
    enabled: str = "all"
    keyword: str | None = None


@dataclass(frozen=True, slots=True)
class ChildChunkListFilter:
    page: int = 1
    limit: int = 20
    keyword: str | None = None


@dataclass(frozen=True, slots=True)
class SegmentPageData[T = SegmentRecord]:
    items: tuple[T, ...]
    total: int
    total_pages: int
    page: int
    limit: int


@dataclass(frozen=True, slots=True)
class SegmentPage(SegmentPageData[SegmentRecord]):
    doc_form: str


@dataclass(frozen=True, slots=True)
class SegmentDetail[T = SegmentRecord]:
    data: T
    doc_form: str


@dataclass(frozen=True, slots=True)
class ChildChunkPage:
    items: tuple[ChildChunkRecord, ...]
    total: int
    total_pages: int
    page: int
    limit: int


@dataclass(frozen=True, slots=True)
class SegmentBatchImport:
    job_id: str
    job_status: str


@dataclass(frozen=True, slots=True)
class ChildChunkState:
    data: ChildChunkRecord
    index_node_id: str | None
    index_node_hash: str | None
    created_by: str
    updated_by: str | None = None


@dataclass(frozen=True, slots=True)
class SegmentIndexTarget:
    id: str
    index_node_id: str | None
    enabled: bool


@dataclass(frozen=True, slots=True)
class SegmentStatusState:
    id: str
    enabled: bool
    disabled_at: datetime | None
    disabled_by: str | None
    error: str | None


@dataclass(frozen=True, slots=True)
class SegmentStatusTransition:
    previous: SegmentStatusState
    applied: SegmentStatusState


@dataclass(frozen=True, slots=True)
class SegmentCreateRecord:
    segment_id: str
    content: str
    answer: str | None
    word_count: int
    tokens: int
    index_node_id: str
    index_node_hash: str
    created_by: str
    indexing_at: datetime
    completed_at: datetime
    attachment_ids: tuple[str, ...] = ()


class SegmentDocumentMutationBusyError(RuntimeError):
    """The owning document has queued or active full-document indexing."""


@dataclass(frozen=True, slots=True)
class SegmentUpdateState:
    """Persisted fields needed to decide a segment update."""

    content: str
    enabled: bool
    keywords: tuple[str, ...] | None
    answer: str | None = None
    status: str = "completed"


@dataclass(frozen=True, slots=True)
class SegmentMutationScope:
    """Authorized dataset and document values for shared mutation policy."""

    dataset: SegmentDatasetRecord
    document: SegmentDocumentRecord

    def __post_init__(self) -> None:
        if self.document.dataset_id != self.dataset.id or self.document.workspace_id != self.dataset.workspace_id:
            raise ValueError("Document does not belong to the dataset")


__all__ = [
    "ChildChunkListFilter",
    "ChildChunkPage",
    "ChildChunkState",
    "SegmentBatchImport",
    "SegmentCreateRecord",
    "SegmentDatasetRecord",
    "SegmentDetail",
    "SegmentDocumentMutationBusyError",
    "SegmentDocumentRecord",
    "SegmentIndexTarget",
    "SegmentListFilter",
    "SegmentMutationScope",
    "SegmentPage",
    "SegmentPageData",
    "SegmentReadSnapshot",
    "SegmentScope",
    "SegmentStatusState",
    "SegmentStatusTransition",
    "SegmentUpdateState",
]
