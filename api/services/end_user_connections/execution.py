"""Explicit selections and secret-free authority carried by one execution."""

from uuid import UUID

from pydantic import BaseModel, Field

from constants.end_user_connections import NodeConnectionStatus
from context.connection_execution import ConnectionExecutionContext, ExecutionConnectionSelection
from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import (
    ConnectionCheckUnavailableError,
    ConnectionConfigurationError,
    ConnectionInvalidCredentialsError,
    ConnectionNotFoundError,
    ConnectionReauthorizationRequiredError,
    ConnectionRequiredError,
)
from services.end_user_connections.preflight import (
    ConnectionId,
    ConnectionPreflightInput,
    ConnectionPreflightService,
    NodeId,
)
from services.end_user_connections.revision import ConnectionRevision


class ConnectionRunInput(BaseModel):
    connection_revision: ConnectionRevision | None = Field(
        default=None,
        description=(
            "Opaque connection contract revision from Web App parameters. Required for EndUser tool authentication; "
            "must match the current authorization requirements and installed plugin artifacts."
        ),
    )

    connections: dict[NodeId, ConnectionId | None] | None = Field(
        default=None,
        description=(
            "Explicit choices keyed by independent authorization node ID. Required for EndUser tool authentication. "
            "Missing/null choices are not filled from saved selections."
        ),
    )


class ConnectionExecutionService:
    def __init__(self, *, preflight: ConnectionPreflightService) -> None:
        self._preflight = preflight

    def prepare(
        self,
        identity: WebConnectionContext,
        command: ConnectionRunInput,
        *,
        workflow_id: str,
        conversation_id: str | None,
    ) -> ConnectionExecutionContext:
        if command.connection_revision is None:
            raise ConnectionConfigurationError()
        result = self._preflight.check(
            identity,
            ConnectionPreflightInput(
                connection_revision=command.connection_revision,
                conversation_id=UUID(conversation_id) if conversation_id is not None else None,
                connections=command.connections or {},
            ),
            workflow_id=workflow_id,
        )
        selections: list[ExecutionConnectionSelection] = []
        for requirement in result.connections:
            match requirement.status:
                case NodeConnectionStatus.DISCONNECTED:
                    if (command.connections or {}).get(requirement.node_id) is not None:
                        raise ConnectionNotFoundError()
                    raise ConnectionRequiredError()
                case NodeConnectionStatus.RECONNECT_REQUIRED:
                    raise ConnectionReauthorizationRequiredError()
                case NodeConnectionStatus.INVALID:
                    raise ConnectionInvalidCredentialsError()
                case None:
                    raise ConnectionCheckUnavailableError()
                case NodeConnectionStatus.CONNECTED:
                    selections.append(
                        ExecutionConnectionSelection(
                            node_id=requirement.node_id,
                            provider=requirement.provider,
                            connection_id=requirement.connection_id,
                        )
                    )
        # The snapshot comes from this completed check, never a second resolution
        # that could observe different requirements or mutable default choices.
        return ConnectionExecutionContext(
            tenant_id=identity.tenant_id,
            app_id=identity.app_id,
            end_user_id=identity.end_user_id,
            account_id=identity.account_id,
            workflow_id=workflow_id,
            connection_revision=result.connection_revision,
            selections=tuple(selections),
        )
