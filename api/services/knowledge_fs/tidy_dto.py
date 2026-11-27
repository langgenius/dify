"""Tidy evidence and opt-in contracts. KnowledgeFS owns scanning and review state."""

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from fields.base import ResponseModel


# The enums carry no docstring on purpose: pydantic would publish it as the schema description.
class TidyFindingStatus(StrEnum):
    OPEN = "open"
    DISMISSED = "dismissed"
    REVIEWED = "reviewed"
    DISABLED = "disabled"
    OUTDATED = "outdated"


class TidyFindingKind(StrEnum):
    DUPLICATE = "duplicate"
    SIMILAR = "similar"
    CONFLICT = "conflict"


class TidyScanState(StrEnum):
    PENDING = "pending"
    SCANNING = "scanning"
    COMPLETE = "complete"
    FAILED = "failed"


class TidySettingsError(StrEnum):
    SCAN_FAILED = "scan_failed"
    AUTHORIZATION_FAILED = "authorization_failed"
    MODEL_UNAVAILABLE = "model_unavailable"


class TidyFurtherActionName(StrEnum):
    DISMISS = "dismiss"
    REVIEW = "review"
    DISABLE_DOCUMENT = "disable_document"


class TidyActionName(StrEnum):
    DISMISS = "dismiss"
    REVIEW = "review"
    DISABLE_DOCUMENT = "disable_document"
    UNDO = "undo"
    ADOPT = "adopt"


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
    lastError: TidySettingsError | None  # noqa: N815  # Public field name.
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
    """Query of the findings list; ``cursor`` is the previous page's ``nextCursor``. Unknown keys are refused."""

    cursor: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    status: TidyFindingStatus | None = None
    kind: TidyFindingKind | None = None

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSTidyScanQuery(BaseModel):
    """Query of the scans list; ``cursor`` is the previous page's ``nextCursor``. Unknown keys are refused."""

    # KnowledgeFS accepts a UUID here (`format: uuid`); the pattern says so in the generated schema.
    cursor: str | None = Field(
        default=None,
        min_length=36,
        max_length=36,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    )
    state: TidyScanState | None = None

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSTidyFurtherAction(BaseModel):
    """Another finding settled in the same transaction as the one the request addresses."""

    findingId: str = Field(pattern=r"^[a-f0-9]{64}$")  # noqa: N815  # Public field name.
    expectedRevision: int = Field(gt=0)  # noqa: N815  # Public field name.
    action: TidyFurtherActionName
    documentId: str | None = None  # noqa: N815  # Public field name.

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def require_document(self) -> "KnowledgeFSTidyFurtherAction":
        """A document disable must explicitly identify the selected evidence side."""
        if self.action == TidyFurtherActionName.DISABLE_DOCUMENT and not self.documentId:
            raise ValueError("Choose the document to disable")
        return self


class KnowledgeFSTidyActionPayload(BaseModel):
    expectedRevision: int = Field(gt=0)  # noqa: N815  # Public field name.
    action: TidyActionName
    documentId: str | None = None  # noqa: N815  # Public field name.
    # ``adopt`` only: ``documentId`` is the side that is right, and this text replaces the
    # conflicting passage of the other document. Only the knowledge base's indexed copy changes.
    replacement: str | None = Field(default=None, min_length=1, max_length=20_000)
    # Applied with this action, all or none: a keep-one merge disables every other copy at once.
    also: list[KnowledgeFSTidyFurtherAction] | None = Field(default=None, min_length=1, max_length=63)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def require_document(self) -> "KnowledgeFSTidyActionPayload":
        """Actions on one evidence side must explicitly identify the side the user selected."""
        if self.action == TidyActionName.DISABLE_DOCUMENT and not self.documentId:
            raise ValueError("Choose the document to disable")
        if self.action == TidyActionName.ADOPT and not (
            self.documentId and self.replacement and self.replacement.strip()
        ):
            raise ValueError("Choose the document to keep and the new wording")
        if self.action != TidyActionName.ADOPT and self.replacement is not None:
            raise ValueError("Only adopting a side rewrites a passage")
        if self.also and self.action in (TidyActionName.UNDO, TidyActionName.ADOPT):
            raise ValueError("Undo or adopt one finding at a time")
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
