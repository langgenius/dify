"""Bounded create acknowledgement selection and complete request identity.

This digest is distinct from the native executable-request digest: ownership,
metadata and protocol fields also participate in create admission.
"""

import hashlib
import json
from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field

from dify_agent.protocol.schemas import CreateRunRequest


class LookupRunRequest(BaseModel):
    """Select one retained create without configuration or dispatch authority."""

    idempotency_key: str = Field(strict=True, min_length=1, max_length=256)
    request_digest: str = Field(strict=True, pattern=r"^[0-9a-f]{64}$")
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)


def create_run_fingerprint(request: CreateRunRequest) -> str:
    """SHA256 of complete canonical validated request, excluding only its key."""
    validated = CreateRunRequest.model_validate(request.model_dump(mode="json"))
    payload = validated.model_dump(mode="json", exclude={"idempotency_key"})
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode(
        "utf-8"
    )
    return hashlib.sha256(raw).hexdigest()


__all__ = ["LookupRunRequest", "create_run_fingerprint"]
