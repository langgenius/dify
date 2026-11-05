"""Annotation retrieval inputs and the reply port used by application runners."""

from dataclasses import dataclass
from typing import Protocol

from models.dataset import Dataset
from models.enums import ConversationFromSource
from models.vector import VectorConfiguration


@dataclass(frozen=True)
class AnnotationSearch:
    dataset: Dataset
    configuration: VectorConfiguration
    setting_id: str
    score_threshold: float


@dataclass(frozen=True)
class AnnotationMatch:
    annotation_id: str
    score: float


@dataclass(frozen=True)
class AnnotationReply:
    id: str
    content: str


class AnnotationReplies(Protocol):
    def query(
        self,
        *,
        tenant_id: str,
        app_id: str,
        message_id: str,
        query: str,
        user_id: str,
        from_source: ConversationFromSource,
    ) -> AnnotationReply | None: ...
