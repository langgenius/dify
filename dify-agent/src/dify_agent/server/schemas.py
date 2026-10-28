"""Server-only schemas and helpers for persisted run records.

Public HTTP DTOs and run events live in ``dify_agent.protocol.schemas`` and are
intentionally not re-exported here. Keeping this module server-only prevents old
imports from silently depending on implementation modules while preserving the
internal ``RunRecord`` model used by schedulers and Redis storage.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import ClassVar
from uuid import UUID, uuid4, uuid5
import hashlib

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dify_agent.protocol import schemas as _protocol_schemas
from dify_agent.protocol.native_testing import AgentRuntimeIdentity, ContinuationClaim


_KEYED_RUN_NAMESPACE_V1 = UUID("b67a4252-c731-4d53-8521-b79cc362474a")


def keyed_run_id(key_digest: str) -> str:
    """Server-only v1 mapping; callers retain the key, never derive public IDs."""
    return str(uuid5(_KEYED_RUN_NAMESPACE_V1, key_digest))


def create_key_digest(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def new_run_id() -> str:
    """Return a stable external run id for newly persisted server records."""
    return str(uuid4())


class RunRecord(BaseModel):
    """Internal representation persisted for status reads.

    Only status and immutable private identity are persisted. Create-run requests can contain sensitive
    layer configuration and must remain in scheduler memory rather than Redis.
    """

    run_id: str
    status: _protocol_schemas.RunStatus
    created_at: datetime = Field(default_factory=_protocol_schemas.utc_now)
    updated_at: datetime = Field(default_factory=_protocol_schemas.utc_now)
    error: str | None = None
    error_type: _protocol_schemas.RunFailureType | None = None
    # Unknown on legacy records; absence is never evidence of ordinary origin.
    runtime_identity: AgentRuntimeIdentity | None = None
    create_key_digest: str | None = Field(default=None, exclude_if=lambda value: value is None)
    create_request_digest: str | None = Field(default=None, exclude_if=lambda value: value is None)
    native_checkpoint_json: str | None = None
    native_wait_event_id: str | None = None
    native_generation: int = 0
    native_claim: ContinuationClaim | None = None
    native_dispatch_started: bool = False

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @field_validator("updated_at")
    @classmethod
    def updated_at_must_be_timezone_aware(cls, value: datetime) -> datetime:
        """Reject naive timestamps before they become JSON API values."""
        if value.tzinfo is None:
            raise ValueError("updated_at must be timezone-aware")
        return value


@dataclass(frozen=True)
class RunCreateClaim:
    """One atomic creation result; only an inserted record admits scheduling."""

    record: RunRecord
    inserted: bool


__all__ = ["RunRecord", "new_run_id"]
