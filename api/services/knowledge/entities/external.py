"""Shared external knowledge contracts, independent of service implementations."""

from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field


class ExternalKnowledgeApiSetting(BaseModel):
    url: str
    request_method: str
    headers: dict[str, Any] | None = None
    params: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class ExternalKnowledgeRetrievalRequest:
    """Owned provider configuration and retrieval input, independent of HTTP."""

    endpoint: str
    api_key: str | None
    knowledge_id: str
    query: str
    retrieval_model: dict[str, Any]
    metadata_filters: dict[str, Any] | None


class ExternalDatasetCreatePayload(BaseModel):
    """Validated fields required to create an external dataset binding.

    The console controller owns HTTP concerns, but the service also needs this
    contract when creating the tenant-scoped dataset and external knowledge
    binding. Keep it outside controllers so service imports do not depend on
    Flask blueprint initialization.
    """

    external_knowledge_api_id: str
    external_knowledge_id: str
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(None, max_length=400)
    external_retrieval_model: dict[str, object] | None = Field(default=None)
