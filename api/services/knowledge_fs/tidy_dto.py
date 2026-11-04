"""Tidy evidence and opt-in contracts. KnowledgeFS owns scanning and review state."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from fields.base import ResponseModel


class KnowledgeFSTidySettingsPayload(BaseModel):
    enabled: bool
    expectedRevision: int = Field(ge=0)
    acknowledgeTokenUsage: bool = False

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def require_acknowledgment(self) -> "KnowledgeFSTidySettingsPayload":
        """Accept enabling only with explicit token-consumption acknowledgment."""
        if self.enabled and not self.acknowledgeTokenUsage:
            raise ValueError("Acknowledge model token usage before enabling Tidy")
        return self


class KnowledgeFSTidySettingsResponse(ResponseModel):
    enabled: bool
    revision: int
    lastError: str | None
    updatedAt: str


class KnowledgeFSTidyEvidenceResponse(ResponseModel):
    documentId: str
    revision: int
    title: str
    chunkId: str
    start: int
    end: int
    text: str


class KnowledgeFSTidyFindingResponse(ResponseModel):
    id: str
    kind: Literal["duplicate", "similar", "conflict"]
    left: KnowledgeFSTidyEvidenceResponse
    right: KnowledgeFSTidyEvidenceResponse
    reason: str
    similarity: float | None
    status: Literal["open", "dismissed", "reviewed", "disabled"]
    revision: int
    actionId: str | None
    createdAt: str
    stale: bool = False


class KnowledgeFSTidyFindingListResponse(ResponseModel):
    items: list[KnowledgeFSTidyFindingResponse]
    nextCursor: str | None


class KnowledgeFSTidyFindingQuery(BaseModel):
    cursor: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    status: Literal["open", "dismissed", "reviewed", "disabled"] | None = None


class KnowledgeFSTidyActionPayload(BaseModel):
    expectedRevision: int = Field(gt=0)
    action: Literal["dismiss", "review", "disable_document", "undo"]
    documentId: str | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def require_document(self) -> "KnowledgeFSTidyActionPayload":
        """A document disable must explicitly identify the user's selected evidence side."""
        if self.action == "disable_document" and not self.documentId:
            raise ValueError("Choose the document to disable")
        return self


class KnowledgeFSTidyScanResponse(ResponseModel):
    documentId: str
    title: str
    state: Literal["pending", "scanning", "complete", "failed"]
    windows: int
    modelCalls: int
    error: str | None


class KnowledgeFSTidyScanListResponse(ResponseModel):
    items: list[KnowledgeFSTidyScanResponse]
    nextCursor: str | None


class KnowledgeFSTidyRetryResponse(ResponseModel):
    resumed: int
