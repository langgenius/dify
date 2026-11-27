"""Server-only schemas and helpers for persisted run records.

Public HTTP DTOs and run events live in ``dify_agent.protocol.schemas`` and are
intentionally not re-exported here. Keeping this module server-only prevents old
imports from silently depending on implementation modules while preserving the
internal ``RunRecord`` model used by schedulers and Redis storage.
"""

from datetime import datetime
from typing import ClassVar
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from dify_agent.protocol import schemas as _protocol_schemas


def new_run_id() -> str:
    """Return a stable external run id for newly persisted server records."""
    return str(uuid4())


class RunRecord(BaseModel):
    """Internal representation persisted for status reads.

    Status metadata and optional admission digests are persisted; legacy records
    without digests remain valid. The digests let active writes refresh only
    their own idempotency claim and are excluded from public status responses.
    Raw keys and create-run requests can contain sensitive data and remain in
    scheduler memory rather than Redis. Live tool counters belong only to the
    native run; their sealed summary is persisted in its terminal event.
    """

    run_id: str
    status: _protocol_schemas.RunStatus
    created_at: datetime = Field(default_factory=_protocol_schemas.utc_now)
    updated_at: datetime = Field(default_factory=_protocol_schemas.utc_now)
    error: str | None = None
    error_type: _protocol_schemas.RunFailureType | None = None
    idempotency_key_digest: str | None = None
    idempotency_fingerprint: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def discard_legacy_live_tool_counters(cls, value: object) -> object:
        """Read retained pre-memory records without restoring their live counters.

        Idempotent admission only replays these records; it never restarts their
        execution. The obsolete field is deliberately absent from new writes.
        Historical terminal events keep their separate public snapshot contract.
        """
        if isinstance(value, dict) and "tool_call_limits" in value:
            return {key: item for key, item in value.items() if key != "tool_call_limits"}
        return value

    @field_validator("updated_at")
    @classmethod
    def updated_at_must_be_timezone_aware(cls, value: datetime) -> datetime:
        """Reject naive timestamps before they become JSON API values."""
        if value.tzinfo is None:
            raise ValueError("updated_at must be timezone-aware")
        return value


__all__ = ["RunRecord", "new_run_id"]
