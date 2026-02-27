from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from core.model_runtime.entities.llm_entities import LLMUsage
from core.variables.segments import Segment
from core.workflow.system_variable import SystemVariableReadOnlyView


class ReadOnlyVariablePool(Protocol):
    """Read-only interface for VariablePool."""

    def get(self, selector: Sequence[str], /) -> Segment | None:
        """Get a variable value (read-only)."""
        ...

    def get_all_by_node(self, node_id: str) -> Mapping[str, object]:
        """Get all variables for a node (read-only)."""
        ...

    def get_by_prefix(self, prefix: str) -> Mapping[str, object]:
        """Get all variables stored under a given node prefix (read-only)."""
        ...


class ReadOnlyGraphRuntimeState(Protocol):
    """
    Read-only view of GraphRuntimeState for layers.

    This protocol defines a read-only interface that prevents layers from
    modifying the graph runtime state while still allowing observation.
    All methods return defensive copies to ensure immutability.
    """

    @property
    def system_variable(self) -> SystemVariableReadOnlyView: ...

    @property
    def variable_pool(self) -> ReadOnlyVariablePool:
        """Get read-only access to the variable pool."""
        ...

    @property
    def start_at(self) -> float:
        """Get the start time (read-only)."""
        ...

    @property
    def total_tokens(self) -> int:
        """Get the total tokens count (read-only)."""
        ...

    @property
    def llm_usage(self) -> LLMUsage:
        """Get a copy of LLM usage info (read-only)."""
        ...

    @property
    def outputs(self) -> dict[str, Any]:
        """Get a defensive copy of outputs (read-only)."""
        ...

    @property
    def node_run_steps(self) -> int:
        """Get the node run steps count (read-only)."""
        ...

    @property
    def ready_queue_size(self) -> int:
        """Get the number of nodes currently in the ready queue."""
        ...

    @property
    def exceptions_count(self) -> int:
        """Get the number of node execution exceptions recorded."""
        ...

    def get_output(self, key: str, default: Any = None) -> Any:
        """Get a single output value (returns a copy)."""
        ...

    def dumps(self) -> str:
        """Serialize the runtime state into a JSON snapshot (read-only)."""
        ...
