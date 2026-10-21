"""Detached data contracts shared by segment use cases and their adapters."""

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from services.knowledge.dataset_access import DatasetAccessSnapshot
from services.knowledge.entities.segments import ChildChunkRecord, SegmentRecord
from services.knowledge.resource_scope import DatasetRef, DocumentRef


class SegmentIndexingMutationError(Exception):
    """A direct parent or child mutation cannot replace an active indexing generation."""


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
class SegmentAttachmentFile:
    id: str
    name: str
    size: int
    extension: str
    mime_type: str | None


@dataclass(frozen=True, slots=True)
class SegmentFileAccess:
    uploads: frozenset[str]
    tools: frozenset[str]


@dataclass(frozen=True, slots=True)
class SegmentReadSnapshot:
    values: Mapping[str, object]
    child_chunks: tuple[ChildChunkRecord, ...]
    attachments: tuple[SegmentAttachmentFile, ...]
    summary: str | None
    file_access: SegmentFileAccess


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
class SegmentDocumentCreationState:
    indexing_status: str
    enabled: bool
    archived: bool = False


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
    status: str = "completed"
    generation: str | None = None


@dataclass(frozen=True, slots=True)
class SegmentChildIndexCompletion:
    """Parent creation state completed by its durable child-index intent."""

    generation: str
    batch_segment_ids: tuple[str, ...]
    batch_job_id: str | None = None
    expected_enabled: bool = True


class SegmentIndexReconcileOutcome(StrEnum):
    """Domain result of reconciling one durable segment-index intent."""

    COMPLETED = "completed"
    WAITING = "waiting"
    CANCELLED = "cancelled"


@dataclass(frozen=True, slots=True)
class SegmentUpdateState:
    """Persisted fields needed to decide a segment update, without presentation data."""

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
