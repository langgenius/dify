"""Explicitly authorized App defaults and Conversation choices, separate from Run snapshots."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from constants.end_user_connections import ConnectionCredentialType
from services.end_user_connections.contracts import ConnectionSummary
from services.end_user_connections.entities import ConnectionAccessRecord, WebConnectionContext
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionConflictError,
    ConnectionRevisionChangedError,
)
from services.end_user_connections.policy import require_applicable_connection, require_personal_connection_access
from services.end_user_connections.preflight import (
    ConnectionId,
    ConnectionPreflightInput,
    NodeId,
    PreflightRequirements,
)
from services.end_user_connections.revision import ConnectionRevisionAcceptance, ConnectionSelectionRevisions


@dataclass(frozen=True)
class SavedConnectionSelection:
    workflow_id: str
    node_id: str
    provider: str
    connection_id: str


@dataclass(frozen=True)
class SavedConnectionConfiguration:
    # None identifies a legacy or never-authorized configuration.
    revision: str | None
    selections: tuple[SavedConnectionSelection, ...]

    @property
    def initialized(self) -> bool:
        return self.revision is not None or bool(self.selections)


class SaveConnectionConfigurationInput(ConnectionPreflightInput):
    connections: dict[NodeId, ConnectionId | None] = Field(
        description=(
            "Complete choices keyed by independent authorization node ID. Missing/null nodes are unselected; "
            "an empty map clears the configuration. Saving explicitly approves the submitted authorization contract."
        )
    )


class ConnectionConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    connections: dict[str, ConnectionSummary | None] = Field(
        description=(
            "Saved Connection details keyed by authorization node ID, not a readiness result. "
            "Inaccessible Connection references are returned as null."
        )
    )
    reauthorization_required: bool = Field(
        description=(
            "Whether the saved authorization fails to cover the current App requirements; not credential readiness."
        )
    )


class ConnectionSelections(Protocol):
    def configuration(
        self, context: WebConnectionContext, conversation_id: str | None
    ) -> SavedConnectionConfiguration: ...

    def preflight_graph(
        self, context: WebConnectionContext, workflow_id: str | None, conversation_id: str | None
    ) -> tuple[str, Mapping[str, Any]]: ...

    def access_records(
        self, context: WebConnectionContext, connection_ids: frozenset[str]
    ) -> Mapping[str, ConnectionAccessRecord]: ...

    def save_configuration(
        self,
        context: WebConnectionContext,
        *,
        workflow_id: str,
        conversation_id: str | None,
        selections: tuple[SavedConnectionSelection, ...],
        records: Mapping[str, ConnectionAccessRecord],
        acceptance: ConnectionRevisionAcceptance,
    ) -> None: ...

    def connection_summaries(
        self, context: WebConnectionContext, connection_ids: frozenset[str]
    ) -> Mapping[str, ConnectionSummary]: ...


class ConnectionSelectionService:
    def __init__(
        self,
        *,
        store: ConnectionSelections,
        requirements: PreflightRequirements,
        revisions: ConnectionSelectionRevisions,
    ) -> None:
        self._store = store
        self._requirements = requirements
        self._revisions = revisions

    def restore(self, context: WebConnectionContext, workflow_id: str, conversation_id: str) -> dict[str, UUID]:
        saved = self._store.configuration(context, conversation_id)
        if saved.initialized:
            _, graph = self._store.preflight_graph(context, workflow_id, conversation_id)
            if saved.revision is None:
                raise ConnectionRevisionChangedError()
            self._revisions.require(context.tenant_id, context.app_id, graph, saved.revision)
        return {item.node_id: UUID(item.connection_id) for item in saved.selections}

    def get(self, context: WebConnectionContext, conversation_id: str | None) -> ConnectionConfiguration:
        saved = self._store.configuration(context, conversation_id)
        if conversation_id is not None and not saved.initialized:
            saved = self._store.configuration(context, None)
        try:
            _, graph = self._store.preflight_graph(context, None, conversation_id)
        except ConnectionRevisionChangedError:
            # Keep historical choices readable when their publication is unavailable.
            reauthorization_required = True
        else:
            reauthorization_required = self._revisions.requires_reauthorization(
                context.tenant_id, context.app_id, graph, saved.revision
            )
        return self._view(context, saved.selections, reauthorization_required=reauthorization_required)

    def save(self, context: WebConnectionContext, command: SaveConnectionConfigurationInput) -> ConnectionConfiguration:
        conversation_id = str(command.conversation_id) if command.conversation_id is not None else None
        ids = frozenset(str(value) for value in command.connections.values() if value is not None)
        if ids:
            require_personal_connection_access(context)
        records = self._store.access_records(context, ids)
        oauth_providers = frozenset(
            record.provider for record in records.values() if record.credential_type == ConnectionCredentialType.OAUTH2
        )
        workflow_id, revision, requirements = self._requirements.resolve(
            context,
            None,
            conversation_id,
            oauth_providers=oauth_providers,
            connection_revision=command.connection_revision,
        )
        if requirements:
            require_personal_connection_access(context)
        if command.connections.keys() - {item.target.node_id for item in requirements}:
            raise ConnectionConfigurationError()
        selections = []
        for requirement in requirements:
            target = requirement.target
            connection_id = command.connections.get(target.node_id)
            if connection_id is None:
                continue
            record = require_applicable_connection(
                context, records.get(str(connection_id)), workflow_id=workflow_id, node_id=target.node_id, target=target
            )
            selections.append(SavedConnectionSelection(workflow_id, target.node_id, record.provider, record.id))
        # Metadata resolution may involve plugins. Recheck before entering the bounded write transaction.
        _, current_revision, current_requirements = self._requirements.resolve(
            context,
            workflow_id,
            conversation_id,
            oauth_providers=oauth_providers,
            connection_revision=command.connection_revision,
        )
        if current_revision != revision or current_requirements != requirements:
            raise ConnectionConflictError()
        self._store.save_configuration(
            context,
            workflow_id=workflow_id,
            conversation_id=conversation_id,
            selections=tuple(selections),
            records=records,
            acceptance=ConnectionRevisionAcceptance.from_revisions(command.connection_revision, revision),
        )
        return self._view(context, tuple(selections), reauthorization_required=False)

    def _view(
        self,
        context: WebConnectionContext,
        selections: tuple[SavedConnectionSelection, ...],
        *,
        reauthorization_required: bool,
    ) -> ConnectionConfiguration:
        summaries = self._store.connection_summaries(context, frozenset(item.connection_id for item in selections))
        return ConnectionConfiguration(
            connections={item.node_id: summaries.get(item.connection_id) for item in selections},
            reauthorization_required=reauthorization_required,
        )
