from typing import Any, Literal, Union

from pydantic import BaseModel, Field


class AuthorizationConfig(BaseModel):
    type: Literal[None, "basic", "bearer", "custom"]
    api_key: Union[None, str] = None
    header: Union[None, str] = None


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
