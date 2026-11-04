"""Resolve tool credentials through scoped snapshots and serialized OAuth refreshes."""

import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol

from services.credentials.refresh import CredentialRefreshLock, credential_needs_refresh


@dataclass(frozen=True, slots=True)
class ToolRuntimeCredential:
    """Detached provider state; absent ciphertext represents empty credentials."""

    id: str
    workspace_id: str
    owner_id: str
    provider: str
    credential_type: str
    encrypted_credentials: str | None
    expires_at: int


@dataclass(frozen=True, slots=True)
class RefreshedToolCredential:
    credentials: Mapping[str, object]
    expires_at: int


@dataclass(frozen=True, slots=True)
class ResolvedToolCredential:
    credentials: Mapping[str, object]
    credential_type: str


class ToolCredentialNotFoundError(ValueError):
    pass


class ToolCredentialRefreshError(ValueError):
    pass


class ToolCredentialStore(Protocol):
    def get_tool_credential(
        self, *, workspace_id: str, providers: tuple[str, ...], credential_id: str | None
    ) -> ToolRuntimeCredential | None:
        """Return a detached snapshot, scoped to workspace and provider, preferring the default when ID is absent."""
        ...

    def update_tool_credential_if_unchanged(
        self, *, record: ToolRuntimeCredential, encrypted_credentials: str, expires_at: int
    ) -> bool:
        """Commit in a short transaction, guarding the owner, auth type, expiry and previous ciphertext."""
        ...


class ToolCredentialRuntime(Protocol):
    def check_policy(self, record: ToolRuntimeCredential) -> None: ...

    def decrypt(self, record: ToolRuntimeCredential) -> dict[str, object]: ...

    def encrypt(self, record: ToolRuntimeCredential, credentials: Mapping[str, object]) -> str: ...

    def refresh(self, record: ToolRuntimeCredential, credentials: Mapping[str, object]) -> RefreshedToolCredential: ...

    def invalidate(self, record: ToolRuntimeCredential) -> None: ...


class ToolCredentialService:
    def __init__(
        self,
        *,
        credentials: ToolCredentialStore,
        runtime: ToolCredentialRuntime,
        refresh_lock: CredentialRefreshLock,
        providers: tuple[str, ...],
    ) -> None:
        self._credentials = credentials
        self._runtime = runtime
        self._refresh_lock = refresh_lock
        self._providers = providers

    def resolve(self, *, workspace_id: str, credential_id: str | None) -> ResolvedToolCredential:
        record = self._load(workspace_id=workspace_id, credential_id=credential_id)
        self._runtime.check_policy(record)
        if not credential_needs_refresh(record.expires_at, now=time.time()):
            return self._resolved(record)

        with self._refresh_lock.acquire(
            credential_type="tool", workspace_id=workspace_id, credential_id=record.id
        ) as lease:
            record = self._load(workspace_id=workspace_id, credential_id=record.id)
            self._runtime.check_policy(record)
            if not credential_needs_refresh(record.expires_at, now=time.time()):
                return self._resolved(record)
            decrypted = self._runtime.decrypt(record)
            lease.ensure_owned()
            refreshed = self._runtime.refresh(record, decrypted)
            encrypted = self._runtime.encrypt(record, refreshed.credentials)
            lease.ensure_owned()
            if not self._credentials.update_tool_credential_if_unchanged(
                record=record, encrypted_credentials=encrypted, expires_at=refreshed.expires_at
            ):
                latest = self._load(workspace_id=workspace_id, credential_id=record.id)
                self._runtime.check_policy(latest)
                if credential_needs_refresh(latest.expires_at, now=time.time()):
                    raise ToolCredentialRefreshError("Credential changed while it was being refreshed. Please retry.")
                return self._resolved(latest)
            self._runtime.invalidate(record)
            return ResolvedToolCredential(refreshed.credentials, record.credential_type)

    def _load(self, *, workspace_id: str, credential_id: str | None) -> ToolRuntimeCredential:
        record = self._credentials.get_tool_credential(
            workspace_id=workspace_id, providers=self._providers, credential_id=credential_id
        )
        if record is None:
            raise ToolCredentialNotFoundError("Tool credential not found")
        return record

    def _resolved(self, record: ToolRuntimeCredential) -> ResolvedToolCredential:
        return ResolvedToolCredential(self._runtime.decrypt(record), record.credential_type)
