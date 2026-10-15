"""Workflow use-case data shared by adapters, independent of service implementations."""

from __future__ import annotations

import json
from collections.abc import Callable, Generator, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol, cast

from constants import DEFAULT_FILE_NUMBER_LIMITS
from core.workflow.nodes.trigger_schedule.entities import ScheduleConfig
from enums.agent import WorkflowAgentBindingType
from errors.workflow import NodeNotFoundError, WorkflowDataError
from graphon.entities.base_node_data import BaseNodeData
from graphon.entities.graph_config import NodeConfigDict
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.variables import VariableBase
from graphon.variables.variables import RAGPipelineVariable
from services.agent.publication_contracts import AgentPublicationState

RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE = "source workflow must be published"
MAX_WORKFLOW_ONLINE_USERS_REQUEST_IDS = 1000

type WorkflowGeneration = Mapping[str, Any] | Generator[str]


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
        return json.loads(self.graph) if self.graph else {}


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

    @property
    def features_dict(self) -> dict[str, Any]:
        """Decode features and normalize the legacy image-upload shape without mutating stored data."""
        if not self.features:
            return {}
        payload = json.loads(self.features)
        if not isinstance(payload, dict):
            return cast(dict[str, Any], payload)
        file_upload = payload.get("file_upload")
        if not isinstance(file_upload, dict):
            return payload
        image = file_upload.get("image")
        if not isinstance(image, dict) or "enabled" not in image:
            return payload
        if image.get("enabled", False):
            file_upload["enabled"] = True
            file_upload["number_limits"] = int(image.get("number_limits", DEFAULT_FILE_NUMBER_LIMITS))
            file_upload["allowed_file_upload_methods"] = image.get("transfer_methods", ["remote_url", "local_file"])
            file_upload["allowed_file_types"] = file_upload.get("allowed_file_types", ["image"])
            file_upload["allowed_file_extensions"] = file_upload.get("allowed_file_extensions", [])
            del file_upload["image"]
        return payload

    @property
    def rag_pipeline_variable_values(self) -> list[dict[str, Any]]:
        variables = cast(dict[str, dict[str, Any]], json.loads(self.rag_pipeline_variables or "{}"))
        return [RAGPipelineVariable.model_validate(value).model_dump(mode="json") for value in variables.values()]

    @property
    def kind_or_standard(self) -> str:
        kind = "standard" if self.kind is None else self.kind
        if kind not in {"standard", "snippet"}:
            raise ValueError(f"invalid workflow kind value {kind}")
        return kind

    def user_input_form(self, to_old_structure: bool = False) -> list[Any]:
        if not self.graph:
            return []
        nodes = self.graph_dict.get("nodes")
        if not isinstance(nodes, list):
            return []
        start_node = next(
            (
                node
                for node in nodes
                if isinstance(node, dict) and isinstance(node.get("data"), dict) and node["data"].get("type") == "start"
            ),
            None,
        )
        if start_node is None:
            return []
        variables = start_node.get("data", {}).get("variables", [])
        if not isinstance(variables, list):
            return []
        if to_old_structure:
            return [{variable["type"]: variable} for variable in variables]
        return variables

    def walk_nodes(self, specific_node_type: NodeType | None = None) -> Generator[tuple[str, Mapping[str, Any]]]:
        nodes = self.graph_dict.get("nodes")
        if not isinstance(nodes, list):
            raise WorkflowDataError("nodes not found in workflow graph")
        for node in nodes:
            if not isinstance(node, dict):
                continue
            node_id = node.get("id")
            data = node.get("data")
            if not isinstance(node_id, str) or not isinstance(data, Mapping):
                continue
            if specific_node_type is None or data.get("type") == specific_node_type:
                yield node_id, data

    def get_node_config_by_id(self, node_id: str) -> Mapping[str, Any]:
        graph = self.graph_dict
        if not graph:
            raise WorkflowDataError(f"workflow graph not found, workflow_id={self.id}")
        nodes = graph.get("nodes")
        if not isinstance(nodes, list) or not nodes:
            raise WorkflowDataError("nodes not found in workflow graph")
        try:
            node_config = next(node for node in nodes if isinstance(node, dict) and node.get("id") == node_id)
        except StopIteration:
            raise NodeNotFoundError(node_id)
        return node_config

    @staticmethod
    def get_node_type_from_node_config(node_config: Mapping[str, Any]) -> NodeType:
        data = node_config.get("data")
        if isinstance(data, Mapping):
            node_type = data.get("type")
        elif isinstance(data, BaseNodeData):
            node_type = data.type
        else:
            raise WorkflowDataError("node type not found in workflow graph")
        if not isinstance(node_type, str):
            raise WorkflowDataError("node type not found in workflow graph")
        return node_type

    @staticmethod
    def get_enclosing_node_type_and_id(node_config: Mapping[str, Any]) -> tuple[NodeType, str] | None:
        if node_config.get("isInLoop", False):
            loop_id = node_config.get("loop_id")
            if not isinstance(loop_id, str):
                raise WorkflowDataError("invalid graph")
            return BuiltinNodeTypes.LOOP, loop_id
        if node_config.get("isInIteration", False):
            iteration_id = node_config.get("iteration_id")
            if not isinstance(iteration_id, str):
                raise WorkflowDataError("invalid graph")
            return BuiltinNodeTypes.ITERATION, iteration_id
        return None


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
