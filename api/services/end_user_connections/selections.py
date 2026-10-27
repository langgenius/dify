"""Saved App defaults and Conversation choices, independent of immutable Run snapshots."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from context.connection_execution import ConnectionExecutionContext
from services.end_user_connections.contracts import ConnectionSummary
from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import ConnectionRevisionChangedError
from services.end_user_connections.revision import AuthorizationRequirementSnapshot


@dataclass(frozen=True)
class SavedConnectionSelection:
    workflow_id: str
    node_id: str
    provider: str
    connection_id: str


class ConnectionConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    connections: dict[str, ConnectionSummary | None] = Field(
        description=(
            "Saved Connection details keyed by authorization node ID, not a readiness result. "
            "Inaccessible Connection references are returned as null."
        )
    )


class ConnectionSelections(Protocol):
    def save_run_selections(
        self,
        execution: ConnectionExecutionContext,
        workflow_run_id: str,
        conversation_id: str | None,
        *,
        update_conversation: bool,
    ) -> None: ...

    def workflow_requirements(
        self, context: WebConnectionContext, workflow_id: str
    ) -> tuple[AuthorizationRequirementSnapshot, ...]: ...

    def app_selections(self, context: WebConnectionContext) -> tuple[SavedConnectionSelection, ...]: ...

    def conversation_selections(
        self, context: WebConnectionContext, conversation_id: str
    ) -> tuple[SavedConnectionSelection, ...]: ...

    def connection_summaries(
        self, context: WebConnectionContext, connection_ids: frozenset[str]
    ) -> Mapping[str, ConnectionSummary]: ...


class ConnectionSelectionService:
    def __init__(self, *, store: ConnectionSelections) -> None:
        self._store = store

    def restore(self, context: WebConnectionContext, workflow_id: str, conversation_id: str) -> dict[str, UUID]:
        saved = self._store.conversation_selections(context, conversation_id)
        previous_versions = {item.workflow_id for item in saved if item.workflow_id != workflow_id}
        if previous_versions:
            current = self._store.workflow_requirements(context, workflow_id)
            if any(self._store.workflow_requirements(context, version) != current for version in previous_versions):
                raise ConnectionRevisionChangedError()
        return {item.node_id: UUID(item.connection_id) for item in saved}

    def get(self, context: WebConnectionContext, conversation_id: str | None) -> ConnectionConfiguration:
        saved = self._store.conversation_selections(context, conversation_id) if conversation_id is not None else ()
        if not saved:
            saved = self._store.app_selections(context)
        summaries = self._store.connection_summaries(context, frozenset(item.connection_id for item in saved))
        return ConnectionConfiguration(
            connections={item.node_id: summaries.get(item.connection_id) for item in saved},
        )

    def save_run(
        self,
        execution: ConnectionExecutionContext,
        workflow_run_id: str,
        conversation_id: str | None,
        *,
        update_conversation: bool,
    ) -> None:
        self._store.save_run_selections(
            execution, workflow_run_id, conversation_id, update_conversation=update_conversation
        )
