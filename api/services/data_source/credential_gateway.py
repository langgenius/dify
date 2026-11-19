"""Application ports and policies for datasource credential resolution."""

import logging
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from services.credentials.refresh import (
    CredentialRefreshLock,
    CredentialRefreshUnavailableError,
    credential_needs_refresh,
)
from services.data_source.entities.credential import DatasourceCredentialRecord, DatasourceOAuthClientConfigRecord

logger = logging.getLogger(__name__)


class NotionCredentialUnavailableError(ValueError):
    pass


def resolve_stored_notion_access_token(
    *,
    credential_id: str | None,
    load_token: Callable[[str], str],
    integration_token: str | None,
) -> str:
    """Use the saved credential, then the configured legacy integration.

    Stored documents never select a tenant default credential: changing that
    default must not change the integration used to read an existing document.
    Preserve indexing's environment fallback when credential resolution fails,
    including refresh failures. Actor-selected imports do not use this policy.
    Without a fallback, preserve temporary refresh failures so callers can retry.
    """
    credential_error: Exception | None = None
    if credential_id:
        try:
            token = load_token(credential_id)
            if isinstance(token, str) and token:
                return token
        except Exception as error:
            credential_error = error

    if not integration_token:
        if isinstance(credential_error, CredentialRefreshUnavailableError):
            raise credential_error
        raise NotionCredentialUnavailableError(
            "Must specify `integration_token` or set environment variable `NOTION_INTEGRATION_TOKEN`."
        ) from credential_error

    logger.warning("Stored Notion credential %s unavailable; using NOTION_INTEGRATION_TOKEN", credential_id)
    return integration_token


class DatasourceProviderCredentialStore(Protocol):
    """Persisted provider credentials for already-authorized execution paths."""

    def get_provider_credential(
        self, *, workspace_id: str, provider: str, plugin_id: str, credential_id: str | None
    ) -> DatasourceCredentialRecord | None: ...

    def list_provider_credentials(
        self, *, workspace_id: str, provider: str, plugin_id: str
    ) -> Sequence[DatasourceCredentialRecord]: ...

    def get_oauth_client_config(
        self, *, workspace_id: str, provider: str, plugin_id: str
    ) -> DatasourceOAuthClientConfigRecord: ...

    def update_if_unchanged(
        self, *, record: DatasourceCredentialRecord, encrypted_credentials: Mapping[str, object], expires_at: int
    ) -> bool:
        """Commit a scoped write guarded by owner, auth type, ciphertext and expiry; return false on a conflict."""
        ...


class DatasourceCredentialStore(Protocol):
    def get_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        provider: str,
        plugin_id: str,
    ) -> DatasourceCredentialRecord | None: ...

    def update_if_unchanged(
        self,
        *,
        record: DatasourceCredentialRecord,
        encrypted_credentials: Mapping[str, object],
        expires_at: int,
    ) -> bool: ...


class TrustedDatasourceCredentialStore(Protocol):
    def get_for_stored_document(
        self,
        *,
        workspace_id: str,
        dataset_id: str,
        document_id: str,
        credential_id: str | None,
        provider: str,
        plugin_id: str,
    ) -> DatasourceCredentialRecord | None: ...

    def update_if_unchanged(
        self,
        *,
        record: DatasourceCredentialRecord,
        encrypted_credentials: Mapping[str, object],
        expires_at: int,
    ) -> bool: ...


class DatasourceCredentialCodec(Protocol):
    def decrypt(self, record: DatasourceCredentialRecord) -> dict[str, object]: ...

    def encrypt(
        self,
        record: DatasourceCredentialRecord,
        credentials: Mapping[str, object],
    ) -> dict[str, object]: ...


@dataclass(frozen=True, slots=True)
class RefreshedDatasourceCredential:
    credentials: Mapping[str, object]
    expires_at: int


class DatasourceCredentialRefresher(Protocol):
    def refresh(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        record: DatasourceCredentialRecord,
        credentials: Mapping[str, object],
    ) -> RefreshedDatasourceCredential: ...


class ActorDatasourceCredentialResolver(Protocol):
    """Resolve a credential selected by an authenticated actor."""

    def resolve(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        provider: str,
        plugin_id: str,
    ) -> dict[str, object]: ...


class StoredDatasourceCredentialResolver(Protocol):
    """Resolve a credential proven by an existing document owner chain."""

    def resolve_for_document(
        self,
        *,
        workspace_id: str,
        dataset_id: str,
        document_id: str,
        credential_id: str | None,
        provider: str,
        plugin_id: str,
    ) -> dict[str, object]: ...


class DatasourceCredentialError(Exception):
    """Base class for credential resolution failures."""


class DatasourceCredentialNotFoundError(DatasourceCredentialError):
    def __init__(self) -> None:
        super().__init__("Credential not found")


class DatasourceCredentialConcurrentUpdateError(DatasourceCredentialError):
    def __init__(self) -> None:
        super().__init__("Credential changed while it was being refreshed")


