"""OAuth checks, refresh and best-effort revocation of owner-scoped Connections."""

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from clients.plugin.auth_entities import CredentialCheckResult, OAuthRevokeResult
from constants.end_user_connections import ConnectionCredentialStatus
from services.end_user_connections.contracts import ConnectionCheckOutcome, ConnectionCheckView
from services.end_user_connections.entities import ConnectionMutationGuard, ConnectionOAuthClient, WebConnectionContext
from services.end_user_connections.errors import (
    ConnectionConflictError,
    ConnectionNotFoundError,
    ConnectionReauthorizationRequiredError,
)
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


@dataclass(frozen=True)
class OAuthRefreshResult:
    view: ConnectionCheckView
    revision: int
    client: OAuthClientSnapshot


class OAuthRefreshSingleFlight(Protocol):
    def run(
        self, guard: ConnectionMutationGuard, operation: Callable[[OAuthRefreshLease], OAuthRefreshResult]
    ) -> OAuthRefreshResult:
        """Concurrent callers join one operation and share its result or failure."""
        ...


class OAuthConnectionLifecycleService:
    def __init__(
        self,
        *,
        store: OAuthLifecycleStore,
        gateway: OAuthLifecycleGateway,
        cipher: ConnectionCipher,
        refreshes: OAuthRefreshSingleFlight,
    ) -> None:
        self._store = store
        self._gateway = gateway
        self._cipher = cipher
        self._refreshes = refreshes

    @staticmethod
    def _expired(record: StoredConnection) -> bool:
        expiration = record.summary.expires_at
        return expiration is not None and expiration <= datetime.now(UTC).replace(tzinfo=None)

    def _resolve(
        self, context: WebConnectionContext, record: StoredConnection
    ) -> tuple[ResolvedOAuthClient, dict[str, Any]]:
        connection_mutation_guard(context, record.access)
        client = self._gateway.resolve_client(context.tenant_id, record.access.provider)
        if record.access.oauth_client != client.snapshot.reference:
            raise ConnectionReauthorizationRequiredError()
        return client, self._cipher.decrypt(context.tenant_id, record.encrypted_credentials)

    @staticmethod
    def _reports_expired(result: CredentialCheckResult) -> bool:
        return result.status == "invalid" and result.reason_code == "credential_expired"

    def check(self, context: WebConnectionContext, record: StoredConnection) -> ConnectionCheckOutcome:
        if self._expired(record):
            return self._refresh_once(context, record, force_refresh=False)
        client, credentials = self._resolve(context, record)
        result = self._gateway.check(context, record.access.provider, credentials)
        if self._reports_expired(result):
            return self._refresh_once(context, record, force_refresh=True)
        outcome = self._persist(context, record, client, result, refreshed=None, lease=None)
        return ConnectionCheckOutcome(view=outcome.view, revision=outcome.revision)

    def _refresh_once(
        self, context: WebConnectionContext, record: StoredConnection, *, force_refresh: bool
    ) -> ConnectionCheckOutcome:
        guard = connection_mutation_guard(context, record.access)
        result = self._refreshes.run(
            guard,
            lambda lease: self._refresh_and_check(context, record, lease, force_refresh=force_refresh),
        )
        if result.view.connection_id != guard.connection_id:
            raise ConnectionConflictError()
        # A shared result is not authority. Each waiting caller revalidates its
        # own identity, the resulting revision and the Client before returning it.
        current = self._store.update_oauth_check(
            context,
            ConnectionMutationGuard(
                connection_id=guard.connection_id,
                tenant_id=guard.tenant_id,
                owner=guard.owner,
                revision=result.revision,
            ),
            client=result.client,
            status=result.view.credential_status,
            refreshed=None,
            ciphertext=None,
        )
        return ConnectionCheckOutcome(
            view=result.view.model_copy(update={"credential_status": current.access.credential_status}),
            revision=current.access.revision,
        )

    def _refresh_and_check(
        self,
        context: WebConnectionContext,
        previous: StoredConnection,
        lease: OAuthRefreshLease,
        *,
        force_refresh: bool,
    ) -> OAuthRefreshResult:
        record = self._store.find(context, previous.access.id)
        if record is None:
            raise ConnectionNotFoundError()
        client, credentials = self._resolve(context, record)
        refresh_required = self._expired(record) or (
            force_refresh and record.access.revision == previous.access.revision
        )
        if not refresh_required:
            result = self._gateway.check(context, record.access.provider, credentials)
            if not self._reports_expired(result):
                return self._persist(context, record, client, result, refreshed=None, lease=lease)

        # Exactly one refresh, followed by at most one check. Even if the new
        # grant is still expired, this invocation never refreshes it again.
        lease.ensure_owned()
        outcome = self._gateway.refresh(context, record.access.provider, client, credentials)
        refreshed = None
        if isinstance(outcome, ConnectionOAuthGrant):
            refreshed = outcome
            now = datetime.now(UTC).replace(tzinfo=None)
            if outcome.expires_at is not None and outcome.expires_at <= now:
                result = CredentialCheckResult(
                    status="invalid",
                    reason_code="credential_expired",
                    retryable=False,
                    checked_at=int(datetime.now(UTC).timestamp()),
                )
            else:
                result = self._gateway.check(context, record.access.provider, outcome.credentials)
        else:
            result = outcome
        return self._persist(context, record, client, result, refreshed=refreshed, lease=lease)

    def _persist(
        self,
        context: WebConnectionContext,
        record: StoredConnection,
        client: ResolvedOAuthClient,
        result: CredentialCheckResult,
        *,
        refreshed: ConnectionOAuthGrant | None,
        lease: OAuthRefreshLease | None,
    ) -> OAuthRefreshResult:
        status = ConnectionCredentialStatus.CONNECTED if refreshed is not None else record.access.credential_status
        if result.status == "valid":
            status = ConnectionCredentialStatus.CONNECTED
        elif result.status == "invalid":
            status = ConnectionCredentialStatus.INVALID
        ciphertext = self._cipher.encrypt(context.tenant_id, refreshed.credentials) if refreshed is not None else None
        if lease is not None:
            lease.ensure_owned()
        current = self._store.update_oauth_check(
            context,
            connection_mutation_guard(context, record.access),
            client=client.snapshot,
            status=status,
            refreshed=refreshed,
            ciphertext=ciphertext,
        )
        return OAuthRefreshResult(
            view=ConnectionCheckView(
                connection_id=current.access.id,
                check=result,
                credential_status=current.access.credential_status,
            ),
            revision=current.access.revision,
            client=client.snapshot,
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
