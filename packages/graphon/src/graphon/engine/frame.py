"""Execution frame storage and construction."""

from __future__ import annotations

from dataclasses import dataclass
from typing import final

from graphon.graph.graph import Graph
from graphon.runtime.container_state import FrameRuntimeData
from graphon.runtime.runtime_state import RuntimeState
from graphon.runtime.variable_pool import VariablePool

from .event.node_failure import NodeFailureHandler
from .scheduler import Scheduler


@dataclass(frozen=True, slots=True)
class ExecutionFrame:
    frame_id: str
    graph: Graph
    state: RuntimeState
    scheduler: Scheduler
    failure_handler: NodeFailureHandler
    container_id: str = ""


@final
class FrameRegistry:
    def __init__(self) -> None:
        self._frames: dict[str, ExecutionFrame] = {}

    def register(self, frame: ExecutionFrame) -> None:
        self._frames[frame.frame_id] = frame

    def __getitem__(self, frame_id: str) -> ExecutionFrame:
        """Return a registered frame by its required identifier.

        Frame lookups are never optional during execution. Using subscription
        syntax makes the existing ``KeyError`` behavior explicit instead of
        resembling ``dict.get()``, which conventionally returns ``None``.

        Args:
            frame_id: Identifier of the frame to retrieve.

        Returns:
            The registered execution frame.

        """
        return self._frames[frame_id]

    def frames(self) -> tuple[ExecutionFrame, ...]:
        """Return an immutable snapshot of every currently live frame.

        The dispatcher owns frame creation, removal, and command processing, so
        callers can safely traverse this tuple without exposing the registry's
        mutable mapping. The snapshot is used for workflow-level operations that
        must affect root and descendant frames consistently.

        Returns:
            Root and child execution frames registered at call time.

        """
        return tuple(self._frames.values())

    def remove(self, frame_id: str) -> None:
        del self._frames[frame_id]

    def create(
        self,
        *,
        frame_id: str,
        container_id: str,
        graph: Graph,
        state: RuntimeState,
    ) -> ExecutionFrame:
        """Create and register a fully wired frame.

        The runtime state owns graph attachment and any pending snapshot
        restoration. This method only creates the frame-local scheduler and
        failure handler after that attachment succeeds, so an invalid snapshot
        can never leave a partially registered frame behind.

        Args:
            frame_id: Unique frame ID used by scheduled tasks.
            container_id: Direct owning container node ID; root uses ``""``.
            graph: Graph structure executable by this frame.
            state: Mutable runtime state owned by this graph execution.

        Returns:
            The registered, fully wired execution frame.

        """
        state.attach_graph(graph)
        scheduler = Scheduler(
            graph,
            state,
            frame_id,
        )
        frame = ExecutionFrame(
            frame_id=frame_id,
            graph=graph,
            state=state,
            scheduler=scheduler,
            failure_handler=NodeFailureHandler(graph, state.graph_execution),
            container_id=container_id,
        )
        self.register(frame)
        return frame

    def create_child(
        self,
        *,
        frame_id: str,
        parent_frame_id: str,
        container_id: str,
        root_node_id: str,
        variable_pool: VariablePool,
    ) -> ExecutionFrame:
        """Create a child frame from its parent's container-scoped graph.

        The child receives an independent variable pool and runtime counters,
        while queues and graph-wide execution state are inherited from the
        parent. Only the graph config owned by ``container_id`` is materialized.

        Args:
            frame_id: Unique ID for the new child frame.
            parent_frame_id: Frame whose scoped config contains the child.
            container_id: Container node that directly owns the child graph.
            root_node_id: Entry node within the child graph.
            variable_pool: Variable pool owned by the new child state.

        Returns:
            The registered child execution frame.

        """
        parent_state = self[parent_frame_id].state
        state = self._create_child_state(
            parent_state=parent_state,
            variable_pool=variable_pool,
        )
        return self._create_child_with_state(
            frame_id=frame_id,
            parent_frame_id=parent_frame_id,
            container_id=container_id,
            root_node_id=root_node_id,
            state=state,
        )

    def restore_child(
        self,
        *,
        frame_id: str,
        parent_frame_id: str,
        container_id: str,
        root_node_id: str,
        runtime_data: FrameRuntimeData,
        variable_pool: VariablePool,
    ) -> ExecutionFrame:
        """Restore a child frame from container-agnostic runtime data.

        Container handlers extract their own frame-specific fields before
        calling this method. The registry therefore needs no knowledge of Loop,
        Iteration, or downstream container state models. Runtime counters and
        saved graph states are restored before the graph is attached.

        Args:
            frame_id: Identifier of the child frame being restored.
            parent_frame_id: Frame whose scoped config contains the child.
            container_id: Container node that directly owns the child graph.
            root_node_id: Entry node within the restored child graph.
            runtime_data: Generic persisted data for the child runtime.
            variable_pool: Resolved variable pool owned by the child.

        Returns:
            The registered and restored child execution frame.

        """
        parent_state = self[parent_frame_id].state
        state = self._create_child_state(
            parent_state=parent_state,
            variable_pool=variable_pool,
            runtime_data=runtime_data,
        )
        return self._create_child_with_state(
            frame_id=frame_id,
            parent_frame_id=parent_frame_id,
            container_id=container_id,
            root_node_id=root_node_id,
            state=state,
        )

    def _create_child_with_state(
        self,
        *,
        frame_id: str,
        parent_frame_id: str,
        container_id: str,
        root_node_id: str,
        state: RuntimeState,
    ) -> ExecutionFrame:
        """Build a scoped child graph around an already prepared state.

        The parent's retained graph config and node factory are the only graph
        construction inputs. Rebinding the factory prevents child nodes from
        observing the parent's mutable runtime state.

        Args:
            frame_id: Unique ID for the new child frame.
            parent_frame_id: Frame whose graph owns the container config.
            container_id: Container node that scopes the child graph.
            root_node_id: Entry node within the child graph.
            state: Prepared runtime state to bind to child nodes.

        Returns:
            The registered child execution frame.

        Raises:
            RuntimeError: If the parent lacks graph config or a node factory.

        """
        parent_graph = self[parent_frame_id].graph
        graph_config = parent_graph.graph_config
        if graph_config is None:
            msg = "Parent graph does not carry graph_config for frame creation."
            raise RuntimeError(msg)
        node_factory = parent_graph.node_factory
        if node_factory is None:
            msg = "Parent graph does not carry node_factory for frame creation."
            raise RuntimeError(msg)

        rebound_factory = node_factory.with_runtime_state(state)
        graph = Graph.init(
            graph_config=graph_config,
            node_factory=rebound_factory,
            root_node_id=root_node_id,
            container_id=container_id,
        )
        return self.create(
            frame_id=frame_id,
            container_id=container_id,
            graph=graph,
            state=state,
        )

    @staticmethod
    def _create_child_state(
        *,
        parent_state: RuntimeState,
        variable_pool: VariablePool,
        runtime_data: FrameRuntimeData | None = None,
    ) -> RuntimeState:
        """Create a child runtime state with parent-owned shared services.

        Fresh children start with empty counters and outputs. Restored children
        receive their saved usage, outputs, steps, and pending graph states.
        Both paths reuse the parent's ready queues and graph-wide execution so
        scheduling and terminal status remain coordinated across frames.

        Args:
            parent_state: Runtime state of the frame owning the child container.
            variable_pool: Independent variable pool for the child frame.
            runtime_data: Optional persisted child data to restore.

        Returns:
            An unattached runtime state ready for child graph construction.

        """
        state = RuntimeState(
            variable_pool=variable_pool,
            start_at=parent_state.start_at,
            llm_usage=None if runtime_data is None else runtime_data.llm_usage,
            outputs=None if runtime_data is None else dict(runtime_data.outputs),
            node_run_steps=0 if runtime_data is None else runtime_data.node_run_steps,
            ready_queue=parent_state.ready_queue,
            deferred_ready_queue=parent_state.deferred_ready_queue,
            graph_execution=parent_state.graph_execution,
        )
        if runtime_data is not None:
            state.restore_graph_state(
                node_states=runtime_data.graph_node_states,
                edge_states=runtime_data.graph_edge_states,
            )
        return state
