from __future__ import annotations

import threading
from collections.abc import Callable, Mapping
from copy import deepcopy
from typing import Literal

from graphon.enums import NodeState
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.runtime.container_state import (
    ContainerFrameState,
    ContainerRunState,
    FrameRuntimeData,
)
from graphon.runtime.ready_queue import InMemoryReadyQueue, ReadyQueue, ReadyTask
from graphon.runtime.variable_pool import VariablePool

from ..execution import GraphExecution
from .protocol import GraphProtocol
from .snapshot import GraphStateMigration, load_snapshot


class RuntimeState:  # ruff:ignore[too-many-public-methods]
    """Mutable runtime state shared across graph execution components.

    `RuntimeState` encapsulates the runtime state of workflow execution,
    including scheduling details, variable values, and timing information.

    Values that are initialized prior to workflow execution and remain constant
    throughout the execution should be part of `InitParams` instead.
    """

    _container_state_lock: threading.Lock

    def __init__(
        self,
        *,
        variable_pool: VariablePool,
        start_at: float,
        llm_usage: LLMUsage | None = None,
        outputs: dict[str, object] | None = None,
        node_run_steps: int = 0,
        ready_queue: ReadyQueue | None = None,
        deferred_ready_queue: ReadyQueue | None = None,
        workflow_id: str | None = None,
        graph_execution: GraphExecution | None = None,
    ) -> None:
        """Initialize all mutable state owned by one graph execution frame.

        A newly started root runtime supplies ``workflow_id`` so this constructor
        can create the execution aggregate. Child frames and restored runtimes
        instead supply their existing ``graph_execution`` so every frame shares
        one workflow identity and lifecycle. Callers may supply both forms when
        useful at an API boundary, but their workflow IDs must agree.

        Args:
            variable_pool: Variables visible to nodes in this frame.
            start_at: Unix timestamp at which execution started.
            llm_usage: Accumulated language-model usage, copied on input.
            outputs: Current workflow outputs, copied on input.
            node_run_steps: Number of node runs already completed.
            ready_queue: Queue for runnable tasks, or a local queue by default.
            deferred_ready_queue: Queue for tasks held while execution is paused.
            workflow_id: Identity used to create a new execution aggregate.
            graph_execution: Existing aggregate shared by child or restored frames.

        Raises:
            ValueError: If ``node_run_steps`` is negative, neither identity form
                is supplied, or the two supplied workflow identities disagree.

        """
        if node_run_steps < 0:
            msg = "node_run_steps must be non-negative"
            raise ValueError(msg)
        if graph_execution is None:
            if workflow_id is None:
                msg = "workflow_id or graph_execution is required"
                raise ValueError(msg)
            graph_execution = GraphExecution(workflow_id=workflow_id)
        elif workflow_id is not None and workflow_id != graph_execution.workflow_id:
            msg = "workflow_id must match graph_execution.workflow_id"
            raise ValueError(msg)
        self._variable_pool = variable_pool
        self._start_at = start_at
        self._llm_usage = (
            llm_usage if llm_usage is not None else LLMUsage.empty_usage()
        ).model_copy()
        self._outputs = deepcopy(outputs) if outputs is not None else {}
        self._node_run_steps = node_run_steps
        self._graph: GraphProtocol | None = None
        self._ready_queue = (
            ready_queue if ready_queue is not None else InMemoryReadyQueue()
        )
        self._deferred_ready_queue = (
            deferred_ready_queue
            if deferred_ready_queue is not None
            else InMemoryReadyQueue()
        )
        self._graph_execution = graph_execution
        self._container_runs: dict[str, ContainerRunState] = {}
        self._container_frames: dict[str, ContainerFrameState] = {}
        self._pending_graph_node_states: dict[str, NodeState] = {}
        self._pending_graph_edge_states: dict[str, NodeState] = {}
        self._has_pending_graph_state = False
        self._graph_state_migration: GraphStateMigration | None = None
        self._container_state_lock = threading.Lock()

    @property
    def variable_pool(self) -> VariablePool:
        return self._variable_pool

    @property
    def ready_queue(self) -> ReadyQueue:
        return self._ready_queue

    @property
    def deferred_ready_queue(self) -> ReadyQueue:
        return self._deferred_ready_queue

    @property
    def graph_execution(self) -> GraphExecution:
        return self._graph_execution

    @property
    def start_at(self) -> float:
        return self._start_at

    @property
    def total_tokens(self) -> int:
        return self._llm_usage.total_tokens

    @property
    def llm_usage(self) -> LLMUsage:
        return self._llm_usage.model_copy()

    def add_llm_usage(self, usage: LLMUsage) -> None:
        if usage.total_tokens <= 0:
            return
        if self._llm_usage.total_tokens == 0:
            self._llm_usage = usage.model_copy()
        else:
            self._llm_usage = self._llm_usage.plus(usage)

    @property
    def outputs(self) -> dict[str, object]:
        return deepcopy(self._outputs)

    def set_output(self, key: str, value: object) -> None:
        self._outputs[key] = deepcopy(value)

    def get_output(self, key: str, default: object = None) -> object:
        return deepcopy(self._outputs.get(key, default))

    def merge_response_outputs(self, outputs: Mapping[str, object]) -> None:
        for key, value in outputs.items():
            if key == "answer":
                existing = self.get_output("answer", "")
                if existing:
                    self.set_output("answer", f"{existing}{value}")
                else:
                    self.set_output("answer", value)
                continue
            self.set_output(key, value)

    @property
    def node_run_steps(self) -> int:
        return self._node_run_steps

    def increment_node_run_steps(self) -> None:
        self._node_run_steps += 1

    def restore_graph_state(
        self,
        *,
        node_states: Mapping[str, NodeState],
        edge_states: Mapping[str, NodeState],
    ) -> None:
        """Stage persisted graph states for the graph attached to this runtime.

        Frame restoration constructs runtime state before constructing its
        scoped graph. This method records the exact node and edge mappings for
        that frame; :meth:`attach_graph` rejects both missing and unrelated
        entries before the frame becomes executable. A snapshot version module
        may stage its own conversion before this exact check. Staging is rejected
        after graph attachment so callers cannot overwrite a live graph.

        Args:
            node_states: Persisted node states keyed by node ID.
            edge_states: Persisted edge states keyed by edge ID.

        Raises:
            RuntimeError: If a graph is already attached to this runtime state.

        """
        if self._graph is not None or self._has_pending_graph_state:
            msg = "graph state must be restored before attaching a graph"
            raise RuntimeError(msg)
        self._pending_graph_node_states = dict(node_states)
        self._pending_graph_edge_states = dict(edge_states)
        self._has_pending_graph_state = True

    def attach_graph(self, graph: GraphProtocol) -> None:
        """Attach the materialized graph and apply any staged snapshot state.

        Snapshot version modules may stage a graph-aware migration that cannot
        run until the graph definition exists. The migration must replace the
        staged maps atomically or raise; successful migrations are discarded so
        all subsequent attachment and serialization follows current semantics.

        Args:
            graph: Materialized graph owned by this runtime frame.

        Raises:
            ValueError: If another graph instance is already attached.
            RuntimeError: If saved state cannot be migrated or does not exactly
                match the attached graph after migration.

        """
        if self._graph is not None and self._graph is not graph:
            msg = "RuntimeState already attached to a different graph instance"
            raise ValueError(msg)
        if self._graph_state_migration is not None:
            self._graph_state_migration(self, graph)
            self._graph_state_migration = None
        if self._has_pending_graph_state and (
            set(graph.nodes) != set(self._pending_graph_node_states)
            or set(graph.edges) != set(self._pending_graph_edge_states)
        ):
            msg = "Saved graph state does not match rebuilt graph"
            raise RuntimeError(msg)
        self._graph = graph
        self._apply_pending_graph_state()

    def _apply_pending_graph_state(self) -> None:
        if self._graph is None or not self._has_pending_graph_state:
            return
        for node_id, node in self._graph.nodes.items():
            node.state = self._pending_graph_node_states[node_id]
        for edge_id, edge in self._graph.edges.items():
            edge.state = self._pending_graph_edge_states[edge_id]
        self._pending_graph_node_states.clear()
        self._pending_graph_edge_states.clear()
        self._has_pending_graph_state = False

    def dumps(self) -> str:
        """Serialize runtime state into a version 3 JSON string.

        Finish consuming or close the engine run iterator and wait for all
        execution threads to stop first. The guard is shared by child frames and
        excludes engine startup and other snapshots throughout serialization.
        Hosts must also avoid concurrent direct mutations of runtime objects.

        A restored state with a graph-aware migration must first attach its graph
        so persisted identities can be converted safely. Refusing to serialize
        before that point prevents unconverted data from being labeled current.

        Returns:
            The complete version 3 runtime snapshot as JSON.

        Raises:
            RuntimeError: If execution is active or a snapshot migration is
                waiting for graph attachment.

        """
        if self._graph_state_migration is not None:
            msg = (
                "Runtime state with a pending migration must attach its graph "
                "before serialization"
            )
            raise RuntimeError(msg)
        from .v3 import dumps  # ruff:ignore[import-outside-top-level]

        with self._graph_execution.lock_for_snapshot():
            return dumps(self)

    @classmethod
    def from_snapshot(
        cls: type[RuntimeState],
        data: str,
        *,
        ready_queue_factory: Callable[[], ReadyQueue] = InMemoryReadyQueue,
    ) -> RuntimeState:
        """Restore a snapshot with the loader named by its serialized version.

        Version discovery is deliberately file-based: ``<major>.0`` resolves to
        ``runtime_state.v<major>``. A compatibility version can therefore be
        retired by deleting its module; this core class and the remaining version
        modules need no edits.

        Args:
            data: Serialized runtime-state JSON.
            ready_queue_factory: Factory used for both restored task queues.

        Returns:
            A fully validated runtime state, with any graph-aware migration
            staged by the selected version module.

        """
        return load_snapshot(
            data,
            state_type=cls,
            ready_queue_factory=ready_queue_factory,
        )

    def defer_ready_task(self, task: ReadyTask) -> None:
        self._deferred_ready_queue.put(task)

    def take_deferred_ready_tasks(self) -> list[ReadyTask]:
        """Remove and return every task deferred while execution was paused.

        Returns:
            Deferred ready tasks in the order they were originally queued.

        """
        return self._deferred_ready_queue.take_all()

    def enqueue_ready_task(self, task: ReadyTask) -> None:
        if self.graph_execution.paused:
            self.defer_ready_task(task)
            return
        self.ready_queue.put(task)

    def snapshot_frame(
        self,
        *,
        variable_pool_scope: Literal["local", "parent"] = "local",
        copy_variable_pool: bool = True,
    ) -> FrameRuntimeData:
        graph = self._graph
        if graph is None:
            msg = "graph must be attached before snapshotting a frame"
            raise RuntimeError(msg)
        return FrameRuntimeData(
            variable_pool=(
                (
                    self.variable_pool.model_copy(deep=True)
                    if copy_variable_pool
                    else self.variable_pool
                )
                if variable_pool_scope == "local"
                else "parent"
            ),
            outputs=self.outputs,
            llm_usage=self.llm_usage,
            node_run_steps=self.node_run_steps,
            graph_node_states={
                node_id: node.state for node_id, node in graph.nodes.items()
            },
            graph_edge_states={
                edge_id: edge.state for edge_id, edge in graph.edges.items()
            },
        )

    def put_container_run(self, run: ContainerRunState) -> None:
        with self._container_state_lock:
            self._container_runs[run.invocation_id] = run

    def get_container_run(self, invocation_id: str) -> ContainerRunState:
        with self._container_state_lock:
            return self._container_runs[invocation_id]

    def container_runs(self) -> tuple[ContainerRunState, ...]:
        with self._container_state_lock:
            return tuple(self._container_runs.values())

    def pop_container_run(self, invocation_id: str) -> ContainerRunState:
        with self._container_state_lock:
            return self._container_runs.pop(invocation_id)

    def put_container_frame(self, frame: ContainerFrameState) -> None:
        with self._container_state_lock:
            self._container_frames[frame.frame_id] = frame

    def get_container_frame(self, frame_id: str) -> ContainerFrameState:
        with self._container_state_lock:
            return self._container_frames[frame_id]

    def container_frames(self) -> tuple[ContainerFrameState, ...]:
        with self._container_state_lock:
            return tuple(self._container_frames.values())

    def pop_container_frame(self, frame_id: str) -> ContainerFrameState:
        with self._container_state_lock:
            return self._container_frames.pop(frame_id)
