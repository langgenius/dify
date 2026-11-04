"""Tidy evidence and opt-in contracts. KnowledgeFS owns scanning and review state."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from fields.base import ResponseModel

TidyFindingStatus = Literal["open", "dismissed", "reviewed", "disabled", "outdated"]
TidyFindingKind = Literal["duplicate", "similar", "conflict"]
TidyScanState = Literal["pending", "scanning", "complete", "failed"]


class KnowledgeFSTidySettingsPayload(BaseModel):
    enabled: bool
    # Conflict detection calls the space's reasoning model; duplicate detection never does.
    conflicts: bool | None = None
    expectedRevision: int = Field(ge=0)
    acknowledgeTokenUsage: bool = False

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def require_acknowledgment(self) -> "KnowledgeFSTidySettingsPayload":
        """Accept enabling billable conflict detection only with explicit token acknowledgment."""
        if self.enabled and self.conflicts is not False and not self.acknowledgeTokenUsage:
            raise ValueError("Acknowledge model token usage before enabling conflict detection")
        return self


class KnowledgeFSTidySettingsResponse(ResponseModel):
    enabled: bool
    conflicts: bool
    revision: int
    lastError: Literal["scan_failed", "authorization_failed", "model_unavailable"] | None
    updatedAt: str


class KnowledgeFSTidyFindingCountResponse(ResponseModel):
    status: TidyFindingStatus
    kind: TidyFindingKind
    count: int


class KnowledgeFSTidyDocumentProgressResponse(ResponseModel):
    pending: int
    scanning: int
    complete: int
    failed: int


class KnowledgeFSTidySummaryResponse(ResponseModel):
    findings: list[KnowledgeFSTidyFindingCountResponse]
    documents: KnowledgeFSTidyDocumentProgressResponse
    modelCalls: int


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
    kind: TidyFindingKind
    left: KnowledgeFSTidyEvidenceResponse
    right: KnowledgeFSTidyEvidenceResponse
    reason: str
    similarity: float | None
    status: TidyFindingStatus
    revision: int
    actionId: str | None
    createdAt: str
    stale: bool = False


class KnowledgeFSTidyFindingListResponse(ResponseModel):
    items: list[KnowledgeFSTidyFindingResponse]
    nextCursor: str | None


class KnowledgeFSTidyFindingQuery(BaseModel):
    cursor: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    status: TidyFindingStatus | None = None
    kind: TidyFindingKind | None = None


class KnowledgeFSTidyScanQuery(BaseModel):
    cursor: str | None = None
    state: TidyScanState | None = None


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
    state: TidyScanState
    windows: int
    modelCalls: int
    error: str | None


class KnowledgeFSTidyScanListResponse(ResponseModel):
    items: list[KnowledgeFSTidyScanResponse]
    nextCursor: str | None


class KnowledgeFSTidyRetryResponse(ResponseModel):
    resumed: int
