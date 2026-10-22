"""Check explicit selections for a published graph without saving usage relations."""

import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Annotated, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field

from clients.plugin.auth_entities import CredentialCheckResult
from constants.end_user_connections import ConnectionCredentialType, NodeConnectionStatus
from services.end_user_connections.contracts import ConnectionCheckOutcome, ConnectionInput
from services.end_user_connections.entities import (
    ConnectionAccessRecord,
    ConnectionCheckSnapshot,
    NodeConnectionSelection,
    ToolConnectionTarget,
    WebConnectionContext,
)
from services.end_user_connections.errors import (
    ConnectionCheckUnavailableError,
    ConnectionConfigurationError,
    ConnectionConflictError,
    ConnectionNotFoundError,
    ConnectionReauthorizationRequiredError,
)
from services.end_user_connections.policy import require_applicable_connection
from services.end_user_connections.status import resolve_node_connection_state

ConnectionId = Annotated[UUID, Field(strict=False)]
NodeId = Annotated[str, Field(min_length=1, max_length=255)]


class ConnectionPreflightInput(ConnectionInput):
    workflow_id: UUID = Field(
        strict=False,
        description=(
            "Expected connection contract revision from Web App parameters. "
            "Must match the current published workflow; does not select an execution version."
        ),
    )
    # Only existing Chatflow Conversations have an authoritative business Session.
    # None checks a new conversation or a plain Workflow's App/user context.
    conversation_id: UUID | None = Field(
        default=None,
        strict=False,
        description="Existing Chatflow conversation. Omit for a new conversation or plain Workflow.",
    )
    connections: dict[NodeId, ConnectionId | None] = Field(
        description=(
            "Explicit choices keyed by independent authorization node ID. "
            "Missing/null choices remain disconnected; saved choices are never inferred."
        ),
    )


@dataclass(frozen=True)
class ConnectionRequirement:
    target: ToolConnectionTarget
    title: str
    purpose: str
    node_ids: tuple[str, ...]


