from __future__ import annotations

import importlib
import json
from collections.abc import Mapping, Sequence
from collections.abc import Mapping as TypingMapping
from copy import deepcopy
from typing import Any, Protocol

from pydantic.json import pydantic_encoder

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
    """Structural interface required from graph instances attached to the runtime state."""

    nodes: TypingMapping[str, object]
    edges: TypingMapping[str, object]
    root_node: object

    def get_outgoing_edges(self, node_id: str) -> Sequence[object]: ...


class GraphRuntimeState:
    """Mutable runtime state shared across graph execution components."""

    def __init__(
        self,
        *,
        variable_pool: VariablePool,
        start_at: float,
        total_tokens: int = 0,
        llm_usage: LLMUsage | None = None,
        outputs: dict[str, object] | None = None,
        node_run_steps: int = 0,
        ready_queue: ReadyQueueProtocol | None = None,
        graph_execution: GraphExecutionProtocol | None = None,
        response_coordinator: ResponseStreamCoordinatorProtocol | None = None,
        graph: GraphProtocol | None = None,
    ) -> None:
        self._variable_pool = variable_pool
        self._start_at = start_at

        if total_tokens < 0:
            raise ValueError("total_tokens must be non-negative")
        self._total_tokens = total_tokens

        self._llm_usage = (llm_usage or LLMUsage.empty_usage()).model_copy()
        self._outputs = deepcopy(outputs) if outputs is not None else {}

        if node_run_steps < 0:
            raise ValueError("node_run_steps must be non-negative")
        self._node_run_steps = node_run_steps

        self._graph: GraphProtocol | None = None

        self._ready_queue = ready_queue
        self._graph_execution = graph_execution
        self._response_coordinator = response_coordinator
        self._pending_response_coordinator_dump: str | None = None
        self._pending_graph_execution_workflow_id: str | None = None
        self._paused_nodes: set[str] = set()

        if graph is not None:
            self.attach_graph(graph)

    # ------------------------------------------------------------------
    # Context binding helpers
    # ------------------------------------------------------------------
    def attach_graph(self, graph: GraphProtocol) -> None:
        """Attach the materialized graph to the runtime state."""
        if self._graph is not None and self._graph is not graph:
            raise ValueError("GraphRuntimeState already attached to a different graph instance")

        self._graph = graph

        if self._response_coordinator is None:
            self._response_coordinator = self._build_response_coordinator(graph)

        if self._pending_response_coordinator_dump is not None and self._response_coordinator is not None:
            self._response_coordinator.loads(self._pending_response_coordinator_dump)
            self._pending_response_coordinator_dump = None

    def configure(self, *, graph: GraphProtocol | None = None) -> None:
        """Ensure core collaborators are initialized with the provided context."""
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
    # Serialization
    # ------------------------------------------------------------------
    def dumps(self) -> str:
        """Serialize runtime state into a JSON string."""

        snapshot: dict[str, Any] = {
            "version": "1.0",
            "start_at": self._start_at,
            "total_tokens": self._total_tokens,
            "node_run_steps": self._node_run_steps,
            "llm_usage": self._llm_usage.model_dump(mode="json"),
            "outputs": self.outputs,
            "variable_pool": self.variable_pool.model_dump(mode="json"),
            "ready_queue": self.ready_queue.dumps(),
            "graph_execution": self.graph_execution.dumps(),
            "paused_nodes": list(self._paused_nodes),
        }

        if self._response_coordinator is not None and self._graph is not None:
            snapshot["response_coordinator"] = self._response_coordinator.dumps()

        return json.dumps(snapshot, default=pydantic_encoder)

    def loads(self, data: str | Mapping[str, Any]) -> None:
        """Restore runtime state from a serialized snapshot."""

        payload: dict[str, Any]
        if isinstance(data, str):
            payload = json.loads(data)
        else:
            payload = dict(data)

        version = payload.get("version")
        if version != "1.0":
            raise ValueError(f"Unsupported GraphRuntimeState snapshot version: {version}")

        self._start_at = float(payload.get("start_at", 0.0))
        total_tokens = int(payload.get("total_tokens", 0))
        if total_tokens < 0:
            raise ValueError("total_tokens must be non-negative")
        self._total_tokens = total_tokens

        node_run_steps = int(payload.get("node_run_steps", 0))
        if node_run_steps < 0:
            raise ValueError("node_run_steps must be non-negative")
        self._node_run_steps = node_run_steps

        llm_usage_payload = payload.get("llm_usage", {})
        self._llm_usage = LLMUsage.model_validate(llm_usage_payload)

        self._outputs = deepcopy(payload.get("outputs", {}))

        variable_pool_payload = payload.get("variable_pool")
        if variable_pool_payload is not None:
            self._variable_pool = VariablePool.model_validate(variable_pool_payload)

        ready_queue_payload = payload.get("ready_queue")
        if ready_queue_payload is not None:
            self._ready_queue = self._build_ready_queue()
            self._ready_queue.loads(ready_queue_payload)
        else:
            self._ready_queue = None

        graph_execution_payload = payload.get("graph_execution")
        self._graph_execution = None
        self._pending_graph_execution_workflow_id = None
        if graph_execution_payload is not None:
            try:
                execution_payload = json.loads(graph_execution_payload)
                self._pending_graph_execution_workflow_id = execution_payload.get("workflow_id")
            except (json.JSONDecodeError, TypeError, AttributeError):
                self._pending_graph_execution_workflow_id = None
            self.graph_execution.loads(graph_execution_payload)

        response_payload = payload.get("response_coordinator")
        if response_payload is not None:
            if self._graph is not None:
                self.response_coordinator.loads(response_payload)
            else:
                self._pending_response_coordinator_dump = response_payload
        else:
            self._pending_response_coordinator_dump = None
            self._response_coordinator = None

        paused_nodes_payload = payload.get("paused_nodes", [])
        self._paused_nodes = set(map(str, paused_nodes_payload))

    def register_paused_node(self, node_id: str) -> None:
        """Record a node that should resume when execution is continued."""

        self._paused_nodes.add(node_id)

    def consume_paused_nodes(self) -> list[str]:
        """Retrieve and clear the list of paused nodes awaiting resume."""

        nodes = list(self._paused_nodes)
        self._paused_nodes.clear()
        return nodes

    # ------------------------------------------------------------------
    # Builders
    # ------------------------------------------------------------------
    def _build_ready_queue(self) -> ReadyQueueProtocol:
        # Import lazily to avoid breaching architecture boundaries enforced by import-linter.
        module = importlib.import_module("core.workflow.graph_engine.ready_queue")
        in_memory_cls = module.InMemoryReadyQueue
        return in_memory_cls()

    def _build_graph_execution(self) -> GraphExecutionProtocol:
        # Lazily import to keep the runtime domain decoupled from graph_engine modules.
        module = importlib.import_module("core.workflow.graph_engine.domain.graph_execution")
        graph_execution_cls = module.GraphExecution
        workflow_id = self._pending_graph_execution_workflow_id or ""
        self._pending_graph_execution_workflow_id = None
        return graph_execution_cls(workflow_id=workflow_id)

    def _build_response_coordinator(self, graph: GraphProtocol) -> ResponseStreamCoordinatorProtocol:
        # Lazily import to keep the runtime domain decoupled from graph_engine modules.
        module = importlib.import_module("core.workflow.graph_engine.response_coordinator")
        coordinator_cls = module.ResponseStreamCoordinator
        return coordinator_cls(variable_pool=self.variable_pool, graph=graph)
