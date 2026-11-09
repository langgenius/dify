from abc import abstractmethod
from collections.abc import Mapping, Sequence
from typing import Protocol

from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.variables.segments import Segment


class ReadOnlyVariablePool(Protocol):
    """Read-only interface for VariablePool."""

    @abstractmethod
    def get(self, selector: Sequence[str], /) -> Segment | None:
        """Get a variable value (read-only)."""
        ...

    @abstractmethod
    def get_by_prefix(self, prefix: str, /) -> Mapping[str, object]:
        """Get all variables stored under a given node prefix (read-only)."""
        ...


class ReadOnlyRuntimeState(Protocol):
    """Read-only view of RuntimeState for layers.

    This protocol defines a read-only interface that prevents layers from
    modifying runtime state while still allowing observation.
    All methods return defensive copies to ensure immutability.
    """

    @property
    @abstractmethod
    def variable_pool(self) -> ReadOnlyVariablePool:
        """Get read-only access to the variable pool."""
        ...

    @property
    @abstractmethod
    def start_at(self) -> float:
        """Get the start time (read-only)."""
        ...

    @property
    @abstractmethod
    def total_tokens(self) -> int:
        """Get the total tokens count (read-only)."""
        ...

    @property
    @abstractmethod
    def llm_usage(self) -> LLMUsage:
        """Get a copy of LLM usage info (read-only)."""
        ...

    @property
    @abstractmethod
    def outputs(self) -> dict[str, object]:
        """Get a defensive copy of outputs (read-only)."""
        ...

    @property
    @abstractmethod
    def node_run_steps(self) -> int:
        """Get the node run steps count (read-only)."""
        ...

    @property
    @abstractmethod
    def ready_queue_size(self) -> int:
        """Get the number of nodes currently in the ready queue."""
        ...

    @property
    @abstractmethod
    def exceptions_count(self) -> int:
        """Get the number of node execution exceptions recorded."""
        ...

    @abstractmethod
    def get_output(self, key: str, default: object = None) -> object:
        """Get a single output value (returns a copy)."""
        ...

    @abstractmethod
    def dumps(self) -> str:
        """Serialize quiescent runtime state without changing its values.

        Raises:
            RuntimeError: While the engine run or any execution thread is active,
                or a restored migration still requires graph attachment.

        """
        ...
