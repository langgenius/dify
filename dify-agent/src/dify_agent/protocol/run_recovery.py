"""Bounded create acknowledgement selection and complete request identity.

This digest is distinct from the native executable-request digest: ownership,
metadata and protocol fields also participate in create admission.
"""

import hashlib
import json
from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field

from dify_agent.protocol.schemas import NATIVE_TEST_REQUEST_FIELDS, CreateRunRequest


class LookupRunRequest(BaseModel):
    """Select one retained create without configuration or dispatch authority."""

    idempotency_key: str = Field(strict=True, min_length=1, max_length=256)
    request_digest: str = Field(strict=True, pattern=r"^[0-9a-f]{64}$")
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)


def create_run_fingerprint(request: CreateRunRequest) -> str:
    """SHA256 of the canonical validated request without its idempotency key.

    This is the server's create-admission fingerprint (``RunRecord.idempotency_fingerprint``).
    Ordinary requests hash the pre-native field set with the pre-native JSON
    encoding, so fingerprints stored before native testing existed still match
    and a retained record replays across an upgrade instead of conflicting.
    Their native fields always hold fixed defaults, so leaving them out loses
    nothing. Builder test requests also bind every native field.
    """
    validated = CreateRunRequest.model_validate(request.model_dump(mode="json"))
    excluded = {"idempotency_key"}
    if validated.execution_mode == "ordinary":
        excluded |= NATIVE_TEST_REQUEST_FIELDS
    payload = validated.model_dump(mode="json", exclude=excluded)
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


__all__ = ["LookupRunRequest", "create_run_fingerprint"]
