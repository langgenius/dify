"""Isolated scoped MACs with the existing UploadFile preview URL shape."""

import base64
import hashlib
import hmac
import json
from collections.abc import Callable
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlencode

from pydantic import BaseModel, ConfigDict, Field

from services.external_agents.contracts import ExternalAgentNotFoundError
from services.external_agents.test_file_access import AuthorizedTestFile, TestFileGrant, TestFileURL
from services.upload_file_delivery_service import is_scoped_upload_preview_nonce

_PREFIX = "byoa.v1."


class _GrantClaims(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True, hide_input_in_errors=True)

    kind: Literal["input", "output"]
    tenant_id: str = Field(min_length=1, max_length=255)
    actor_id: str = Field(min_length=1, max_length=255)
    agent_id: str = Field(min_length=1, max_length=255)
    page_session_id: str = Field(min_length=1, max_length=128)
    expected_generation: int = Field(ge=1)
    resource_id: str = Field(min_length=1, max_length=255)
    file_id: str = Field(min_length=1, max_length=255)


class DifyTestFileURLSigner:
    def __init__(
        self, *, secret_key: str, base_url: str, signature_ttl_seconds: int, clock: Callable[[], datetime]
    ) -> None:
        """Receive the existing file-preview signing settings only from composition."""
        if signature_ttl_seconds < 1:
            raise ValueError("A positive file signature lifetime is required.")
        # A separate key and message domain prevent legacy file/tool/datasource
        # readers from accepting this revocable scheme without the live gate.
        self._key = hmac.new(secret_key.encode(), b"dify:external-agent:test-file-preview:v1", hashlib.sha256).digest()
        self._base, self._ttl = base_url.rstrip("/"), signature_ttl_seconds
        self._clock = clock

    def issue(self, file: AuthorizedTestFile) -> TestFileURL:
        """Mint isolated preview signatures whose HMAC covers the entire scope nonce.

        Preconditions: the repository just authorized this live source. Source
        expiry may shorten the normal signature TTL; no authority is persisted
        and public delivery rechecks the source after validating this signature.
        """
        now = self._clock().astimezone(UTC)
        if file.expires_at <= now:
            raise ExternalAgentNotFoundError("The Test file lease expired.")
        claims = _GrantClaims.model_validate(asdict(file.grant))
        payload = json.dumps(claims.model_dump(), separators=(",", ":"), sort_keys=True).encode()
        nonce = _PREFIX + base64.urlsafe_b64encode(payload).decode().rstrip("=")
        timestamp = min(int(now.timestamp()), int(file.expires_at.timestamp()) - self._ttl)
        expires = datetime.fromtimestamp(timestamp + self._ttl, UTC)
        if expires <= now:
            raise ExternalAgentNotFoundError("The Test file lease expired.")
        signature = self._signature(
            file_id=file.grant.file_id, timestamp=str(timestamp), nonce=nonce, preview_kind="file-preview"
        )
        query = urlencode({"timestamp": str(timestamp), "nonce": nonce, "sign": signature})
        return TestFileURL(
            file_id=file.grant.file_id,
            url=f"{self._base}/files/{file.grant.file_id}/file-preview?{query}",
            url_expires_at=expires,
        )

    def _signature(
        self, *, file_id: str, timestamp: str, nonce: str, preview_kind: Literal["file-preview", "image-preview"]
    ) -> str:
        value = f"byoa-preview:v1|{preview_kind}|{file_id}|{timestamp}|{nonce}".encode()
        return base64.urlsafe_b64encode(hmac.new(self._key, value, hashlib.sha256).digest()).decode()

    def verify(
        self,
        *,
        file_id: str,
        timestamp: str,
        nonce: str,
        sign: str,
        preview_kind: Literal["file-preview", "image-preview"],
    ) -> bool:
        """Accept only a fresh isolated MAC; no unverified scope claim is decoded.

        Legacy file-preview HMACs cannot be upgraded by adding scope claims;
        scoped MACs cannot be reused by historical tool/datasource readers.
        """
        if not nonce.startswith(_PREFIX) or len(nonce) > 4096 or len(sign) != 44 or not sign.isascii():
            return False
        try:
            signed_at = int(timestamp)
        except ValueError:
            return False
        age = int(self._clock().timestamp()) - signed_at
        return 0 <= age < self._ttl and hmac.compare_digest(
            sign, self._signature(file_id=file_id, timestamp=timestamp, nonce=nonce, preview_kind=preview_kind)
        )

    def is_scoped(self, nonce: str) -> bool:
        """Reserve all BYOA versions so malformed/unknown scoped nonces fail closed."""
        return is_scoped_upload_preview_nonce(nonce)

    def decode_verified_nonce(self, nonce: str) -> TestFileGrant:
        """Read bounded claims after the caller verified the isolated scoped HMAC and TTL."""
        if not nonce.startswith(_PREFIX) or len(nonce) > 4096:
            raise ValueError("Invalid scoped Test file nonce.")
        encoded = nonce[len(_PREFIX) :]
        claims = _GrantClaims.model_validate_json(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        return TestFileGrant(
            kind=claims.kind,
            tenant_id=claims.tenant_id,
            actor_id=claims.actor_id,
            agent_id=claims.agent_id,
            page_session_id=claims.page_session_id,
            expected_generation=claims.expected_generation,
            resource_id=claims.resource_id,
            file_id=claims.file_id,
        )
