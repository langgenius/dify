"""Saved App defaults and Conversation choices, independent of immutable Run snapshots."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from context.connection_execution import ConnectionExecutionContext
from services.end_user_connections.entities import ConnectionAccessRecord, WebConnectionContext
from services.end_user_connections.errors import ConnectionConflictError, ConnectionWorkflowChangedError


@dataclass(frozen=True)
class SavedConnectionSelection:
    workflow_id: str
    node_id: str
    provider: str
    connection_id: str


class ConnectionConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    workflow_id: str | None = Field(description="Workflow of the saved choices; null when no choices remain saved.")
    connections: dict[str, str | None] = Field(
        description=(
            "Last accepted choices keyed by authorization node ID, not a readiness result. "
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

    def app_selections(self, context: WebConnectionContext) -> tuple[SavedConnectionSelection, ...]: ...

    def conversation_selections(
        self, context: WebConnectionContext, conversation_id: str
    ) -> tuple[SavedConnectionSelection, ...]: ...

    def access_records(
        self, context: WebConnectionContext, connection_ids: frozenset[str]
    ) -> Mapping[str, ConnectionAccessRecord]: ...


class ConnectionSelectionService:
    def __init__(self, *, store: ConnectionSelections) -> None:
        self._store = store

    def restore(self, context: WebConnectionContext, workflow_id: str, conversation_id: str) -> dict[str, UUID]:
        saved = self._store.conversation_selections(context, conversation_id)
        if any(item.workflow_id != workflow_id for item in saved):
            raise ConnectionWorkflowChangedError()
        return {item.node_id: UUID(item.connection_id) for item in saved}

    def get(self, context: WebConnectionContext, conversation_id: str | None) -> ConnectionConfiguration:
        saved = (
            self._store.conversation_selections(context, conversation_id)
            if conversation_id is not None
            else self._store.app_selections(context)
        )
        if conversation_id is not None and not saved:
            saved = self._store.app_selections(context)
        workflow_ids = {item.workflow_id for item in saved}
        if len(workflow_ids) > 1:
            raise ConnectionConflictError()
        records = self._store.access_records(context, frozenset(item.connection_id for item in saved))
        return ConnectionConfiguration(
            workflow_id=next(iter(workflow_ids), None),
            connections={item.node_id: item.connection_id if item.connection_id in records else None for item in saved},
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
