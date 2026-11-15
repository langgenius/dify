"""Base class for Engine extensions.

This module defines the lifecycle hooks and shared runtime binding used by layers
that intercept and respond to Engine events.
"""

from contextlib import AbstractContextManager, nullcontext

from graphon.engine.command.protocol import CommandChannel
from graphon.engine_events.base import (
    EngineEvent,
    NodeEvent,
)
from graphon.nodes.base.node import Node
from graphon.runtime.runtime_state_protocol import ReadOnlyRuntimeState


class Layer:
    """Base class for Engine layers.

    Layers are middleware-like components that can:
    - Observe all events emitted by the Engine
    - Access the runtime state
    - Send commands to control execution

    Subclasses override only the lifecycle hooks they need. The default hooks
    are no-ops, so event-only and node-only layers do not need placeholder methods.
    """

    def __init__(self) -> None:
        """Initialize the layer. Subclasses can override with custom parameters."""
        self._runtime_state: ReadOnlyRuntimeState | None = None
        self.command_channel: CommandChannel | None = None

    @property
    def runtime_state(self) -> ReadOnlyRuntimeState:
        """Return the read-only runtime state bound by ``Engine.add_layer``.

        Raises:
            RuntimeError: If the layer has not been registered with an engine.

        """
        if self._runtime_state is None:
            msg = (
                f"{type(self).__name__} runtime state is not initialized. "
                "Bind the layer to an Engine before access."
            )
            raise RuntimeError(msg)
        return self._runtime_state

    def initialize(
        self,
        runtime_state: ReadOnlyRuntimeState,
        command_channel: CommandChannel,
    ) -> None:
        """Initialize the layer with engine dependencies.

        Called by Engine to inject the read-only runtime state and command channel.
        This is invoked when the layer is registered with an `Engine` instance.
        Implementations should be idempotent.

        Args:
            runtime_state: Read-only view of the runtime state
            command_channel: Channel for sending commands to the engine

        """
        self._runtime_state = runtime_state
        self.command_channel = command_channel

    def on_graph_start(self) -> None:
        """Called when graph execution starts.

        This is called after the engine has been initialized but before any nodes
        are executed. Layers can use this to set up resources or log start information.
        """

    def on_event(self, event: EngineEvent) -> None:
        """Called for every event emitted by the engine.

        This method receives all events generated during graph execution, including:
        - Graph lifecycle events (start, success, failure)
        - Node execution events (start, success, failure, retry)
        - Stream events for response nodes
        - Container events (iteration, loop)

        Args:
            event: The event emitted by the engine

        """

    def on_graph_end(self, error: Exception | None) -> None:
        """Called when graph execution ends.

        This is called after all nodes have been executed or when execution is
        aborted. Layers can use this to clean up resources or log final state.

        Args:
            error: The exception that caused execution to fail, or None if successful

        """

    def node_run_context(
        self,
        node: Node,
        *,
        parent_execution_id: str | None = None,
    ) -> AbstractContextManager[None]:
        """Activate context for one worker task, including container resumes.

        Entered before node hooks and exited on completion, suspension, or error
        in the same worker context. A suspended container keeps its logical
        execution ID, but each resume gets a fresh context manager. Keep context
        tokens inside this manager, not between ``on_node_run_start`` and
        ``on_node_run_end``, which may run on different workers.

        ``parent_execution_id`` identifies the directly owning container's node
        execution (including custom containers), or is ``None`` in the root
        frame. It is independent of graph-local node IDs. Context manager errors
        are logged and isolated like other layer hooks; managers cannot suppress
        node execution errors.

        Returns:
            A new context manager for this worker task.

        """
        _ = node
        _ = parent_execution_id
        return nullcontext()

    def on_node_run_start(self, node: Node) -> None:
        """Called immediately before a node begins execution.

        Layers can override to inject behavior (e.g., start spans)
        prior to node execution. This is not called again on container resume.
        The node's execution ID is available via `node._node_execution_id` and will be
        consistent with all events emitted by this node execution.

        Args:
            node: The node instance about to be executed

        """
        _ = node

    def on_node_run_end(
        self,
        node: Node,
        error: Exception | None,
        result_event: NodeEvent | None = None,
    ) -> None:
        """Called after a node finishes execution.

        A suspended container does not finish until its final resume, which can
        run on a different worker from ``on_node_run_start``.
        The node's execution ID is available via `node._node_execution_id` and matches
        the `id` field in all events emitted by this node execution.

        Args:
            node: The node instance that just finished execution
            error: Exception instance if the node failed, otherwise None
            result_event: The final result event from node execution
            (succeeded/failed/paused), if any

        """
        _ = node
        _ = error
        _ = result_event
