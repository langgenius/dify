from __future__ import annotations

from collections.abc import Generator, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

from dify_graph.enums import WorkflowNodeExecutionMetadataKey

if TYPE_CHECKING:
    from dify_graph.graph_events import GraphNodeEventBase
    from dify_graph.nodes.base.node import Node


class BaselineNodeSnapshot(BaseModel):
    """Serialized baseline snapshot for one node execution."""

    model_config = ConfigDict(extra="forbid")

    node_id: str
    source_workflow_run_id: str
    source_node_execution_id: str
    inputs: Mapping[str, Any] | None = None
    process_data: Mapping[str, Any] | None = None
    outputs: Mapping[str, Any] | None = None
    execution_metadata: Mapping[str, Any] = Field(default_factory=dict)
    edge_source_handle: str | None = None

    def resolved_edge_source_handle(self) -> str | None:
        if self.edge_source_handle:
            return self.edge_source_handle
        metadata_value = self.execution_metadata.get(WorkflowNodeExecutionMetadataKey.EDGE_SOURCE_HANDLE.value)
        if isinstance(metadata_value, str) and metadata_value:
            return metadata_value
        return None


class RerunOverrideContext(BaseModel):
    """Override root selector values keyed by (node_id, variable_name)."""

    model_config = ConfigDict(extra="forbid")

    override_root_selectors_by_node_id: dict[str, list[str]] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_payload(cls, data: Any) -> Any:
        if not isinstance(data, Mapping):
            return data
        if "override_root_selectors_by_node_id" in data:
            return data

        legacy_values = data.get("values_by_node_id")
        if not isinstance(legacy_values, Mapping):
            return data

        # Backward compatibility note:
        # Older payloads persisted the whole override values in `values_by_node_id`.
        # The v2 implementation no longer trusts serialized values (file types can
        # degrade after JSON round-trips), so we only keep selector membership and
        # resolve actual values from the live VariablePool during replay.
        selectors_by_node_id: dict[str, list[str]] = {}
        for node_id, node_values in legacy_values.items():
            if not isinstance(node_id, str) or not isinstance(node_values, Mapping):
                continue
            variable_names = sorted({name for name in node_values if isinstance(name, str)})
            if variable_names:
                selectors_by_node_id[node_id] = variable_names

        migrated = dict(data)
        migrated.pop("values_by_node_id", None)
        migrated["override_root_selectors_by_node_id"] = selectors_by_node_id
        return migrated

    def has_selector(self, *, node_id: str, variable_name: str) -> bool:
        node_variables = self.override_root_selectors_by_node_id.get(node_id)
        return bool(node_variables and variable_name in node_variables)

    def get_variable_names(self, *, node_id: str) -> set[str]:
        node_values = self.override_root_selectors_by_node_id.get(node_id, [])
        return set(node_values)


class ReplayExecutionStrategyConfig(BaseModel):
    """Configuration payload passed from rerun planner to graph worker."""

    model_config = ConfigDict(extra="forbid")

    real_node_ids: list[str] = Field(default_factory=list)
    baseline_snapshots_by_node_id: dict[str, BaselineNodeSnapshot] = Field(default_factory=dict)
    override_context: RerunOverrideContext = Field(default_factory=RerunOverrideContext)


@dataclass(slots=True)
class ExecutionStrategyDecision:
    mode: Literal["real", "replay"]
    snapshot: BaselineNodeSnapshot | None = None
    reason: str | None = None

    @classmethod
    def real(cls, *, reason: str | None = None) -> ExecutionStrategyDecision:
        return cls(mode="real", snapshot=None, reason=reason)

    @classmethod
    def replay(cls, *, snapshot: BaselineNodeSnapshot) -> ExecutionStrategyDecision:
        return cls(mode="replay", snapshot=snapshot, reason=None)


class NodeExecutionStrategyResolver(Protocol):
    def resolve(self, *, node_id: str, is_branch_node: bool) -> ExecutionStrategyDecision:
        """Resolve execution mode for a node."""
        ...


class ReplayExecutionExecutor(Protocol):
    def execute(self, *, node: Node, snapshot: BaselineNodeSnapshot) -> Generator[GraphNodeEventBase, None, None]:
        """Emit replay events for one node execution."""
        ...


def normalize_execution_metadata(
    metadata: Mapping[Any, Any] | None,
) -> dict[WorkflowNodeExecutionMetadataKey, Any]:
    if not metadata:
        return {}

    normalized: dict[WorkflowNodeExecutionMetadataKey, Any] = {}
    for key, value in metadata.items():
        try:
            metadata_key = (
                key if isinstance(key, WorkflowNodeExecutionMetadataKey) else WorkflowNodeExecutionMetadataKey(key)
            )
        except ValueError:
            continue
        normalized[metadata_key] = value
    return normalized
