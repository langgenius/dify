"""Application ports and policies for datasource credential resolution."""

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol

from services.entities.data_source.credential import DatasourceCredentialRecord


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
        now: Callable[[], float] = time.time,
    ) -> None:
        self._credentials = credentials
        self._codec = codec
        self._refresher = refresher
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
        record = self._get_visible(
            workspace_id=workspace_id,
            actor_id=actor_id,
            credential_id=credential_id,
            provider=provider,
            plugin_id=plugin_id,
        )
        return resolve_credential_snapshot(
            record,
            actor_id=actor_id,
            codec=self._codec,
            refresher=self._refresher,
            update=self._credentials.update_if_unchanged,
            load_latest=lambda: self._get_visible(
                workspace_id=workspace_id,
                actor_id=actor_id,
                credential_id=credential_id,
                provider=provider,
                plugin_id=plugin_id,
            ),
            now=self._now,
        )

    def _get_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        provider: str,
        plugin_id: str,
    ) -> DatasourceCredentialRecord:
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


class TrustedStoredDatasourceCredentialGateway:
    """Resolve a credential only when a stored document proves the full owner chain."""

    def __init__(
        self,
        *,
        credentials: TrustedDatasourceCredentialStore,
        codec: DatasourceCredentialCodec,
        refresher: DatasourceCredentialRefresher,
        now: Callable[[], float] = time.time,
    ) -> None:
        self._credentials = credentials
        self._codec = codec
        self._refresher = refresher
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
        record = self._get_for_document(
            workspace_id=workspace_id,
            dataset_id=dataset_id,
            document_id=document_id,
            credential_id=credential_id,
            provider=provider,
            plugin_id=plugin_id,
        )
        return resolve_credential_snapshot(
            record,
            actor_id=record.owner_id,
            codec=self._codec,
            refresher=self._refresher,
            update=self._credentials.update_if_unchanged,
            load_latest=lambda: self._get_for_document(
                workspace_id=workspace_id,
                dataset_id=dataset_id,
                document_id=document_id,
                credential_id=credential_id,
                provider=provider,
                plugin_id=plugin_id,
            ),
            now=self._now,
        )

    def _get_for_document(
        self,
        *,
        workspace_id: str,
        dataset_id: str,
        document_id: str,
        credential_id: str | None,
        provider: str,
        plugin_id: str,
    ) -> DatasourceCredentialRecord:
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


def credential_needs_refresh(expires_at: int, *, now: float) -> bool:
    return expires_at != -1 and expires_at - 60 < int(now)


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
    now: Callable[[], float],
) -> dict[str, object]:
    decrypted = codec.decrypt(record)
    if not credential_needs_refresh(record.expires_at, now=now()):
        return decrypted
    if actor_id is None:
        raise DatasourceCredentialRefreshError(record.id)
    refreshed = refresher.refresh(
        workspace_id=record.workspace_id, actor_id=actor_id, record=record, credentials=decrypted
    )
    if update(
        record=record,
        encrypted_credentials=codec.encrypt(record, refreshed.credentials),
        expires_at=refreshed.expires_at,
    ):
        return dict(refreshed.credentials)
    latest = load_latest()
    if credential_needs_refresh(latest.expires_at, now=now()):
        raise DatasourceCredentialConcurrentUpdateError()
    return codec.decrypt(latest)
