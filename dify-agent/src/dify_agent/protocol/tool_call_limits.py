"""Application-owned annotations on existing native tool return records.

These values describe runtime dispatch decisions, never a model's claim that a
tool ran. They are metadata on ToolReturnPart and are not sent to the model.
"""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


TOOL_CALL_LIMIT_METADATA_KEY = "dify_tool_call_limit"
TOOL_EXECUTION_FAILED_METADATA_KEY = "dify_tool_execution_failed"
TOOL_VALIDATION_FAILED_METADATA_KEY = "dify_tool_validation_failed"


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
    """Authoritative reservations copied atomically into a terminal run event.

    Each hashed native call id maps to its one-based reservation ordinal. A
    reservation without a matching result remains unconfirmed: the summary does
    not claim whether an external side effect occurred. No arguments, credentials
    or tool observations belong to this record. Decimal-text limits are accepted
    only to decode the exact integer preserved in trusted Redis state.
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
