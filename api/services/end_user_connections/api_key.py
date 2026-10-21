"""API-key Connection management with owner-scoped persistence and bounded writes."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import UUID

from clients.plugin.auth_entities import CredentialCheckResult
from constants.end_user_connections import ConnectionCredentialStatus, ConnectionCredentialType
from services.end_user_connections.contracts import (
    ConnectionCheckView,
    ConnectionPage,
    ConnectionSummary,
    ConnectionTargetResolver,
    CreateApiKeyConnectionInput,
    ListConnectionsInput,
    UpdateConnectionInput,
)
from services.end_user_connections.entities import ConnectionAccessRecord, ConnectionMutationGuard, WebConnectionContext
from services.end_user_connections.errors import (
    ConnectionCheckUnavailableError,
    ConnectionConfigurationError,
    ConnectionInvalidCredentialsError,
    ConnectionNotFoundError,
)
from services.end_user_connections.policy import (
    connection_mutation_guard,
    require_creation_target,
    require_owned_connection,
)


@dataclass(frozen=True, slots=True)
class StoredConnection:
    access: ConnectionAccessRecord
    summary: ConnectionSummary
    encrypted_credentials: str = field(repr=False)


@dataclass(frozen=True, slots=True)
class ConnectionChanges:
    # None preserves each stored field; an API key cannot be replaced with null.
    name: str | None
    encrypted_credentials: str | None = field(repr=False)
    credential_status: ConnectionCredentialStatus | None
    touch_activity: bool


class ConnectionStore(Protocol):
    def list(
        self, context: WebConnectionContext, query: ListConnectionsInput, after_id: str | None
    ) -> ConnectionPage: ...

    def find(self, context: WebConnectionContext, connection_id: str) -> StoredConnection | None: ...

    def create_api_key(
        self, context: WebConnectionContext, *, workflow_id: str, provider: str, name: str, encrypted_credentials: str
    ) -> ConnectionSummary: ...

    def update(
        self, context: WebConnectionContext, guard: ConnectionMutationGuard, changes: ConnectionChanges
    ) -> ConnectionSummary:
        """Revalidate identity and CAS; a no-change check still verifies the guard."""
        ...

    def delete(self, context: WebConnectionContext, guard: ConnectionMutationGuard) -> None: ...


class ConnectionCipher(Protocol):
    def encrypt(self, tenant_id: str, credentials: Mapping[str, Any]) -> str: ...

    def decrypt(self, tenant_id: str, ciphertext: str) -> dict[str, Any]: ...


class ApiKeyCredentialGateway(Protocol):
    def validate_format(self, tenant_id: str, provider: str, credentials: Mapping[str, Any]) -> dict[str, Any]: ...

    def check(
        self, context: WebConnectionContext, provider: str, credentials: Mapping[str, Any]
    ) -> CredentialCheckResult: ...


class ApiKeyConnectionService:
    def __init__(
        self,
        *,
        store: ConnectionStore,
        targets: ConnectionTargetResolver,
        credentials: ApiKeyCredentialGateway,
        cipher: ConnectionCipher,
    ) -> None:
        self._store = store
        self._targets = targets
        self._credentials = credentials
        self._cipher = cipher

    def list_connections(self, context: WebConnectionContext, query: ListConnectionsInput) -> ConnectionPage:
        try:
            after_id = str(UUID(query.cursor)) if query.cursor is not None else None
        except ValueError:
            raise ValueError("Invalid connection cursor.") from None
        return self._store.list(context, query, after_id)

    def get_connection(self, context: WebConnectionContext, connection_id: str) -> ConnectionSummary:
        return self._load(context, connection_id).summary

    def create_api_key(self, context: WebConnectionContext, command: CreateApiKeyConnectionInput) -> ConnectionSummary:
        target = self._targets.resolve(context, command)
        require_creation_target(
            context,
            workflow_id=str(command.workflow_id),
            node_id=command.node_id,
            credential_type=ConnectionCredentialType.API_KEY,
            target=target,
        )
        credentials = self._credentials.validate_format(context.tenant_id, target.provider, command.credentials)
        self._require_accepted(self._credentials.check(context, target.provider, credentials))
        ciphertext = self._cipher.encrypt(context.tenant_id, credentials)
        return self._store.create_api_key(
            context,
            workflow_id=target.workflow_id,
            provider=target.provider,
            name=command.name,
            encrypted_credentials=ciphertext,
        )

    def update_connection(
        self, context: WebConnectionContext, connection_id: str, command: UpdateConnectionInput
    ) -> ConnectionSummary:
        record = self._load(context, connection_id)
        guard = connection_mutation_guard(context, record.access)
        ciphertext = None
        status = None
        if command.credentials is not None:
            self._require_api_key(record)
            credentials = self._credentials.validate_format(
                context.tenant_id, record.access.provider, command.credentials
            )
            self._require_accepted(self._credentials.check(context, record.access.provider, credentials))
            ciphertext = self._cipher.encrypt(context.tenant_id, credentials)
            status = ConnectionCredentialStatus.CONNECTED
        return self._store.update(
            context,
            guard,
            ConnectionChanges(
                name=command.name,
                encrypted_credentials=ciphertext,
                credential_status=status,
                touch_activity=ciphertext is not None,
            ),
        )

    def delete_connection(self, context: WebConnectionContext, connection_id: str) -> None:
        record = self._load(context, connection_id)
        self._require_api_key(record)
        self._store.delete(context, connection_mutation_guard(context, record.access))

    def check_connection(self, context: WebConnectionContext, connection_id: str) -> ConnectionCheckView:
        record = self._load(context, connection_id)
        self._require_api_key(record)
        guard = connection_mutation_guard(context, record.access)
        credentials = self._cipher.decrypt(context.tenant_id, record.encrypted_credentials)
        result = self._credentials.check(context, record.access.provider, credentials)
        status = None
        if result.status == "valid":
            status = ConnectionCredentialStatus.CONNECTED
        elif result.status == "invalid":
            status = ConnectionCredentialStatus.INVALID
        if status == record.access.credential_status:
            status = None
        current = self._store.update(
            context,
            guard,
            ConnectionChanges(name=None, encrypted_credentials=None, credential_status=status, touch_activity=False),
        )
        return ConnectionCheckView(connection_id=current.id, check=result, credential_status=current.credential_status)

    def _load(self, context: WebConnectionContext, connection_id: str) -> StoredConnection:
        record = self._store.find(context, connection_id)
        if record is None or record.access.id != connection_id:
            raise ConnectionNotFoundError()
        require_owned_connection(context, record.access)
        return record

    @staticmethod
    def _require_api_key(record: StoredConnection) -> None:
        # OAuth deletion/checking must go through its refresh/revocation lifecycle.
        if record.access.credential_type != ConnectionCredentialType.API_KEY:
            raise ConnectionConfigurationError()

    @staticmethod
    def _require_accepted(result: CredentialCheckResult) -> None:
        if result.status == "invalid":
            raise ConnectionInvalidCredentialsError()
        if result.status == "temporarily_unavailable":
            raise ConnectionCheckUnavailableError()
