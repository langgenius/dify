from collections.abc import Mapping
from typing import Any

from core.workflow.entities.pause_reason import HumanInputRequired
from core.workflow.enums import NodeExecutionType, NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult, PauseRequestedEvent
from core.workflow.nodes.base.node import Node

from .entities import HumanInputNodeData


class HumanInputNode(Node[HumanInputNodeData]):
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

    @classmethod
    def version(cls) -> str:
        return "1"

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
        # TODO(QuantumGhost): yield a real form id.
        yield PauseRequestedEvent(reason=HumanInputRequired(form_id="test_form_id", node_id=self.id))

    def _is_completion_ready(self) -> bool:
        """Determine whether all required inputs are satisfied."""

        if not self.node_data.required_variables:
            return False

        variable_pool = self.graph_runtime_state.variable_pool

        for selector_str in self.node_data.required_variables:
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

        default_values = self.node_data.default_value_dict
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
