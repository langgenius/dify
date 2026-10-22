"""Explicit selections and secret-free authority carried by one execution."""

from uuid import UUID

from pydantic import BaseModel, Field

from constants.end_user_connections import ConnectionCredentialType
from context.connection_execution import ConnectionExecutionContext, ExecutionConnectionSelection
from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import ConnectionConfigurationError, ConnectionWorkflowChangedError
from services.end_user_connections.policy import require_applicable_connection
from services.end_user_connections.preflight import ConnectionId, NodeId, PreflightConnections, PreflightRequirements


class ConnectionRunInput(BaseModel):
    workflow_id: UUID | None = Field(
        default=None,
        strict=False,
        description=(
            "Connections protocol revision from Web App parameters. Required for EndUser tool authentication; "
            "must match the current published workflow and does not select an execution version."
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
    def __init__(self, *, requirements: PreflightRequirements, connections: PreflightConnections) -> None:
        self._requirements = requirements
        self._connections = connections

    def prepare(
        self,
        identity: WebConnectionContext,
        command: ConnectionRunInput,
        *,
        workflow_id: str,
        conversation_id: str | None,
    ) -> ConnectionExecutionContext:
        if command.workflow_id is None:
            raise ConnectionConfigurationError()
        if str(command.workflow_id) != workflow_id:
            raise ConnectionWorkflowChangedError()
        self._connections.validate_preflight_context(identity, workflow_id, conversation_id)
        choices = {key: str(value) if value is not None else None for key, value in (command.connections or {}).items()}
        ids = frozenset(value for value in choices.values() if value is not None)
        records = self._connections.access_records(identity, ids)
        requirements = self._requirements.resolve(
            identity,
            workflow_id,
            conversation_id,
            oauth_providers=frozenset(
                record.provider
                for record in records.values()
                if record.credential_type == ConnectionCredentialType.OAUTH2
            ),
        )
        if requirements and command.connections is None:
            raise ConnectionConfigurationError()
        if choices.keys() - {requirement.target.node_id for requirement in requirements}:
            raise ConnectionConfigurationError()
        selections: list[ExecutionConnectionSelection] = []
        for requirement in requirements:
            target = requirement.target
            connection_id = choices.get(target.node_id)
            if connection_id is not None:
                require_applicable_connection(
                    identity,
                    records.get(connection_id),
                    workflow_id=workflow_id,
                    node_id=target.node_id,
                    target=target,
                )
            selections.append(
                ExecutionConnectionSelection(
                    node_id=target.node_id,
                    node_ids=requirement.node_ids,
                    provider=target.provider,
                    connection_id=connection_id,
                )
            )
        self._connections.validate_preflight_context(identity, workflow_id, conversation_id)
        return ConnectionExecutionContext(
            tenant_id=identity.tenant_id,
            app_id=identity.app_id,
            end_user_id=identity.end_user_id,
            account_id=identity.account_id,
            workflow_id=workflow_id,
            conversation_id=conversation_id,
            selections=tuple(selections),
        )
