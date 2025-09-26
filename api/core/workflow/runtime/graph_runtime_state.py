from __future__ import annotations

import importlib
from copy import deepcopy
from typing import Any, Protocol

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.runtime.variable_pool import VariablePool


class ReadyQueueProtocol(Protocol):
    """Structural interface required from ready queue implementations."""

    def put(self, item: str) -> None: ...

    def get(self, timeout: float | None = None) -> str: ...

    def task_done(self) -> None: ...

    def empty(self) -> bool: ...

    def qsize(self) -> int: ...

    def dumps(self) -> str: ...

    def loads(self, data: str) -> None: ...


class GraphExecutionProtocol(Protocol):
    """Structural interface for graph execution aggregate."""

    workflow_id: str
    started: bool
    completed: bool
    aborted: bool
    error: Exception | None
    exceptions_count: int

    def start(self) -> None: ...

    def complete(self) -> None: ...

    def abort(self, reason: str) -> None: ...

    def fail(self, error: Exception) -> None: ...

    def dumps(self) -> str: ...

    def loads(self, data: str) -> None: ...


class ResponseStreamCoordinatorProtocol(Protocol):
    """Structural interface for response stream coordinator."""

    def register(self, response_node_id: str) -> None: ...

    def loads(self, data: str) -> None: ...

    def dumps(self) -> str: ...


class GraphProtocol(Protocol):
    """Marker protocol for Graph runtime state attachment."""

    ...


