from collections.abc import Mapping
from typing import Any

from core.workflow.entities.pause_reason import HumanInputRequired
from core.workflow.enums import ErrorStrategy, NodeExecutionType, NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult, PauseRequestedEvent
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node

from .entities import HumanInputNodeData


class HumanInputNode(Node):
    node_type = NodeType.HUMAN_INPUT
    execution_type = NodeExecutionType.BRANCH

    _BRANCH_SELECTION_KEYS: tuple[str, ...] = (
        "edge_source_handle",
        "edgeSourceHandle",
        "source_handle",
        "selected_branch",
        "selectedBranch",
        "branch",
        "branch_id",
        "branchId",
        "handle",
    )

    _node_data: HumanInputNodeData

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self._node_data = HumanInputNodeData(**data)

    def get_base_node_data(self) -> BaseNodeData:
        return self._node_data

    @classmethod
    def version(cls) -> str:
        return "1"

    def _get_error_strategy(self) -> ErrorStrategy | None:
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._node_data.retry_config

    def _get_title(self) -> str:
        return self._node_data.title

    def _get_description(self) -> str | None:
        return self._node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        return self._node_data.default_value_dict

    def _run(self):  # type: ignore[override]
        if self._is_completion_ready():
            branch_handle = self._resolve_branch_selection()
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={},
                edge_source_handle=branch_handle or "source",
            )

        return self._pause_generator()

    def _pause_generator(self):
        yield PauseRequestedEvent(reason=HumanInputRequired())

    def _is_completion_ready(self) -> bool:
        """Determine whether all required inputs are satisfied."""

        if not self._node_data.required_variables:
            return False

        variable_pool = self.graph_runtime_state.variable_pool

        for selector_str in self._node_data.required_variables:
            parts = selector_str.split(".")
            if len(parts) != 2:
                return False
            segment = variable_pool.get(parts)
            if segment is None:
                return False

        return True

    def _resolve_branch_selection(self) -> str | None:
        """Determine the branch handle selected by human input if available."""

        variable_pool = self.graph_runtime_state.variable_pool

        for key in self._BRANCH_SELECTION_KEYS:
            handle = self._extract_branch_handle(variable_pool.get((self.id, key)))
            if handle:
                return handle

        default_values = self._node_data.default_value_dict
        for key in self._BRANCH_SELECTION_KEYS:
            handle = self._normalize_branch_value(default_values.get(key))
            if handle:
                return handle

        return None

    @staticmethod
    def _extract_branch_handle(segment: Any) -> str | None:
        if segment is None:
            return None

        candidate = getattr(segment, "to_object", None)
        raw_value = candidate() if callable(candidate) else getattr(segment, "value", None)
        if raw_value is None:
            return None

        return HumanInputNode._normalize_branch_value(raw_value)

    @staticmethod
    def _normalize_branch_value(value: Any) -> str | None:
        if value is None:
            return None

        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None

        if isinstance(value, Mapping):
            for key in ("handle", "edge_source_handle", "edgeSourceHandle", "branch", "id", "value"):
                candidate = value.get(key)
                if isinstance(candidate, str) and candidate:
                    return candidate

        return None
