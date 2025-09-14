from copy import deepcopy
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, PrivateAttr

from core.model_runtime.entities.llm_entities import LLMUsage

from .variable_pool import VariablePool

if TYPE_CHECKING:
    from core.workflow.graph_engine.ready_queue import ReadyQueueState


class GraphRuntimeState(BaseModel):
    # Private attributes to prevent direct modification
    _variable_pool: VariablePool = PrivateAttr()
    _start_at: float = PrivateAttr()
    _total_tokens: int = PrivateAttr(default=0)
    _llm_usage: LLMUsage = PrivateAttr(default_factory=LLMUsage.empty_usage)
    _outputs: dict[str, Any] = PrivateAttr(default_factory=dict)
    _node_run_steps: int = PrivateAttr(default=0)
    _ready_queue: "ReadyQueueState | dict[str, object]" = PrivateAttr(default_factory=dict)

    def __init__(
        self,
        variable_pool: VariablePool,
        start_at: float,
        total_tokens: int = 0,
        llm_usage: LLMUsage | None = None,
        outputs: dict[str, Any] | None = None,
        node_run_steps: int = 0,
        ready_queue: "ReadyQueueState | dict[str, object] | None" = None,
        **kwargs: object,
    ):
        """Initialize the GraphRuntimeState with validation."""
        super().__init__(**kwargs)

        # Initialize private attributes with validation
        self._variable_pool = variable_pool

        self._start_at = start_at

        if total_tokens < 0:
            raise ValueError("total_tokens must be non-negative")
        self._total_tokens = total_tokens

        if llm_usage is None:
            llm_usage = LLMUsage.empty_usage()
        self._llm_usage = llm_usage

        if outputs is None:
            outputs = {}
        self._outputs = deepcopy(outputs)

        if node_run_steps < 0:
            raise ValueError("node_run_steps must be non-negative")
        self._node_run_steps = node_run_steps

        if ready_queue is None:
            ready_queue = {}
        self._ready_queue = deepcopy(ready_queue)

    @property
    def variable_pool(self) -> VariablePool:
        """Get the variable pool."""
        return self._variable_pool

    @property
    def start_at(self) -> float:
        """Get the start time."""
        return self._start_at

    @start_at.setter
    def start_at(self, value: float) -> None:
        """Set the start time."""
        self._start_at = value

    @property
    def total_tokens(self) -> int:
        """Get the total tokens count."""
        return self._total_tokens

    @total_tokens.setter
    def total_tokens(self, value: int):
        """Set the total tokens count."""
        if value < 0:
            raise ValueError("total_tokens must be non-negative")
        self._total_tokens = value

    @property
    def llm_usage(self) -> LLMUsage:
        """Get the LLM usage info."""
        # Return a copy to prevent external modification
        return self._llm_usage.model_copy()

    @llm_usage.setter
    def llm_usage(self, value: LLMUsage):
        """Set the LLM usage info."""
        self._llm_usage = value.model_copy()

    @property
    def outputs(self) -> dict[str, Any]:
        """Get a copy of the outputs dictionary."""
        return deepcopy(self._outputs)

    @outputs.setter
    def outputs(self, value: dict[str, Any]) -> None:
        """Set the outputs dictionary."""
        self._outputs = deepcopy(value)

    def set_output(self, key: str, value: Any) -> None:
        """Set a single output value."""
        self._outputs[key] = deepcopy(value)

    def get_output(self, key: str, default: Any = None) -> Any:
        """Get a single output value."""
        return deepcopy(self._outputs.get(key, default))

    def update_outputs(self, updates: dict[str, Any]) -> None:
        """Update multiple output values."""
        for key, value in updates.items():
            self._outputs[key] = deepcopy(value)

    @property
    def node_run_steps(self) -> int:
        """Get the node run steps count."""
        return self._node_run_steps

    @node_run_steps.setter
    def node_run_steps(self, value: int) -> None:
        """Set the node run steps count."""
        if value < 0:
            raise ValueError("node_run_steps must be non-negative")
        self._node_run_steps = value

    def increment_node_run_steps(self) -> None:
        """Increment the node run steps by 1."""
        self._node_run_steps += 1

    def add_tokens(self, tokens: int) -> None:
        """Add tokens to the total count."""
        if tokens < 0:
            raise ValueError("tokens must be non-negative")
        self._total_tokens += tokens

    @property
    def ready_queue(self) -> "ReadyQueueState | dict[str, object]":
        """Get a copy of the ready queue state."""
        return deepcopy(self._ready_queue)
