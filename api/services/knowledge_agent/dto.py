"""Console request and response models for knowledge-agent connections."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from fields.base import ResponseModel


class KnowledgeAgentGrantAccountResponse(ResponseModel):
    id: str
    name: str
    email: str


class KnowledgeAgentGrantResponse(ResponseModel):
    id: str
    kind: Literal["oauth", "personal"]
    name: str
    client_name: str | None = None
    scopes: list[str]
    knowledge_base_ids: list[str]
    created_at: datetime
    expires_at: datetime | None = None
    last_used_at: datetime | None = None
    account: KnowledgeAgentGrantAccountResponse | None = None


class KnowledgeAgentMineResponse(ResponseModel):
    available: bool = Field(description="Whether this deployment offers agent connections at all")
    agent_access_enabled: bool = Field(description="The workspace switch")
    blocked_knowledge_base_ids: list[str]
    mcp_url: str
    grants: list[KnowledgeAgentGrantResponse]


class KnowledgeAgentWorkspaceResponse(ResponseModel):
    agent_access_enabled: bool
    grants: list[KnowledgeAgentGrantResponse]


class KnowledgeAgentTokenCreatedResponse(ResponseModel):
    grant: KnowledgeAgentGrantResponse
    token: str = Field(description="Shown once; only its SHA-256 digest is stored")


class KnowledgeAgentAuthorizationClientResponse(ResponseModel):
    kind: Literal["cimd", "dcr"]
    name: str
    redirect_host: str


class KnowledgeAgentAuthorizationWorkspaceResponse(ResponseModel):
    id: str
    name: str


class KnowledgeAgentAuthorizationResponse(ResponseModel):
    agent_access_enabled: bool
    blocked_knowledge_base_ids: list[str]
    client: KnowledgeAgentAuthorizationClientResponse
    scopes: list[str]
    workspace: KnowledgeAgentAuthorizationWorkspaceResponse


class KnowledgeAgentAuthorizationDecisionResponse(ResponseModel):
    redirect_to: str


class KnowledgeAgentAuthorizationQuery(BaseModel):
    """The OAuth authorization request the agent opened the consent page with."""

    response_type: str | None = None
    client_id: str | None = Field(default=None, max_length=2048)
    redirect_uri: str | None = Field(default=None, max_length=2048)
    code_challenge: str | None = Field(default=None, max_length=128)
    code_challenge_method: str | None = Field(default=None, max_length=16)
    state: str | None = Field(default=None, max_length=1024)
    scope: str | None = Field(default=None, max_length=512)
    resource: str | None = Field(default=None, max_length=2048)

    model_config = ConfigDict(extra="ignore")


class KnowledgeAgentAuthorizationPayload(KnowledgeAgentAuthorizationQuery):
    approve: bool
    knowledge_base_ids: list[str] = Field(default_factory=list, max_length=100)


class KnowledgeAgentTokenPayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    knowledge_base_ids: list[str] = Field(min_length=1, max_length=100)
    expires_in_days: int = Field(default=30, ge=1, le=90)

    model_config = ConfigDict(extra="forbid")


class KnowledgeAgentGrantUpdatePayload(BaseModel):
    knowledge_base_ids: list[str] = Field(min_length=1, max_length=100)

    model_config = ConfigDict(extra="forbid")


class KnowledgeAgentWorkspacePayload(BaseModel):
    enabled: bool

    model_config = ConfigDict(extra="forbid")
