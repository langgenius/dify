from __future__ import annotations

import importlib
import json
from collections.abc import Mapping, Sequence
from collections.abc import Mapping as TypingMapping
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Protocol

from pydantic.json import pydantic_encoder

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.runtime.variable_pool import VariablePool


class ReadyQueueProtocol(Protocol):
    """Structural interface required from ready queue implementations."""

    def put(self, item: str) -> None:
        """Enqueue the identifier of a node that is ready to run."""
        ...

    def get(self, timeout: float | None = None) -> str:
        """Return the next node identifier, blocking until available or timeout expires."""
        ...

    def task_done(self) -> None:
        """Signal that the most recently dequeued node has completed processing."""
        ...

    def empty(self) -> bool:
        """Return True when the queue contains no pending nodes."""
        ...

    def qsize(self) -> int:
        """Approximate the number of pending nodes awaiting execution."""
        ...

    def dumps(self) -> str:
        """Serialize the queue contents for persistence."""
        ...

    def loads(self, data: str) -> None:
        """Restore the queue contents from a serialized payload."""
        ...


class GraphExecutionProtocol(Protocol):
    """Structural interface for graph execution aggregate."""

    workflow_id: str
    started: bool
    completed: bool
    aborted: bool
    error: Exception | None
    exceptions_count: int

    def start(self) -> None:
        """Transition execution into the running state."""
        ...

    def complete(self) -> None:
        """Mark execution as successfully completed."""
        ...

    def abort(self, reason: str) -> None:
        """Abort execution in response to an external stop request."""
        ...

    def fail(self, error: Exception) -> None:
        """Record an unrecoverable error and end execution."""
        ...

    def dumps(self) -> str:
        """Serialize execution state into a JSON payload."""
        ...

    def loads(self, data: str) -> None:
        """Restore execution state from a previously serialized payload."""
        ...


class ResponseStreamCoordinatorProtocol(Protocol):
    """Structural interface for response stream coordinator."""

    def register(self, response_node_id: str) -> None:
        """Register a response node so its outputs can be streamed."""
        ...

    def loads(self, data: str) -> None:
        """Restore coordinator state from a serialized payload."""
        ...

    def dumps(self) -> str:
        """Serialize coordinator state for persistence."""
        ...


class GraphProtocol(Protocol):
    """Structural interface required from graph instances attached to the runtime state."""

    nodes: TypingMapping[str, object]
    edges: TypingMapping[str, object]
    root_node: object

    def get_outgoing_edges(self, node_id: str) -> Sequence[object]: ...


@dataclass(slots=True)
class _GraphRuntimeStateSnapshot:
    """Immutable view of a serialized runtime state snapshot."""

    start_at: float
    total_tokens: int
    node_run_steps: int
    llm_usage: LLMUsage
    outputs: dict[str, Any]
    variable_pool: VariablePool
    has_variable_pool: bool
    ready_queue_dump: str | None
    graph_execution_dump: str | None
    response_coordinator_dump: str | None
    paused_nodes: tuple[str, ...]


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

    @classmethod
    def from_snapshot(cls, data: str | Mapping[str, Any]) -> GraphRuntimeState:
        """Restore runtime state from a serialized snapshot."""

        snapshot = cls._parse_snapshot_payload(data)

        state = cls(
            variable_pool=snapshot.variable_pool,
            start_at=snapshot.start_at,
            total_tokens=snapshot.total_tokens,
            llm_usage=snapshot.llm_usage,
            outputs=snapshot.outputs,
            node_run_steps=snapshot.node_run_steps,
        )
        state._apply_snapshot(snapshot)
        return state

    def loads(self, data: str | Mapping[str, Any]) -> None:
        """Restore runtime state from a serialized snapshot (legacy API)."""

        snapshot = self._parse_snapshot_payload(data)
        self._apply_snapshot(snapshot)

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

    # ------------------------------------------------------------------
    # Snapshot helpers
    # ------------------------------------------------------------------
    @classmethod
    def _parse_snapshot_payload(cls, data: str | Mapping[str, Any]) -> _GraphRuntimeStateSnapshot:
        payload: dict[str, Any]
        if isinstance(data, str):
            payload = json.loads(data)
        else:
            payload = dict(data)

        version = payload.get("version")
        if version != "1.0":
            raise ValueError(f"Unsupported GraphRuntimeState snapshot version: {version}")

        start_at = float(payload.get("start_at", 0.0))

        total_tokens = int(payload.get("total_tokens", 0))
        if total_tokens < 0:
            raise ValueError("total_tokens must be non-negative")

        node_run_steps = int(payload.get("node_run_steps", 0))
        if node_run_steps < 0:
            raise ValueError("node_run_steps must be non-negative")

        llm_usage_payload = payload.get("llm_usage", {})
        llm_usage = LLMUsage.model_validate(llm_usage_payload)

        outputs_payload = deepcopy(payload.get("outputs", {}))

        variable_pool_payload = payload.get("variable_pool")
        has_variable_pool = variable_pool_payload is not None
        variable_pool = VariablePool.model_validate(variable_pool_payload) if has_variable_pool else VariablePool()

        ready_queue_payload = payload.get("ready_queue")
        graph_execution_payload = payload.get("graph_execution")
        response_payload = payload.get("response_coordinator")
        paused_nodes_payload = payload.get("paused_nodes", [])

        return _GraphRuntimeStateSnapshot(
            start_at=start_at,
            total_tokens=total_tokens,
            node_run_steps=node_run_steps,
            llm_usage=llm_usage,
            outputs=outputs_payload,
            variable_pool=variable_pool,
            has_variable_pool=has_variable_pool,
            ready_queue_dump=ready_queue_payload,
            graph_execution_dump=graph_execution_payload,
            response_coordinator_dump=response_payload,
            paused_nodes=tuple(map(str, paused_nodes_payload)),
        )

    def _apply_snapshot(self, snapshot: _GraphRuntimeStateSnapshot) -> None:
        self._start_at = snapshot.start_at
        self._total_tokens = snapshot.total_tokens
        self._node_run_steps = snapshot.node_run_steps
        self._llm_usage = snapshot.llm_usage.model_copy()
        self._outputs = deepcopy(snapshot.outputs)
        if snapshot.has_variable_pool or self._variable_pool is None:
            self._variable_pool = snapshot.variable_pool

        self._restore_ready_queue(snapshot.ready_queue_dump)
        self._restore_graph_execution(snapshot.graph_execution_dump)
        self._restore_response_coordinator(snapshot.response_coordinator_dump)
        self._paused_nodes = set(snapshot.paused_nodes)

    def _restore_ready_queue(self, payload: str | None) -> None:
        if payload is not None:
            self._ready_queue = self._build_ready_queue()
            self._ready_queue.loads(payload)
        else:
            self._ready_queue = None

    def _restore_graph_execution(self, payload: str | None) -> None:
        self._graph_execution = None
        self._pending_graph_execution_workflow_id = None

        if payload is None:
            return

        try:
            execution_payload = json.loads(payload)
            self._pending_graph_execution_workflow_id = execution_payload.get("workflow_id")
        except (json.JSONDecodeError, TypeError, AttributeError):
            self._pending_graph_execution_workflow_id = None

        self.graph_execution.loads(payload)

    def _restore_response_coordinator(self, payload: str | None) -> None:
        if payload is None:
            self._pending_response_coordinator_dump = None
            self._response_coordinator = None
            return

        if self._graph is not None:
            self.response_coordinator.loads(payload)
            self._pending_response_coordinator_dump = None
            return

        self._pending_response_coordinator_dump = payload
        self._response_coordinator = None
