"""Application-owned annotations on existing native tool return records.

These values describe runtime dispatch decisions, never a model's claim that a
tool ran. They are metadata on ToolReturnPart and are not sent to the model.
"""

import hashlib
from collections.abc import Mapping
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError, field_validator, model_validator


TOOL_CALL_LIMIT_METADATA_KEY = "dify_tool_call_limit"
TOOL_EXECUTION_FAILED_METADATA_KEY = "dify_tool_execution_failed"
TOOL_VALIDATION_FAILED_METADATA_KEY = "dify_tool_validation_failed"
AGENT_TOOL_ACTIVITY_META_KEY = "agent_v2_tool_activity"

AgentToolActivityStatus = Literal["started", "running", "succeeded", "failed", "cancelled", "not_executed"]


class ToolCallLimitMetadata(BaseModel):
    """Usage at this call's dispatch boundary and its authoritative disposition."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    tool_identity: str = Field(min_length=1)
    limit: int = Field(gt=0, strict=True)
    used: int = Field(ge=0, strict=True)
    execution_status: Literal["executed", "not_executed", "unconfirmed"]
    reason: Literal["call_limit_reached", "duplicate_tool_call"] | None = None

    @model_validator(mode="after")
    def validate_decision(self) -> Self:
        """Accept only decisions whose count and reason agree with execution."""
        if self.used > self.limit:
            raise ValueError("tool usage cannot exceed the frozen run limit")
        if (self.execution_status == "not_executed") != (self.reason is not None):
            raise ValueError("only unexecuted requests carry a rejection reason")
        if self.execution_status in {"executed", "unconfirmed"} or self.reason == "duplicate_tool_call":
            if self.used == 0:
                raise ValueError("a reserved or duplicate call requires an existing reservation")
        if self.reason == "call_limit_reached" and self.used != self.limit:
            raise ValueError("a limit rejection requires an exhausted quota")
        return self


class ToolCallLimitSnapshot(BaseModel):
    """Authoritative reservations sealed by the owner for a terminal run event.

    Each hashed native call id maps to its one-based reservation ordinal. A
    reservation without a matching result remains unconfirmed: the summary does
    not claim whether an external side effect occurred. No arguments, credentials
    or tool observations belong to this record. Decimal-text limits are accepted
    only to decode historical snapshots written from trusted Redis state.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    tool_identity: str = Field(min_length=1)
    limit: int = Field(strict=True, gt=0)
    used: int = Field(strict=True, ge=0)
    call_ids: dict[str, Annotated[int, Field(strict=True, gt=0)]]

    @field_validator("limit", mode="before")
    @classmethod
    def parse_stored_decimal_limit(cls, value: object) -> object:
        """Read Redis's lossless positive decimal representation without coercion."""
        if isinstance(value, str) and value.isascii() and value.isdecimal() and not value.startswith("0"):
            return int(value)
        return value

    @model_validator(mode="after")
    def validate_reservations(self) -> Self:
        """Require one distinct ordinal per reservation within the frozen limit."""
        ordinals = set(self.call_ids.values())
        if (
            self.used > self.limit
            or len(self.call_ids) != self.used
            or len(ordinals) != self.used
            or any(ordinal > self.used for ordinal in ordinals)
        ):
            raise ValueError("tool reservation ordinals must exactly cover committed usage within the limit")
        return self


class AgentToolActivity(BaseModel):
    """One native tool call's application-owned, persistable display metadata.

    Native call identity is independent of its display name and the SQL thought
    row. Tool inputs, credentials and successful observations remain outside
    this sidecar; ``error`` is a bounded failure description for display.
    Missing metadata on older thoughts conveys no execution or quota claim.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    tool_call_id: str = Field(min_length=1)
    tool_name: str = Field(min_length=1)
    status: AgentToolActivityStatus
    error: str | None = None
    call_limit: ToolCallLimitMetadata | None = None

    @model_validator(mode="after")
    def validate_identity_and_outcome(self) -> Self:
        """Reject inconsistent identities or an unsupported execution assertion."""
        if self.id != f"{self.run_id}:{self.tool_call_id}":
            raise ValueError("tool activity identity must include its native run and call ids")
        denied = self.call_limit is not None and self.call_limit.execution_status == "not_executed"
        if (self.status == "not_executed") != denied:
            raise ValueError("an unexecuted tool activity requires authoritative rejection metadata")
        if (
            self.call_limit is not None
            and self.call_limit.execution_status == "unconfirmed"
            and self.status not in {"failed", "cancelled"}
        ):
            raise ValueError("unconfirmed reservations require an interrupted tool activity")
        return self


def agent_tool_activity_from_metadata(metadata: object) -> AgentToolActivity | None:
    """Read the allowlisted thought sidecar, tolerating absent or invalid old data.

    Only a validated structured value under the application-owned key is
    returned. This function never inspects observation text or returns unrelated
    historical tool metadata, which may contain provider-specific configuration.
    """
    if not isinstance(metadata, dict):
        return None
    value = metadata.get(AGENT_TOOL_ACTIVITY_META_KEY)
    try:
        return AgentToolActivity.model_validate(value) if isinstance(value, dict) else None
    except ValidationError:
        return None


def validated_call_limit(metadata: JsonValue) -> ToolCallLimitMetadata | None:
    """Read only valid structured runtime annotations without inferring from text."""
    if not isinstance(metadata, dict):
        return None
    value = metadata.get(TOOL_CALL_LIMIT_METADATA_KEY)
    try:
        return ToolCallLimitMetadata.model_validate(value) if isinstance(value, dict) else None
    except ValidationError:
        return None


def runtime_tool_failed(metadata: JsonValue, *, has_quota: bool) -> bool:
    """Recognize boolean runtime failure flags, independently of model content."""
    return isinstance(metadata, dict) and (
        metadata.get(TOOL_VALIDATION_FAILED_METADATA_KEY) is True
        or (has_quota and metadata.get(TOOL_EXECUTION_FAILED_METADATA_KEY) is True)
    )


def unconfirmed_reservation(
    tool_call_id: str, call_limits: Mapping[str, ToolCallLimitSnapshot]
) -> ToolCallLimitMetadata | None:
    """Match a native call to exactly one terminal reservation without claiming dispatch.

    Preconditions: summaries came from the validated owning run's terminal
    event. Absent or ambiguous hashes return no metadata; no configuration,
    arguments or external results are reconstructed.
    """
    digest = hashlib.sha256(tool_call_id.encode()).hexdigest()
    matches = [snapshot for snapshot in call_limits.values() if digest in snapshot.call_ids]
    if len(matches) != 1:
        return None
    snapshot = matches[0]
    return ToolCallLimitMetadata(
        tool_identity=snapshot.tool_identity,
        limit=snapshot.limit,
        used=snapshot.call_ids[digest],
        execution_status="unconfirmed",
    )
