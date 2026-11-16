from typing import Any, Literal, NotRequired, TypedDict

from pydantic import BaseModel, Field


class AuthorizationConfig(BaseModel):
    type: Literal[None, "basic", "bearer", "custom"]
    api_key: None | str = None
    header: None | str = None


class Authorization(BaseModel):
    type: Literal["no-auth", "api-key"]
    config: AuthorizationConfig | None = None


class ProcessStatusSetting(BaseModel):
    request_method: str
    url: str


class ExternalKnowledgeApiSetting(BaseModel):
    url: str
    request_method: str
    headers: dict[str, Any] | None = None
    params: dict[str, Any] | None = None


class ExternalRetrievalRecord(TypedDict):
    """One record of an external knowledge base retrieval response.

    ``content`` is the only field the external contract requires. The remaining
    fields come from the same JSON object and stay optional because providers
    legitimately omit them; consumers must treat a missing value and an explicit
    ``None`` identically, so they read these fields with ``.get``.
    """

    content: str
    title: NotRequired[str | None]
    score: NotRequired[float | None]
    metadata: NotRequired[dict[str, Any] | None]


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
