"""Detached annotation reads shared by Console annotation endpoints.

These queries need no application orchestration. The composition root injects
their repository implementation directly, as it does for app statistics.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


class AnnotationAppNotFoundError(Exception):
    """The requested app is unavailable in the caller's workspace."""


class AnnotationNotFoundError(Exception):
    """The requested annotation does not belong to the admitted app."""


@dataclass(frozen=True, slots=True)
class AnnotationRecord:
    id: str
    question: str
    content: str
    hit_count: int
    created_at: datetime


@dataclass(frozen=True, slots=True)
class AnnotationHitHistoryRecord:
    id: str
    source: str
    score: float
    question: str
    created_at: datetime
    annotation_question: str
    annotation_content: str


@dataclass(frozen=True, slots=True)
class AnnotationPage[RecordT]:
    data: tuple[RecordT, ...]
    page: int
    limit: int
    total: int

    @property
    def has_more(self) -> bool:
        return self.page * self.limit < self.total


@dataclass(frozen=True, slots=True)
class AnnotationEmbeddingModel:
    """Both names are None when an enabled setting's binding was removed."""

    embedding_provider_name: str | None
    embedding_model_name: str | None


@dataclass(frozen=True, slots=True)
class AnnotationSettingRecord:
    """Disabled apps have no setting ID, threshold, or embedding model."""

    enabled: bool
    id: str | None
    score_threshold: float | None
    embedding_model: AnnotationEmbeddingModel | None


class AnnotationAppQuery(Protocol):
    def require_app(self, *, tenant_id: str, app_id: str) -> None:
        """Validate a normal app's workspace and close the database session before returning."""
        ...


class AnnotationQuery(Protocol):
    def count(self, *, tenant_id: str, app_id: str) -> int: ...

    def get_page(
        self, *, tenant_id: str, app_id: str, page: int, limit: int, keyword: str
    ) -> AnnotationPage[AnnotationRecord]: ...

    def get_all(self, *, tenant_id: str, app_id: str) -> tuple[AnnotationRecord, ...]:
        """Read all annotations for export, retaining their original text."""
        ...

    def get_setting(self, *, tenant_id: str, app_id: str) -> AnnotationSettingRecord: ...

    def get_hit_history_page(
        self, *, tenant_id: str, app_id: str, annotation_id: str, page: int, limit: int
    ) -> AnnotationPage[AnnotationHitHistoryRecord]: ...
