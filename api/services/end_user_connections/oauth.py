"""Personal OAuth grants with one-use attempts and revision-conditional reauthorization."""

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime
from hashlib import sha256
from hmac import compare_digest
from typing import Any, Protocol
from urllib.parse import parse_qs, urlsplit

from constants.end_user_connections import ConnectionCredentialType, OAuthClientSource
from services.end_user_connections.api_key import ConnectionCipher, StoredConnection
from services.end_user_connections.contracts import (
    ConnectionOAuthStart,
    ConnectionSummary,
    ConnectionTargetInput,
    ConnectionTargetResolver,
    StartConnectionOAuthInput,
)
from services.end_user_connections.entities import ConnectionMutationGuard, ConnectionOAuthClient, WebConnectionContext
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionConflictError,
    ConnectionNotFoundError,
    ConnectionOAuthError,
    ConnectionReauthorizationRequiredError,
)
from services.end_user_connections.policy import (
    connection_mutation_guard,
    require_creation_target,
    require_owned_connection,
)


@dataclass(frozen=True)
class StoredOAuthClientConfiguration:
    source: OAuthClientSource
    configuration_id: str
    encrypted_parameters: str = field(repr=False)

    @property
    def fingerprint(self) -> str:
        return sha256(self.encrypted_parameters.encode()).hexdigest()


@dataclass(frozen=True)
class OAuthClientSnapshot:
    reference: ConnectionOAuthClient
    fingerprint: str


@dataclass(frozen=True)
class ResolvedOAuthClient:
    snapshot: OAuthClientSnapshot
    parameters: Mapping[str, Any] = field(repr=False)


@dataclass(frozen=True)
class ConnectionOAuthAttempt:
    """Continue the authenticated owner context without binding to a Site code."""

    context: WebConnectionContext
    callback_url: str
    provider: str
    client: OAuthClientSnapshot
    state_digest: str = field(repr=False)
    # Creation captures a published target/name; reauthorization captures a CAS guard.
    target: ConnectionTargetInput | None
    name: str | None
    guard: ConnectionMutationGuard | None


@dataclass(frozen=True)
class ConnectionOAuthGrant:
    credentials: Mapping[str, Any] = field(repr=False)
    expires_at: datetime | None
    # Masked before leaving the plugin adapter; raw metadata is never persisted.
    account_label: str | None


class ConnectionOAuthAttempts(Protocol):
    def save(self, attempt: ConnectionOAuthAttempt) -> str: ...

    def consume(self, context_id: str) -> ConnectionOAuthAttempt: ...

    def callback_url(self, state: str, provider: str) -> str | None: ...


class ConnectionOAuthGateway(Protocol):
    def resolve_client(self, tenant_id: str, provider: str) -> ResolvedOAuthClient: ...

    def authorization_url(self, context: WebConnectionContext, provider: str, client: ResolvedOAuthClient) -> str: ...

    def exchange(
        self, context: WebConnectionContext, provider: str, client: ResolvedOAuthClient, query_string: bytes
    ) -> ConnectionOAuthGrant: ...


class ConnectionOAuthStore(Protocol):
    def find(self, context: WebConnectionContext, connection_id: str) -> StoredConnection | None: ...

    def validate_oauth_context(self, attempt: ConnectionOAuthAttempt) -> None: ...

    def save_oauth(
        self,
        attempt: ConnectionOAuthAttempt,
        *,
        encrypted_credentials: str,
        expires_at: datetime | None,
        account_label: str | None,
    ) -> ConnectionSummary:
        """Revalidate identity, Client snapshot, graph or revision in one bounded transaction."""
        ...


