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
    expectedRevision: int = Field(ge=0)  # noqa: N815  # Public field name.
    acknowledgeTokenUsage: bool = False  # noqa: N815  # Public field name.

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
    lastError: Literal["scan_failed", "authorization_failed", "model_unavailable"] | None  # noqa: N815  # Public field name.
    updatedAt: str  # noqa: N815  # Public field name.


class KnowledgeFSTidyFindingCountResponse(ResponseModel):
    status: TidyFindingStatus
    kind: TidyFindingKind
    count: int


class KnowledgeFSTidyDocumentProgressResponse(ResponseModel):
    pending: int
    scanning: int
    complete: int
    failed: int


class KnowledgeFSTidyCurrentScanResponse(ResponseModel):
    """How far the scanner is through the document it is scanning now."""

    documentId: str  # noqa: N815  # Public field name.
    title: str
    passagesDone: int  # noqa: N815  # Public field name.
    passagesTotal: int  # noqa: N815  # Public field name.


class KnowledgeFSTidySummaryResponse(ResponseModel):
    findings: list[KnowledgeFSTidyFindingCountResponse]
    documents: KnowledgeFSTidyDocumentProgressResponse
    modelCalls: int  # noqa: N815  # Public field name.
    current: KnowledgeFSTidyCurrentScanResponse | None = None


class KnowledgeFSTidyEvidenceResponse(ResponseModel):
    documentId: str  # noqa: N815  # Public field name.
    revision: int
    title: str
    chunkId: str  # noqa: N815  # Public field name.
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
    actionId: str | None  # noqa: N815  # Public field name.
    createdAt: str  # noqa: N815  # Public field name.
    stale: bool = False


class KnowledgeFSTidyDocumentCardResponse(ResponseModel):
    """What the review page shows about a document a finding quotes."""

    title: str
    mimeType: str  # noqa: N815  # Public field name.
    sizeBytes: int  # noqa: N815  # Public field name.
    publishedAt: str  # noqa: N815  # Public field name.
    enabled: bool


class KnowledgeFSTidyFindingListResponse(ResponseModel):
    items: list[KnowledgeFSTidyFindingResponse]
    nextCursor: str | None  # noqa: N815  # Public field name.
    # Keyed by document id; absent from KnowledgeFS releases before document cards existed.
    documents: dict[str, KnowledgeFSTidyDocumentCardResponse] = Field(default_factory=dict)


class KnowledgeFSTidyFindingQuery(BaseModel):
    cursor: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    status: TidyFindingStatus | None = None
    kind: TidyFindingKind | None = None


class KnowledgeFSTidyScanQuery(BaseModel):
    cursor: str | None = None
    state: TidyScanState | None = None


class KnowledgeFSTidyActionPayload(BaseModel):
    expectedRevision: int = Field(gt=0)  # noqa: N815  # Public field name.
    action: Literal["dismiss", "review", "disable_document", "undo"]
    documentId: str | None = None  # noqa: N815  # Public field name.

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def require_document(self) -> "KnowledgeFSTidyActionPayload":
        """A document disable must explicitly identify the user's selected evidence side."""
        if self.action == "disable_document" and not self.documentId:
            raise ValueError("Choose the document to disable")
        return self


class KnowledgeFSTidyScanResponse(ResponseModel):
    documentId: str  # noqa: N815  # Public field name.
    title: str
    state: TidyScanState
    windows: int
    modelCalls: int  # noqa: N815  # Public field name.
    error: str | None


class KnowledgeFSTidyScanListResponse(ResponseModel):
    items: list[KnowledgeFSTidyScanResponse]
    nextCursor: str | None  # noqa: N815  # Public field name.


class KnowledgeFSTidyRetryResponse(ResponseModel):
    resumed: int
