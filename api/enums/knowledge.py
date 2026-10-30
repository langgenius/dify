"""Shared knowledge values independent of persistence models."""

from enum import StrEnum


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
