"""Data contracts shared by knowledge model-configuration consumers."""

from dataclasses import dataclass


@dataclass(frozen=True)
class DatasetModelConfiguration:
    tenant_id: str
    indexing_technique: str | None
    embedding_model_provider: str | None
    embedding_model: str | None


@dataclass(frozen=True)
class EmbeddingModelConfiguration:
    provider: str
    model: str
    supports_vision: bool = False
