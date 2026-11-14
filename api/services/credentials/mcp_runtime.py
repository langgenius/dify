"""Resolve MCP connection secrets and serialize reactive OAuth refreshes.

Only the access token, URL and request headers leave this boundary. A failed
credential digest identifies the exact connection values rejected by the server.
Reloading under the refresh lease prevents concurrent callers rotating twice.
"""

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, Protocol

from services.credentials.refresh import CredentialRefreshLock, CredentialRefreshUnavailableError


class MCPCredentialUnavailableError(ValueError):
    """The provider must be authorized again before another run can use it."""


@dataclass(frozen=True, slots=True)
class MCPCredentialRecord:
    id: str
    workspace_id: str
    provider: str
    encrypted_credentials: str | None
    # Detached encrypted provider data for the legacy MCP codec adapter.
    data: dict[str, Any]
    authed: bool
    encrypted_headers: str | None = None


class MCPCredentialStore(Protocol):
    def get_mcp_credential(self, *, workspace_id: str, provider: str, credential_id: str) -> MCPCredentialRecord | None:
        """Load a detached snapshot scoped to workspace, provider and ID."""
        ...

    def update_mcp_credential_if_unchanged(
        self, *, record: MCPCredentialRecord, encrypted_credentials: str | None, authed: bool
    ) -> bool:
        """Commit a short conditional write guarding all prior connection state."""
        ...


class MCPCredentialRuntime(Protocol):
    def needs_refresh(self, record: MCPCredentialRecord, *, now: float) -> bool:
        """Return whether a known OAuth expiry is within its refresh window.

        Header credentials and legacy tokens without expiry never proactively
        refresh. Implementations must not mutate the snapshot or perform I/O.
        """
        ...

    def resolve(self, record: MCPCredentialRecord, *, deployed: bool = True) -> dict[str, Any]:
        """Given a scoped snapshot, return connection secrets without mutating it.

        Deployed results also include the validated identity_mode as metadata.
        Headers remain unexpanded; debug callers own request-specific expansion
        and identity forwarding. Resolution never issues a forwarded token.
        """
        ...

    def refresh(
        self,
        record: MCPCredentialRecord,
        *,
        authorization_code: str | None = None,
        resource_metadata_url: str | None = None,
        scope_hint: str | None = None,
    ) -> str:
        """Return encrypted merged tokens without persistence or an open transaction.

        Preserve existing client information and omitted token fields. Raise
        unavailable only for grants requiring reauthorization; transport and
        server failures raise CredentialRefreshUnavailableError.
        """
        ...


def mcp_credential_digest(values: dict[str, Any]) -> str:
    """Hash raw URL/headers only, excluding runtime identity metadata.

    Accept a resolved connection or its values. Debug and deployed callers use
    the same digest before per-request expansion or SSO token injection.
    """
    connection = {key: values[key] for key in ("server_url", "headers")}
    return hashlib.sha256(
        json.dumps(connection, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def mcp_token_expiry(tokens: dict[str, Any], *, now: float) -> dict[str, Any]:
    """Stamp newly issued tokens with absolute expiry, without guessing legacy ages.

    Accept OAuth token fields. Unknown/nonpositive lifetimes clear any previous
    expiry so a new token never inherits the old token's expiration deadline.
    The integer timestamp stays inside Dify's stored credentials.
    """
    lifetime = tokens.get("expires_in")
    expires_at = int(now + lifetime) if type(lifetime) is int and lifetime > 0 else 0
    return {**tokens, "expires_at": expires_at}


class MCPCredentialService:
    def __init__(
        self, *, credentials: MCPCredentialStore, runtime: MCPCredentialRuntime, refresh_lock: CredentialRefreshLock
    ) -> None:
        self._credentials = credentials
        self._runtime = runtime
        self._refresh_lock = refresh_lock

    def resolve(
        self,
        *,
        workspace_id: str,
        provider: str,
        credential_id: str,
        failed_credential_digest: str = "",
        deployed: bool = True,
        authorization_code: str | None = None,
        resource_metadata_url: str | None = None,
        scope_hint: str | None = None,
    ) -> dict[str, Any]:
        """Resolve an authorized provider, refreshing near expiry or after a matching rejection.

        A nonempty digest requests a forced refresh under the distributed lease.
        Otherwise a known token expiry triggers a lock and a second expiry check
        before rotation. Legacy tokens without expiry retain the 401 path.
        Permanent authorization failure marks that same snapshot unavailable;
        coordination or transport failure preserves it and remains retryable.
        Owner identifiers must come from the admitted caller's scope. Debug may
        pass initial authorization and challenge hints; deployed callers must
        already be authorized. CAS conflicts never overwrite management changes.
        """
        allow_initial_auth = not deployed and authorization_code is not None
        record = self._load(workspace_id, provider, credential_id, allow_initial_auth=allow_initial_auth)
        if not failed_credential_digest and not self._runtime.needs_refresh(record, now=time.time()):
            return self._runtime.resolve(record, deployed=deployed)
        with self._refresh_lock.acquire(
            credential_type="mcp", workspace_id=workspace_id, credential_id=credential_id
        ) as lease:
            record = self._load(workspace_id, provider, credential_id, allow_initial_auth=allow_initial_auth)
            values = self._runtime.resolve(record, deployed=deployed)
            if failed_credential_digest:
                refresh_needed = mcp_credential_digest(values) == failed_credential_digest
            else:
                refresh_needed = self._runtime.needs_refresh(record, now=time.time())
            if not refresh_needed:
                return values
            lease.ensure_owned()
            try:
                encrypted = self._runtime.refresh(
                    record,
                    authorization_code=authorization_code,
                    resource_metadata_url=resource_metadata_url,
                    scope_hint=scope_hint,
                )
            except MCPCredentialUnavailableError:
                lease.ensure_owned()
                if not self._credentials.update_mcp_credential_if_unchanged(
                    record=record, encrypted_credentials=record.encrypted_credentials, authed=False
                ):
                    raise CredentialRefreshUnavailableError() from None
                raise
            lease.ensure_owned()
            if not self._credentials.update_mcp_credential_if_unchanged(
                record=record, encrypted_credentials=encrypted, authed=True
            ):
                raise CredentialRefreshUnavailableError()
            return self._runtime.resolve(self._load(workspace_id, provider, credential_id), deployed=deployed)

    def _load(
        self, workspace_id: str, provider: str, credential_id: str, *, allow_initial_auth: bool = False
    ) -> MCPCredentialRecord:
        record = self._credentials.get_mcp_credential(
            workspace_id=workspace_id, provider=provider, credential_id=credential_id
        )
        if record is None or (not record.authed and not allow_initial_auth):
            raise MCPCredentialUnavailableError("Authorize the MCP provider in the Dify console.")
        return record
