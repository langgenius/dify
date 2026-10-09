"""Workflow use-case data shared by adapters, independent of service implementations."""

from __future__ import annotations

import json
from collections.abc import Callable, Generator, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol

from core.workflow.nodes.trigger_schedule.entities import ScheduleConfig
from enums.agent import WorkflowAgentBindingType
from graphon.entities.graph_config import NodeConfigDict
from graphon.variables import VariableBase
from services.agent.publication_contracts import AgentPublicationState

RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE = "source workflow must be published"
MAX_WORKFLOW_ONLINE_USERS_REQUEST_IDS = 1000

type WorkflowGeneration = Mapping[str, Any] | Generator[str, None, None]


@dataclass(frozen=True)
class WorkflowOwner:
    id: str
    kind: Literal["app", "snippet", "pipeline"] = "app"


@dataclass(frozen=True)
class DraftSyncCommand:
    graph: dict[str, Any]
    features: dict[str, Any]
    unique_hash: str | None
    is_collaborative: bool
    environment_upserts: list[dict[str, Any]] | None
    environment_deletions: list[str]
    conversation_variables: list[dict[str, Any]]
    environment_variables: list[dict[str, Any]] | None = None
    clear_debug_variables: bool = False
    check_hash: bool = True
    input_fields: list[dict[str, Any]] | None = None
    rag_pipeline_variables: list[dict[str, Any]] | None = None


@dataclass(frozen=True)
class WorkflowChange:
    hash: str
    updated_at: datetime


@dataclass(frozen=True)
class WorkflowPublication:
    created_at: datetime
    graph: str


@dataclass(frozen=True)
class WorkflowBindingScope:
    id: str
    tenant_id: str
    app_id: str
    version: str
    graph: str

    @property
    def graph_dict(self) -> dict[str, Any]:
        return json.loads(self.graph)


@dataclass(frozen=True)
class WorkflowSnapshot(WorkflowBindingScope):
    """Detached stored values, including encrypted variables, for one exact revision."""

    type: str
    kind: str | None
    version_number: int | None
    marked_name: str
    marked_comment: str
    hash: str
    features: str
    environment_variables: str
    conversation_variables: str
    rag_pipeline_variables: str
    created_by: str
    created_at: datetime
    updated_by: str | None
    updated_at: datetime
    execution_id: str | None = None


@dataclass(frozen=True)
class PreparedEnvironmentVariables:
    workflow_id: str | None
    source: str | None
    value: str


@dataclass(frozen=True)
class PreparedDraftSync:
    source: WorkflowSnapshot | None
    environment: PreparedEnvironmentVariables | None


@dataclass(frozen=True)
class WorkflowRecord:
    """Materialized response data; environment secrets contain only display masks."""

    id: str
    graph: dict[str, Any]
    features: dict[str, Any]
    hash: str
    version: str
    version_number: int | None
    marked_name: str
    marked_comment: str
    created_by: dict[str, str] | None
    created_at: datetime
    updated_by: dict[str, str] | None
    updated_at: datetime
    tool_published: bool
    environment_variables: list[VariableBase]
    conversation_variables: list[VariableBase]
    rag_pipeline_variables: list[dict[str, Any]]


@dataclass(frozen=True)
class WorkflowTriggerEvent:
    node_id: str
    workflow_args: dict[str, Any]
    workflow: WorkflowSnapshot


class DraftWorkflowMissingError(ValueError):
    pass


@dataclass(frozen=True)
class WorkflowDebugNode:
    """Detached node data; environment variables retain their stored ciphertext."""

    config: NodeConfigDict
    environment_variables: str
    conversation_variables: list[VariableBase]
    enclosing_node_id: str | None


class WorkflowTriggerError(Exception):
    def __init__(self, message: str | None = None) -> None:
        self.message = message
        super().__init__(message)


class WorkflowBindingOperations(Protocol):
    """Agent domain operations invoked by the application within its transaction."""

    def synchronize_draft(self, *, draft_workflow: WorkflowBindingScope, account_id: str) -> set[str]: ...
    def validate_agent_nodes_for_draft_sync(self, *, draft_workflow: WorkflowBindingScope) -> None: ...
    def project_draft_bindings_to_graph(self, *, draft_workflow: WorkflowBindingScope) -> dict[str, Any]: ...
    def validate_prepared_publication(
        self, *, draft_workflow: WorkflowBindingScope, prepared: AgentPublicationState
    ) -> None: ...
    def copy_agent_node_bindings_to_published(
        self, *, draft_workflow: WorkflowBindingScope, published_workflow: WorkflowBindingScope
    ) -> bool: ...
    def restore_agent_node_bindings_to_draft(
        self, *, source_workflow: WorkflowBindingScope, draft_workflow: WorkflowBindingScope, account_id: str
    ) -> set[str]: ...


class WorkflowAgentServices[BindingStore](Protocol):
    """Application-owned construction of domain rules over a transaction's persistence port."""

    def __call__(self, *, repository: BindingStore) -> WorkflowBindingOperations: ...


class DraftBindingTransaction[BindingStore](Protocol):
    @property
    def workflow(self) -> WorkflowSnapshot: ...
    @property
    def bindings(self) -> BindingStore: ...
    def replace_graph(self, graph: dict[str, Any]) -> None: ...
    def after_commit(self, callback: Callable[[], None]) -> None: ...


@dataclass(frozen=True)
class DraftImportResult:
    graph: dict[str, Any]
    retired_agents: set[str]


@dataclass(frozen=True)
class DraftWorkflowRead[BindingStore]:
    record: WorkflowRecord
    workflow: WorkflowSnapshot
    bindings: BindingStore


class WorkflowPublicationTransaction[BindingStore](Protocol):
    @property
    def bindings(self) -> BindingStore: ...
    @property
    def draft(self) -> WorkflowSnapshot: ...
    def track_inline_publish(self, workflow: WorkflowSnapshot) -> None: ...
    def create_version(self, *, marked_name: str, marked_comment: str) -> WorkflowSnapshot: ...
    def sync_webhooks(self, node_ids: Sequence[str]) -> None: ...
    def sync_plugins(self, relationships: Sequence[Mapping[str, Any]]) -> None: ...
    def sync_schedule(self, schedule: ScheduleConfig | None) -> None: ...
    def sync_triggers(self, triggers: Sequence[Mapping[str, Any]]) -> None: ...
    def sync_datasets(self, dataset_ids: set[str]) -> None: ...
    def activate(self, workflow: WorkflowSnapshot) -> None: ...


@dataclass(frozen=True)
class PublicationConfiguration:
    dataset_ids: set[str]
    webhook_nodes: list[str]
    plugins: list[Mapping[str, Any]]
    schedule: ScheduleConfig | None
    triggers: list[Mapping[str, Any]]
    has_trigger_runtime: bool


@dataclass(frozen=True)
class ValidatedWorkflowPublication:
    workflow: WorkflowSnapshot
    agents: AgentPublicationState


@dataclass(frozen=True)
class DeletedWorkflowBinding:
    binding_type: WorkflowAgentBindingType
    agent_id: str | None


@dataclass(frozen=True)
class DebugReservationCursor:
    execution_id: str
    expires_at: datetime


@dataclass(frozen=True)
class ExpiredDebugReservation:
    execution_id: str
    tenant_id: str
    app_id: str
    workflow_id: str
    account_id: str
