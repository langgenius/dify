"""Shared knowledge values independent of persistence models."""

from enum import StrEnum
from typing import Literal


class DatasetVectorIndexStatus(StrEnum):
    INDEXING = "indexing"
    COMPLETED = "completed"
    ERROR = "error"


DocumentIndexState = Literal["pending", "completed", "failed"]
DocumentIndexRetryAction = Literal["retry", "enable", "disable", "archive"]


class ProcessRuleMode(StrEnum):
    """Dataset process-rule mode."""

    AUTOMATIC = "automatic"
    CUSTOM = "custom"
    HIERARCHICAL = "hierarchical"


class DocumentCreatedFrom(StrEnum):
    """Source of a document-creation request."""

    WEB = "web"
    API = "api"
    RAG_PIPELINE = "rag-pipeline"