class GraphRuntimeState:
    """Mutable runtime state shared across graph execution components."""

    def __init__(
        self,
        *,
        variable_pool: VariablePool | None = None,
        start_at: float,
        total_tokens: int = 0,
        llm_usage: LLMUsage | None = None,
        outputs: dict[str, object] | None = None,
        node_run_steps: int = 0,
        ready_queue: ReadyQueueProtocol | None = None,
        graph_execution: GraphExecutionProtocol | None = None,
        response_coordinator: ResponseStreamCoordinatorProtocol | None = None,
        workflow_id: str | None = None,
        graph: GraphProtocol | None = None,
    ) -> None:
        self._variable_pool = variable_pool or VariablePool()
        self._start_at = start_at

        if total_tokens < 0:
            raise ValueError("total_tokens must be non-negative")
        self._total_tokens = total_tokens

        self._llm_usage = (llm_usage or LLMUsage.empty_usage()).model_copy()
        self._outputs = deepcopy(outputs) if outputs is not None else {}

        if node_run_steps < 0:
            raise ValueError("node_run_steps must be non-negative")
        self._node_run_steps = node_run_steps

        self._workflow_id = workflow_id
        self._graph: GraphProtocol | None = None

        self._ready_queue = ready_queue
        self._graph_execution = graph_execution
        self._response_coordinator = response_coordinator

        if graph is not None:
            self.attach_graph(graph)

    # ------------------------------------------------------------------
    # Context binding helpers
    # ------------------------------------------------------------------
    def set_workflow_id(self, workflow_id: str) -> None:
        """Bind a workflow identifier for downstream aggregates."""
        if self._workflow_id is None:
            self._workflow_id = workflow_id
            return

        if self._workflow_id != workflow_id:
            raise ValueError(
                f"GraphRuntimeState already bound to workflow '{self._workflow_id}', received '{workflow_id}'"
            )

    def attach_graph(self, graph: GraphProtocol) -> None:
        """Attach the materialized graph to the runtime state."""
        if self._graph is not None and self._graph is not graph:
            raise ValueError("GraphRuntimeState already attached to a different graph instance")

        self._graph = graph

        if self._response_coordinator is None:
            self._response_coordinator = self._build_response_coordinator(graph)

    def configure(self, *, workflow_id: str | None = None, graph: GraphProtocol | None = None) -> None:
        """Ensure core collaborators are initialized with the provided context."""
        if workflow_id is not None:
            self.set_workflow_id(workflow_id)

        if graph is not None:
            self.attach_graph(graph)

        # Ensure collaborators are instantiated
        _ = self.ready_queue
        _ = self.graph_execution
        if self._graph is not None:
            _ = self.response_coordinator

    # ------------------------------------------------------------------
    # Primary collaborators
    # ------------------------------------------------------------------
    @property
    def variable_pool(self) -> VariablePool:
        return self._variable_pool

    @property
    def ready_queue(self) -> ReadyQueueProtocol:
        if self._ready_queue is None:
            self._ready_queue = self._build_ready_queue()
        return self._ready_queue

    @property
    def graph_execution(self) -> GraphExecutionProtocol:
        if self._graph_execution is None:
            self._graph_execution = self._build_graph_execution()
        return self._graph_execution

    @property
    def response_coordinator(self) -> ResponseStreamCoordinatorProtocol:
        if self._response_coordinator is None:
            if self._graph is None:
                raise ValueError("Graph must be attached before accessing response coordinator")
            self._response_coordinator = self._build_response_coordinator(self._graph)
        return self._response_coordinator

    @property
    def workflow_id(self) -> str | None:
        return self._workflow_id

    # ------------------------------------------------------------------
    # Scalar state
    # ------------------------------------------------------------------
    @property
    def start_at(self) -> float:
        return self._start_at

    @start_at.setter
    def start_at(self, value: float) -> None:
        self._start_at = value

    @property
    def total_tokens(self) -> int:
        return self._total_tokens

    @total_tokens.setter
    def total_tokens(self, value: int) -> None:
        if value < 0:
            raise ValueError("total_tokens must be non-negative")
        self._total_tokens = value

    @property
    def llm_usage(self) -> LLMUsage:
        return self._llm_usage.model_copy()

    @llm_usage.setter
    def llm_usage(self, value: LLMUsage) -> None:
        self._llm_usage = value.model_copy()

    @property
    def outputs(self) -> dict[str, Any]:
        return deepcopy(self._outputs)

    @outputs.setter
    def outputs(self, value: dict[str, Any]) -> None:
        self._outputs = deepcopy(value)

    def set_output(self, key: str, value: object) -> None:
        self._outputs[key] = deepcopy(value)

    def get_output(self, key: str, default: object = None) -> object:
        return deepcopy(self._outputs.get(key, default))

    def update_outputs(self, updates: dict[str, object]) -> None:
        for key, value in updates.items():
            self._outputs[key] = deepcopy(value)

    @property
    def node_run_steps(self) -> int:
        return self._node_run_steps

    @node_run_steps.setter
    def node_run_steps(self, value: int) -> None:
        if value < 0:
            raise ValueError("node_run_steps must be non-negative")
        self._node_run_steps = value

    def increment_node_run_steps(self) -> None:
        self._node_run_steps += 1

    def add_tokens(self, tokens: int) -> None:
        if tokens < 0:
            raise ValueError("tokens must be non-negative")
        self._total_tokens += tokens

    # ------------------------------------------------------------------
    # Builders
    # ------------------------------------------------------------------
    def _build_ready_queue(self) -> ReadyQueueProtocol:
        module = importlib.import_module("core.workflow.graph_engine.ready_queue")
        in_memory_cls = module.InMemoryReadyQueue
        return in_memory_cls()

    def _build_graph_execution(self) -> GraphExecutionProtocol:
        if self._workflow_id is None:
            raise ValueError("workflow_id must be set before accessing graph_execution")

        module = importlib.import_module("core.workflow.graph_engine.domain.graph_execution")
        graph_execution_cls = module.GraphExecution
        return graph_execution_cls(workflow_id=self._workflow_id)

    def _build_response_coordinator(self, graph: GraphProtocol) -> ResponseStreamCoordinatorProtocol:
        module = importlib.import_module("core.workflow.graph_engine.response_coordinator")
        coordinator_cls = module.ResponseStreamCoordinator
        return coordinator_cls(variable_pool=self.variable_pool, graph=graph)
