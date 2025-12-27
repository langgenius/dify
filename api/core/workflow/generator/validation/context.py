"""
Validation Context for the Rule Engine.

The ValidationContext holds all the data needed for validation:
- Generated nodes and edges
- Available models, tools, and datasets
- Node output schemas for variable reference validation
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ValidationContext:
    """
    Context object containing all data needed for validation.

    This is passed to each validation rule, providing access to:
    - The nodes being validated
    - Edge connections between nodes
    - Available external resources (models, tools)
    """

    # Generated workflow data
    nodes: list[dict[str, Any]] = field(default_factory=list)
    edges: list[dict[str, Any]] = field(default_factory=list)

    # Available external resources
    available_models: list[dict[str, Any]] = field(default_factory=list)
    available_tools: list[dict[str, Any]] = field(default_factory=list)

    # Cached lookups (populated lazily)
    _node_map: dict[str, dict[str, Any]] | None = field(default=None, repr=False)
    _model_set: set[tuple[str, str]] | None = field(default=None, repr=False)
    _tool_set: set[str] | None = field(default=None, repr=False)
    _configured_tool_set: set[str] | None = field(default=None, repr=False)

    @property
    def node_map(self) -> dict[str, dict[str, Any]]:
        """Get a map of node_id -> node for quick lookup."""
        if self._node_map is None:
            self._node_map = {node.get("id", ""): node for node in self.nodes}
        return self._node_map

    @property
    def model_set(self) -> set[tuple[str, str]]:
        """Get a set of (provider, model_name) tuples for quick lookup."""
        if self._model_set is None:
            self._model_set = {
                (m.get("provider", ""), m.get("model", ""))
                for m in self.available_models
            }
        return self._model_set

    @property
    def tool_set(self) -> set[str]:
        """Get a set of all tool keys (both configured and unconfigured)."""
        if self._tool_set is None:
            self._tool_set = set()
            for tool in self.available_tools:
                provider = tool.get("provider_id") or tool.get("provider", "")
                tool_key = tool.get("tool_key") or tool.get("tool_name", "")
                if provider and tool_key:
                    self._tool_set.add(f"{provider}/{tool_key}")
                if tool_key:
                    self._tool_set.add(tool_key)
        return self._tool_set

    @property
    def configured_tool_set(self) -> set[str]:
        """Get a set of configured (authorized) tool keys."""
        if self._configured_tool_set is None:
            self._configured_tool_set = set()
            for tool in self.available_tools:
                if not tool.get("is_team_authorization", False):
                    continue
                provider = tool.get("provider_id") or tool.get("provider", "")
                tool_key = tool.get("tool_key") or tool.get("tool_name", "")
                if provider and tool_key:
                    self._configured_tool_set.add(f"{provider}/{tool_key}")
                if tool_key:
                    self._configured_tool_set.add(tool_key)
        return self._configured_tool_set

    def has_model(self, provider: str, model_name: str) -> bool:
        """Check if a model is available."""
        return (provider, model_name) in self.model_set

    def has_tool(self, tool_key: str) -> bool:
        """Check if a tool exists (configured or not)."""
        return tool_key in self.tool_set

    def is_tool_configured(self, tool_key: str) -> bool:
        """Check if a tool is configured and ready to use."""
        return tool_key in self.configured_tool_set

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        """Get a node by its ID."""
        return self.node_map.get(node_id)

    def get_node_ids(self) -> set[str]:
        """Get all node IDs in the workflow."""
        return set(self.node_map.keys())

    def get_upstream_nodes(self, node_id: str) -> list[str]:
        """Get IDs of nodes that connect to this node (upstream)."""
        return [
            edge.get("source", "")
            for edge in self.edges
            if edge.get("target") == node_id
        ]

    def get_downstream_nodes(self, node_id: str) -> list[str]:
        """Get IDs of nodes that this node connects to (downstream)."""
        return [
            edge.get("target", "")
            for edge in self.edges
            if edge.get("source") == node_id
        ]



