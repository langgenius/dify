import logging
from collections.abc import Mapping
from typing import Any

from core.workflow.entities.pause_reason import HumanInputRequired
from core.workflow.enums import NodeExecutionType, NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult, PauseRequestedEvent
from core.workflow.nodes.base.node import Node

from .entities import HumanInputNodeData

logger = logging.getLogger(__name__)


class HumanInputNode(Node[HumanInputNodeData]):
    """Node for handling human input in workflows.

    ID attributes:
        self.id: Execution-level UUID (unique per run, from GraphEngine)
        self._node_id: Workflow-level node ID (static, from workflow definition)
        self.execution_id: Alias for self._node_execution_id

    For pause/resume flows, always use self._node_id when matching variables
    since it remains constant across executions.
    """

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
            # Determine default action based on edge configuration
            action = branch_handle or self._get_default_action()

            # Get reason from variable pool if available
            reason = self._get_reason()

            # Log for debugging
            logger.info(
                "HumanInputNode._run: node_id=%s, action=%s, reason=%r",
                self._node_id,
                action,
                reason,
            )

            # Build process_data with human input action details
            process_data = {
                "action": action,
            }

            # Add reason to process_data for tracking/debugging visibility
            if reason is not None:
                process_data["reason"] = reason

            # Get all inputs from predecessor nodes
            inputs = self._collect_inputs()

            # Build outputs with action result to pass to next node
            # Use safe variable naming to avoid conflicts
            outputs = self._build_outputs(action, inputs, reason)

            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs=inputs,
                process_data=process_data,
                outputs=outputs,
                edge_source_handle=action,
            )

        return self._pause_generator()

    def _get_reason(self) -> str | None:
        """Get the reason from variable pool if available.

        Returns:
            The reason string if available, None otherwise
        """
        variable_pool = self.graph_runtime_state.variable_pool
        segment = variable_pool.get((self._node_id, "reason"))

        if segment is None:
            return None

        # Extract value from segment
        value = getattr(segment, "to_object", None)
        reason = value() if callable(value) else getattr(segment, "value", None)

        return reason if isinstance(reason, str) else None

    def _collect_inputs(self) -> dict[str, Any]:
        """Collect all input variables from predecessor nodes.

        If required_variables is configured, collect those specific variables.
        Otherwise, return an empty dict as inputs are optional for this node.
        """
        inputs: dict[str, Any] = {}
        variable_pool = self.graph_runtime_state.variable_pool

        # Collect from required_variables if defined
        if self.node_data.required_variables:
            for selector_str in self.node_data.required_variables:
                parts = selector_str.split(".")
                if len(parts) == 2:
                    segment = variable_pool.get(parts)
                    if segment is not None:
                        # Use last part as key for backward compatibility
                        key = parts[-1]
                        # Use consistent type handling: try to_object first, fallback to value
                        value = getattr(segment, "to_object", None)
                        inputs[key] = value() if callable(value) else getattr(segment, "value", None)
                    else:
                        logger.warning(
                            "HumanInputNode: Variable segment %s not found in variable pool",
                            selector_str,
                        )
                else:
                    logger.warning(
                        "HumanInputNode: Invalid variable selector format: %s (expected 'node_id.variable_name')",
                        selector_str,
                    )

        return inputs

    def _get_default_action(self) -> str:
        """Determine the default action based on edge configuration.

        Returns:
            "source" if single-branch (default edge handle)
            First non-default handle if multi-branch (e.g., "approve" or "reject")
        """
        # Access graph through runtime state (internal access for node logic)
        graph = self.graph_runtime_state._graph  # pyright: ignore[reportPrivateUsage]
        if graph is None:
            return "source"

        outgoing_edges = graph.get_outgoing_edges(self._node_id)
        if not outgoing_edges:
            return "source"

        # Check if any edge uses a non-default source_handle
        non_default_handles = [edge.source_handle for edge in outgoing_edges if edge.source_handle != "source"]

        if not non_default_handles:
            # Single-branch scenario: all edges use default "source" handle
            return "source"
        else:
            # Multi-branch scenario: use first non-default handle as default
            # This ensures we don't return "source" which would skip all branches
            return non_default_handles[0]

    def _build_outputs(self, action: str, inputs: dict[str, Any], reason: str | None = None) -> dict[str, Any]:
        """Build outputs with action result, reason, and input variables.

        Protects against variable name conflicts by using a structured approach.

        Args:
            action: The selected action/handle
            inputs: Collected input variables from predecessor nodes
            reason: Optional reason for the action (approve/reject reason)

        Returns:
            Dictionary with action, approved, reason, and input variables
        """
        outputs = {
            "action": action,
            "approved": action == "approve",
        }

        # Add reason if available
        if reason is not None:
            outputs["reason"] = reason

        # Add input variables with conflict protection
        for key, value in inputs.items():
            if key in ("action", "approved", "reason"):
                # Prefix conflicting keys to avoid overriding core fields
                outputs[f"input_{key}"] = value
            else:
                outputs[key] = value

        return outputs

    def _pause_generator(self):
        # TODO(QuantumGhost): yield a real form id.
        # Use _node_id (workflow-level) instead of id (execution-level) for resume matching
        yield PauseRequestedEvent(reason=HumanInputRequired(form_id="test_form_id", node_id=self._node_id))

    def _is_completion_ready(self) -> bool:
        """Determine whether all required inputs are satisfied or action is provided."""
        variable_pool = self.graph_runtime_state.variable_pool

        # Check if action (edge_source_handle) is already set - means we're resuming
        # Validate that the value is not None AND contains a valid branch handle
        for key in self._BRANCH_SELECTION_KEYS:
            segment = variable_pool.get((self._node_id, key))
            if segment is not None:
                handle = self._extract_branch_handle(segment)
                if handle:
                    return True

        # Check required_variables for backward compatibility
        if not self.node_data.required_variables:
            return False

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

        # Use _node_id (workflow-level) for variable matching
        for key in self._BRANCH_SELECTION_KEYS:
            handle = self._extract_branch_handle(variable_pool.get((self._node_id, key)))
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