class ConnectionPreflightRequirement(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    node_id: str = Field(description="Independent authorization node ID to use as the selection key.")
    node_ids: tuple[str, ...] = Field(description="The authorization node and all nodes explicitly reusing it.")
    title: str
    purpose: str
    provider: str
    allowed_credential_types: tuple[ConnectionCredentialType, ...]
    connection_id: str | None
    # None means availability is unknown because the check could not complete;
    # it is not a fifth credential/selection status.
    status: NodeConnectionStatus | None = Field(
        description="Effective node status; null when availability cannot be determined."
    )
    check: CredentialCheckResult | None


class ConnectionPreflightView(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    workflow_id: str = Field(description="Connection contract revision evaluated by this preflight.")
    requirements: tuple[ConnectionPreflightRequirement, ...]

    @computed_field
    @property
    def ready(self) -> bool:
        return all(item.status == NodeConnectionStatus.CONNECTED for item in self.requirements)


class PreflightRequirements(Protocol):
    def resolve(
        self,
        context: WebConnectionContext,
        workflow_id: str,
        conversation_id: str | None,
        *,
        oauth_providers: frozenset[str],
    ) -> tuple[ConnectionRequirement, ...]: ...


class PreflightConnections(Protocol):
    def access_records(
        self, context: WebConnectionContext, connection_ids: frozenset[str]
    ) -> Mapping[str, ConnectionAccessRecord]: ...

    def validate_preflight_context(
        self, context: WebConnectionContext, workflow_id: str, conversation_id: str | None
    ) -> None: ...


class PreflightCredentialChecks(Protocol):
    def check_connection_result(self, context: WebConnectionContext, connection_id: str) -> ConnectionCheckOutcome: ...


class ConnectionPreflightService:
    def __init__(
        self,
        *,
        requirements: PreflightRequirements,
        connections: PreflightConnections,
        checks: PreflightCredentialChecks,
    ) -> None:
        self._requirements = requirements
        self._connections = connections
        self._checks = checks

    def check(self, context: WebConnectionContext, command: ConnectionPreflightInput) -> ConnectionPreflightView:
        conversation_id = str(command.conversation_id) if command.conversation_id is not None else None
        workflow_id = str(command.workflow_id)
        self._connections.validate_preflight_context(context, workflow_id, conversation_id)
        selections = {key: str(value) if value is not None else None for key, value in command.connections.items()}
        ids = frozenset(value for value in selections.values() if value is not None)
        records = self._connections.access_records(context, ids)
        oauth_providers = frozenset(
            record.provider for record in records.values() if record.credential_type == ConnectionCredentialType.OAUTH2
        )
        requirements = self._requirements.resolve(
            context, workflow_id, conversation_id, oauth_providers=oauth_providers
        )
        if command.connections.keys() - {requirement.target.node_id for requirement in requirements}:
            raise ConnectionConfigurationError()
        snapshots: dict[str, ConnectionCheckSnapshot] = {}
        unavailable: set[str] = set()
        for requirement in requirements:
            target = requirement.target
            connection_id = selections.get(target.node_id)
            record = records.get(connection_id) if connection_id is not None else None
            if record is None:
                continue
            try:
                require_applicable_connection(
                    context,
                    record,
                    workflow_id=workflow_id,
                    node_id=target.node_id,
                    target=target,
                )
            except ConnectionReauthorizationRequiredError:
                continue
            if record.id in snapshots or record.id in unavailable:
                continue
            try:
                outcome = self._checks.check_connection_result(context, record.id)
            except ConnectionNotFoundError:
                raise ConnectionConflictError() from None
            except ConnectionCheckUnavailableError:
                unavailable.add(record.id)
            else:
                snapshots[record.id] = ConnectionCheckSnapshot(
                    connection_id=record.id,
                    revision=outcome.revision,
                    result=outcome.view.check,
                )

        # Resolve again after external checks so Client changes cannot leave a
        # stale ready response. The final owner/revision read never loads secrets.
        current_requirements = self._requirements.resolve(
            context, workflow_id, conversation_id, oauth_providers=oauth_providers
        )
        if current_requirements != requirements:
            raise ConnectionConflictError()
        current = self._connections.access_records(context, ids)
        for connection_id, record in records.items():
            expected = snapshots[connection_id].revision if connection_id in snapshots else record.revision
            latest = current.get(connection_id)
            if latest is None or latest.revision != expected:
                raise ConnectionConflictError()
        self._connections.validate_preflight_context(context, workflow_id, conversation_id)

        views: list[ConnectionPreflightRequirement] = []
        for requirement in requirements:
            target = requirement.target
            connection_id = selections.get(target.node_id)
            record = current.get(connection_id) if connection_id is not None else None
            # Missing and foreign IDs produce the same disconnected response.
            if connection_id not in records:
                record = None
            snapshot = snapshots.get(connection_id) if connection_id is not None else None
            check = snapshot.result if snapshot is not None else None
            try:
                state = resolve_node_connection_state(
                    context,
                    selection=NodeConnectionSelection(workflow_id, target.node_id, connection_id),
                    target=target,
                    record=record,
                    check=snapshot,
                )
                status = state.status
                visible_id = state.connection_id
            except ConnectionCheckUnavailableError:
                status = None
                visible_id = record.id if record is not None else None
                if check is None:
                    check = CredentialCheckResult(
                        status="temporarily_unavailable",
                        reason_code="provider_unavailable",
                        retryable=True,
                        checked_at=int(time.time()),
                    )
            views.append(
                ConnectionPreflightRequirement(
                    node_id=target.node_id,
                    node_ids=requirement.node_ids,
                    title=requirement.title,
                    purpose=requirement.purpose,
                    provider=target.provider,
                    allowed_credential_types=tuple(sorted(target.allowed_credential_types)),
                    connection_id=visible_id,
                    status=status,
                    check=check,
                )
            )
        return ConnectionPreflightView(workflow_id=workflow_id, requirements=tuple(views))
