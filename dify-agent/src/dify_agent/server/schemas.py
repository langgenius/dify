"""Server-only schemas and helpers for persisted run records.

Public HTTP DTOs and run events live in ``dify_agent.protocol.schemas`` and are
intentionally not re-exported here. Keeping this module server-only prevents old
imports from silently depending on implementation modules while preserving the
internal ``RunRecord`` model used by schedulers and Redis storage.
"""

from datetime import datetime
from typing import ClassVar
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dify_agent.protocol import schemas as _protocol_schemas


def new_run_id() -> str:
    """Return a stable external run id for newly persisted server records."""
    return str(uuid4())


class RunRecord(BaseModel):
    """Internal representation persisted for status reads.

    Only status metadata is persisted. Create-run requests can contain model
    credentials in layer config and must remain in scheduler memory rather than
    being written to Redis.
    """

    run_id: str
    status: _protocol_schemas.RunStatus
    created_at: datetime = Field(default_factory=_protocol_schemas.utc_now)
    updated_at: datetime = Field(default_factory=_protocol_schemas.utc_now)
    error: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @field_validator("updated_at")
    @classmethod
    def updated_at_must_be_timezone_aware(cls, value: datetime) -> datetime:
        """Reject naive timestamps before they become JSON API values."""
        if value.tzinfo is None:
            raise ValueError("updated_at must be timezone-aware")
        return value


__all__ = ["RunRecord", "new_run_id"]
