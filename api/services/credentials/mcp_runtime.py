"""Resolve MCP connection secrets and serialize reactive OAuth refreshes.

Only the access token, URL and request headers leave this boundary. A failed
credential digest identifies the exact connection values rejected by the server.
Reloading under the refresh lease prevents concurrent callers rotating twice.
"""

import hashlib
import json
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
    def resolve(self, record: MCPCredentialRecord, *, deployed: bool = True) -> dict[str, Any]:
        """Given a scoped snapshot, return connection secrets without mutating it.

        Deployed requests reject identity forwarding and dynamic headers; debug
        callers retain their request-specific header and identity behavior.
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
    """Hash canonical UTF-8 JSON of connection values; secrets never enter errors."""
    return hashlib.sha256(
        json.dumps(values, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


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
        """Resolve an authorized provider, refreshing once only if its failed values still match.

        A nonempty digest requests a forced refresh under the distributed lease.
        Permanent authorization failure marks that same snapshot unavailable;
        coordination or transport failure preserves it and remains retryable.
        Owner identifiers must come from the admitted caller's scope. Debug may
        pass initial authorization and challenge hints; deployed callers must
        already be authorized. CAS conflicts never overwrite management changes.
        """
        allow_initial_auth = not deployed and authorization_code is not None
        record = self._load(workspace_id, provider, credential_id, allow_initial_auth=allow_initial_auth)
        if not failed_credential_digest:
            return self._runtime.resolve(record, deployed=deployed)
        with self._refresh_lock.acquire(
            credential_type="mcp", workspace_id=workspace_id, credential_id=credential_id
        ) as lease:
            record = self._load(workspace_id, provider, credential_id, allow_initial_auth=allow_initial_auth)
            values = self._runtime.resolve(record, deployed=deployed)
            if mcp_credential_digest(values) != failed_credential_digest:
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