class DatasourceCredentialRefreshError(DatasourceCredentialError):
    def __init__(self, credential_id: str) -> None:
        super().__init__(f"Failed to refresh datasource credential: {credential_id}")


class ActorAwareDatasourceCredentialGateway:
    def __init__(
        self,
        *,
        credentials: DatasourceCredentialStore,
        codec: DatasourceCredentialCodec,
        refresher: DatasourceCredentialRefresher,
        refresh_lock: CredentialRefreshLock,
        now: Callable[[], float] = time.time,
    ) -> None:
        self._credentials = credentials
        self._codec = codec
        self._refresher = refresher
        self._refresh_lock = refresh_lock
        self._now = now

    def resolve(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        provider: str,
        plugin_id: str,
    ) -> dict[str, object]:
        def load_record() -> DatasourceCredentialRecord:
            record = self._credentials.get_visible(
                workspace_id=workspace_id,
                actor_id=actor_id,
                credential_id=credential_id,
                provider=provider,
                plugin_id=plugin_id,
            )
            if record is None:
                raise DatasourceCredentialNotFoundError()
            return record

        return resolve_credential_snapshot(
            load_record(),
            actor_id=actor_id,
            codec=self._codec,
            refresher=self._refresher,
            update=self._credentials.update_if_unchanged,
            load_latest=load_record,
            refresh_lock=self._refresh_lock,
            now=self._now,
        )


class TrustedStoredDatasourceCredentialGateway:
    """Resolve a credential only when a stored document proves the full owner chain."""

    def __init__(
        self,
        *,
        credentials: TrustedDatasourceCredentialStore,
        codec: DatasourceCredentialCodec,
        refresher: DatasourceCredentialRefresher,
        refresh_lock: CredentialRefreshLock,
        now: Callable[[], float] = time.time,
    ) -> None:
        self._credentials = credentials
        self._codec = codec
        self._refresher = refresher
        self._refresh_lock = refresh_lock
        self._now = now

    def resolve_for_document(
        self,
        *,
        workspace_id: str,
        dataset_id: str,
        document_id: str,
        credential_id: str | None,
        provider: str,
        plugin_id: str,
    ) -> dict[str, object]:
        def load_record() -> DatasourceCredentialRecord:
            record = self._credentials.get_for_stored_document(
                workspace_id=workspace_id,
                dataset_id=dataset_id,
                document_id=document_id,
                credential_id=credential_id,
                provider=provider,
                plugin_id=plugin_id,
            )
            if record is None:
                raise DatasourceCredentialNotFoundError()
            return record

        record = load_record()
        return resolve_credential_snapshot(
            record,
            actor_id=None,
            codec=self._codec,
            refresher=self._refresher,
            update=self._credentials.update_if_unchanged,
            load_latest=load_record,
            refresh_lock=self._refresh_lock,
            now=self._now,
        )


class CredentialSnapshotUpdate(Protocol):
    def __call__(
        self, *, record: DatasourceCredentialRecord, encrypted_credentials: Mapping[str, object], expires_at: int
    ) -> bool: ...


def resolve_credential_snapshot(
    record: DatasourceCredentialRecord,
    *,
    actor_id: str | None,
    codec: DatasourceCredentialCodec,
    refresher: DatasourceCredentialRefresher,
    update: CredentialSnapshotUpdate,
    load_latest: Callable[[], DatasourceCredentialRecord],
    refresh_lock: CredentialRefreshLock,
    now: Callable[[], float],
) -> dict[str, object]:
    """Refresh under one lease; an absent actor selects the persisted credential owner.

    Every caller, including legacy provider execution, uses the same credential
    lock. Reloading also rechecks the caller's visibility or stored owner chain.
    """
    if not credential_needs_refresh(record.expires_at, now=now()):
        return codec.decrypt(record)
    with refresh_lock.acquire(
        credential_type="datasource", workspace_id=record.workspace_id, credential_id=record.id
    ) as lease:
        latest = load_latest()
        if (latest.workspace_id, latest.id) != (record.workspace_id, record.id):
            raise DatasourceCredentialConcurrentUpdateError()
        record = latest
        if not credential_needs_refresh(record.expires_at, now=now()):
            return codec.decrypt(record)
        refresh_actor = actor_id if actor_id is not None else record.owner_id
        if refresh_actor is None:
            raise DatasourceCredentialRefreshError(record.id)
        decrypted = codec.decrypt(record)
        lease.ensure_owned()
        refreshed = refresher.refresh(
            workspace_id=record.workspace_id, actor_id=refresh_actor, record=record, credentials=decrypted
        )
        encrypted = codec.encrypt(record, refreshed.credentials)
        lease.ensure_owned()
        if update(record=record, encrypted_credentials=encrypted, expires_at=refreshed.expires_at):
            return dict(refreshed.credentials)
        latest = load_latest()
        if credential_needs_refresh(latest.expires_at, now=now()):
            raise DatasourceCredentialConcurrentUpdateError()
        return codec.decrypt(latest)
