"""Load current credentials for one fixed execution selection."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from constants.end_user_connections import ConnectionCredentialStatus, NodeConnectionStatus
from services.end_user_connections.contracts import ConnectionCredentialChecks
from services.end_user_connections.entities import (
    ConnectionAccessRecord,
    ConnectionCheckSnapshot,
    NodeConnectionSelection,
    ToolConnectionTarget,
    WebConnectionContext,
)
from services.end_user_connections.errors import (
    ConnectionConflictError,
    ConnectionInvalidCredentialsError,
    ConnectionReauthorizationRequiredError,
)
from services.end_user_connections.management import ConnectionChanges, ConnectionCipher, ConnectionStore
from services.end_user_connections.policy import connection_mutation_guard, require_applicable_connection
from services.end_user_connections.status import resolve_node_connection_state


@dataclass(frozen=True, slots=True)
class ResolvedConnectionCredentials:
    access: ConnectionAccessRecord
    credentials: Mapping[str, Any] = field(repr=False)


class ConnectionRuntimeService:
    def __init__(self, *, store: ConnectionStore, checks: ConnectionCredentialChecks, cipher: ConnectionCipher) -> None:
        self._store = store
        self._checks = checks
        self._cipher = cipher

    def resolve(
        self, context: WebConnectionContext, *, connection_id: str, target: ToolConnectionTarget
    ) -> ResolvedConnectionCredentials:
        record = self._store.find(context, connection_id)
        access = require_applicable_connection(
            context,
            record.access if record is not None else None,
            workflow_id=target.workflow_id,
            node_id=target.node_id,
            target=target,
        )
        if access.credential_status == ConnectionCredentialStatus.INVALID:
            raise ConnectionInvalidCredentialsError()
        if access.credential_status == ConnectionCredentialStatus.RECONNECT_REQUIRED:
            raise ConnectionReauthorizationRequiredError()
        outcome = self._checks.check_connection_result(context, connection_id)
        current = self._store.find(context, connection_id)
        latest = require_applicable_connection(
            context,
            current.access if current is not None else None,
            workflow_id=target.workflow_id,
            node_id=target.node_id,
            target=target,
        )
        if latest.revision != outcome.revision:
            raise ConnectionConflictError()
        state = resolve_node_connection_state(
            context,
            selection=NodeConnectionSelection(target.workflow_id, target.node_id, connection_id),
            target=target,
            record=latest,
            check=ConnectionCheckSnapshot(connection_id, outcome.revision, outcome.view.check),
        )
        if state.status == NodeConnectionStatus.INVALID:
            raise ConnectionInvalidCredentialsError()
        if state.status == NodeConnectionStatus.RECONNECT_REQUIRED:
            raise ConnectionReauthorizationRequiredError()
        if state.status != NodeConnectionStatus.CONNECTED:
            raise ConnectionConflictError()
        assert current is not None
        credentials = self._cipher.decrypt(context.tenant_id, current.encrypted_credentials)
        # A no-change CAS also detects deletion or replacement during decryption.
        self._store.update(
            context,
            connection_mutation_guard(context, latest),
            ConnectionChanges(name=None, encrypted_credentials=None, credential_status=None, touch_activity=False),
        )
        return ResolvedConnectionCredentials(access=latest, credentials=credentials)
