"""OAuth checks, refresh and best-effort revocation of owner-scoped Connections."""

import logging
from collections.abc import Mapping
from contextlib import AbstractContextManager
from datetime import UTC, datetime
from typing import Any, Protocol

from clients.plugin.auth_entities import CredentialCheckResult, OAuthRevokeResult
from constants.end_user_connections import ConnectionCredentialStatus
from services.end_user_connections.contracts import ConnectionCheckView
from services.end_user_connections.entities import ConnectionMutationGuard, ConnectionOAuthClient, WebConnectionContext
from services.end_user_connections.errors import ConnectionNotFoundError, ConnectionReauthorizationRequiredError
from services.end_user_connections.management import ConnectionCipher, StoredConnection
from services.end_user_connections.oauth import ConnectionOAuthGrant, OAuthClientSnapshot, ResolvedOAuthClient
from services.end_user_connections.policy import connection_mutation_guard

logger = logging.getLogger(__name__)


class OAuthLifecycleGateway(Protocol):
    def resolve_client(self, tenant_id: str, provider: str) -> ResolvedOAuthClient: ...

    def resolve_grant_client(
        self, tenant_id: str, provider: str, reference: ConnectionOAuthClient
    ) -> ResolvedOAuthClient: ...

    def refresh(
        self, context: WebConnectionContext, provider: str, client: ResolvedOAuthClient, credentials: Mapping[str, Any]
    ) -> ConnectionOAuthGrant | CredentialCheckResult: ...

    def check(
        self, context: WebConnectionContext, provider: str, credentials: Mapping[str, Any]
    ) -> CredentialCheckResult: ...

    def revoke(
        self, context: WebConnectionContext, provider: str, client: ResolvedOAuthClient, credentials: Mapping[str, Any]
    ) -> OAuthRevokeResult: ...


class OAuthLifecycleStore(Protocol):
    def find(self, context: WebConnectionContext, connection_id: str) -> StoredConnection | None: ...

    def update_oauth_check(
        self,
        context: WebConnectionContext,
        guard: ConnectionMutationGuard,
        *,
        client: OAuthClientSnapshot,
        status: ConnectionCredentialStatus,
        refreshed: ConnectionOAuthGrant | None,
        ciphertext: str | None,
    ) -> StoredConnection:
        """Guard owner/revision/Client, persist refresh or status, and preserve activity."""
        ...


class OAuthRefreshLease(Protocol):
    def ensure_owned(self) -> None: ...


class OAuthRefreshLocks(Protocol):
    def acquire(self, tenant_id: str, connection_id: str) -> AbstractContextManager[OAuthRefreshLease]: ...


class OAuthConnectionLifecycleService:
    def __init__(
        self,
        *,
        store: OAuthLifecycleStore,
        gateway: OAuthLifecycleGateway,
        cipher: ConnectionCipher,
        refresh_locks: OAuthRefreshLocks,
    ) -> None:
        self._store = store
        self._gateway = gateway
        self._cipher = cipher
        self._refresh_locks = refresh_locks

    @staticmethod
    def _expired(record: StoredConnection) -> bool:
        expiration = record.summary.expires_at
        return expiration is not None and expiration <= datetime.now(UTC).replace(tzinfo=None)

    def check(self, context: WebConnectionContext, record: StoredConnection) -> ConnectionCheckView:
        if not self._expired(record):
            return self._check(context, record, lease=None, refresh_required=False)
        return self._check_with_refresh_lock(context, record, force_refresh=False)

    def _check_with_refresh_lock(
        self, context: WebConnectionContext, record: StoredConnection, *, force_refresh: bool
    ) -> ConnectionCheckView:
        # CAS alone cannot prevent two remote refreshes from rotating the same
        # refresh token. Serialize that side effect without holding a DB transaction.
        with self._refresh_locks.acquire(context.tenant_id, record.access.id) as lease:
            current = self._store.find(context, record.access.id)
            if current is None:
                raise ConnectionNotFoundError()
            return self._check(
                context,
                current,
                lease=lease,
                refresh_required=self._expired(current)
                or (force_refresh and current.access.revision == record.access.revision),
            )

    def _check(
        self,
        context: WebConnectionContext,
        record: StoredConnection,
        *,
        lease: OAuthRefreshLease | None,
        refresh_required: bool,
    ) -> ConnectionCheckView:
        guard = connection_mutation_guard(context, record.access)
        client = self._gateway.resolve_client(context.tenant_id, record.access.provider)
        if record.access.oauth_client != client.snapshot.reference:
            # Configuration applicability is not the grant's intrinsic status.
            raise ConnectionReauthorizationRequiredError()
        credentials = self._cipher.decrypt(context.tenant_id, record.encrypted_credentials)
        refreshed = None
        ciphertext = None
        if refresh_required:
            outcome = self._gateway.refresh(context, record.access.provider, client, credentials)
            if isinstance(outcome, ConnectionOAuthGrant):
                refreshed = outcome
                credentials = dict(outcome.credentials)
                ciphertext = self._cipher.encrypt(context.tenant_id, credentials)
                now = datetime.now(UTC).replace(tzinfo=None)
                if outcome.expires_at is not None and outcome.expires_at <= now:
                    result = CredentialCheckResult(
                        status="invalid",
                        reason_code="credential_expired",
                        retryable=False,
                        checked_at=int(datetime.now(UTC).timestamp()),
                    )
                else:
                    result = self._gateway.check(context, record.access.provider, credentials)
            else:
                result = outcome
        else:
            result = self._gateway.check(context, record.access.provider, credentials)
            if result.status == "invalid" and result.reason_code == "credential_expired":
                if lease is None:
                    return self._check_with_refresh_lock(context, record, force_refresh=True)
                return self._check(context, record, lease=lease, refresh_required=True)
        status = ConnectionCredentialStatus.CONNECTED if refreshed is not None else record.access.credential_status
        if result.status == "valid":
            status = ConnectionCredentialStatus.CONNECTED
        elif result.status == "invalid":
            status = ConnectionCredentialStatus.INVALID
        if lease is not None:
            lease.ensure_owned()
        current = self._store.update_oauth_check(
            context,
            guard,
            client=client.snapshot,
            status=status,
            refreshed=refreshed,
            ciphertext=ciphertext,
        )
        return ConnectionCheckView(
            connection_id=current.access.id,
            check=result,
            credential_status=current.access.credential_status,
        )

    def revoke_deleted(self, context: WebConnectionContext, record: StoredConnection) -> None:
        try:
            reference = record.access.oauth_client
            if reference is None:
                return
            client = self._gateway.resolve_grant_client(context.tenant_id, record.access.provider, reference)
            credentials = self._cipher.decrypt(context.tenant_id, record.encrypted_credentials)
            result = self._gateway.revoke(context, record.access.provider, client, credentials)
            if result.status in {"failed", "temporarily_unavailable"}:
                logger.warning(
                    "OAuth revocation incomplete for deleted Connection %s: %s", record.access.id, result.status
                )
        except Exception:
            # Provider/Client removal and secret failures must not undo deletion.
            # Upstream exceptions may contain tokens or Client secrets.
            logger.warning("OAuth revocation unavailable for deleted Connection %s", record.access.id)