class OAuthConnectionService:
    def __init__(
        self,
        *,
        store: ConnectionOAuthStore,
        targets: ConnectionTargetResolver,
        gateway: ConnectionOAuthGateway,
        attempts: ConnectionOAuthAttempts,
        cipher: ConnectionCipher,
    ) -> None:
        self._store = store
        self._targets = targets
        self._gateway = gateway
        self._attempts = attempts
        self._cipher = cipher

    def start_oauth(
        self, context: WebConnectionContext, command: StartConnectionOAuthInput, *, callback_url: str
    ) -> ConnectionOAuthStart:
        target = self._targets.resolve(context, command)
        client = self._gateway.resolve_client(context.tenant_id, target.provider)
        require_creation_target(
            context,
            workflow_id=str(command.workflow_id),
            node_id=command.node_id,
            credential_type=ConnectionCredentialType.OAUTH2,
            target=replace(target, oauth_client=client.snapshot.reference),
        )
        return self._start(
            context,
            target.provider,
            client,
            callback_url=callback_url,
            target=ConnectionTargetInput(workflow_id=command.workflow_id, node_id=command.node_id),
            name=command.name,
            guard=None,
        )

    def reauthorize_oauth(
        self, context: WebConnectionContext, connection_id: str, *, callback_url: str
    ) -> ConnectionOAuthStart:
        record = self._load(context, connection_id)
        client = self._gateway.resolve_client(context.tenant_id, record.access.provider)
        return self._start(
            context,
            record.access.provider,
            client,
            callback_url=callback_url,
            target=None,
            name=None,
            guard=connection_mutation_guard(context, record.access),
        )

    def _start(
        self,
        context: WebConnectionContext,
        provider: str,
        client: ResolvedOAuthClient,
        *,
        callback_url: str,
        target: ConnectionTargetInput | None,
        name: str | None,
        guard: ConnectionMutationGuard | None,
    ) -> ConnectionOAuthStart:
        url = self._gateway.authorization_url(context, provider, client)
        parsed = urlsplit(url)
        states = parse_qs(parsed.query).get("state", [])
        if parsed.scheme not in {"https", "http"} or not parsed.netloc or len(states) != 1 or not states[0]:
            raise ConnectionOAuthError()
        attempt = ConnectionOAuthAttempt(
            context=context,
            callback_url=f"{callback_url}/{provider}/callback",
            provider=provider,
            client=client.snapshot,
            state_digest=sha256(states[0].encode()).hexdigest(),
            target=target,
            name=name,
            guard=guard,
        )
        return ConnectionOAuthStart(authorization_url=url, context_id=self._attempts.save(attempt))

    def callback_url(self, state: str, provider: str) -> str | None:
        return self._attempts.callback_url(state, provider)

    def consume_attempt(self, context_id: str, *, provider: str) -> ConnectionOAuthAttempt:
        attempt = self._attempts.consume(context_id)
        if attempt.provider != provider:
            raise ConnectionOAuthError()
        return attempt

    def complete_oauth(self, attempt: ConnectionOAuthAttempt, *, query_string: bytes) -> ConnectionSummary:
        # The one-use cookie/state continues the authenticated start request.
        # Every repository read/write reconstructs authority from persisted identity.
        context = attempt.context
        try:
            query = parse_qs(query_string.decode("utf-8"), keep_blank_values=True)
        except UnicodeError:
            raise ConnectionOAuthError() from None
        states = query.get("state", [])
        if (
            "error" in query
            or len(states) != 1
            or not compare_digest(sha256(states[0].encode()).hexdigest(), attempt.state_digest)
        ):
            raise ConnectionOAuthError()
        self._store.validate_oauth_context(attempt)
        if attempt.guard is not None:
            record = self._load(context, attempt.guard.connection_id)
            if connection_mutation_guard(context, record.access) != attempt.guard:
                raise ConnectionConflictError()
        else:
            if attempt.target is None or attempt.name is None:
                raise ConnectionOAuthError()
            target = self._targets.resolve(context, attempt.target)
            if target.provider != attempt.provider:
                raise ConnectionConfigurationError()
            require_creation_target(
                context,
                workflow_id=str(attempt.target.workflow_id),
                node_id=attempt.target.node_id,
                credential_type=ConnectionCredentialType.OAUTH2,
                target=replace(target, oauth_client=attempt.client.reference),
            )
        client = self._gateway.resolve_client(context.tenant_id, attempt.provider)
        if client.snapshot != attempt.client:
            raise ConnectionReauthorizationRequiredError()
        grant = self._gateway.exchange(context, attempt.provider, client, query_string)
        if not grant.credentials:
            raise ConnectionOAuthError()
        encrypted = self._cipher.encrypt(context.tenant_id, grant.credentials)
        return self._store.save_oauth(
            attempt,
            encrypted_credentials=encrypted,
            expires_at=grant.expires_at,
            account_label=grant.account_label,
        )

    def _load(self, context: WebConnectionContext, connection_id: str) -> StoredConnection:
        record = self._store.find(context, connection_id)
        if record is None or record.access.id != connection_id:
            raise ConnectionNotFoundError()
        require_owned_connection(context, record.access)
        if record.access.credential_type != ConnectionCredentialType.OAUTH2:
            raise ConnectionConfigurationError()
        return record
