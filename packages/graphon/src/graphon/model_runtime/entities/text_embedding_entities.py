from decimal import Decimal
from enum import StrEnum, auto

from pydantic import BaseModel

from graphon.model_runtime.entities.model_entities import ModelUsage


class EmbeddingInputType(StrEnum):
    """Embedding request input variants understood by the model runtime."""

    DOCUMENT = auto()
    QUERY = auto()


class EmbeddingUsage(ModelUsage):
    """Model class for embedding usage."""

    tokens: int
    total_tokens: int
    unit_price: Decimal
    price_unit: Decimal
    total_price: Decimal
    currency: str
    latency: float


class EmbeddingResult(BaseModel):
    """Model class for text embedding result."""

    model: str
    embeddings: list[list[float]]
    usage: EmbeddingUsage


class FileEmbeddingResult(BaseModel):
    """Model class for file embedding result."""

    model: str
    embeddings: list[list[float]]
    usage: EmbeddingUsage
