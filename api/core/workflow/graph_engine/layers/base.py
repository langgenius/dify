"""
Base layer class for GraphEngine extensions.

This module provides the abstract base class for implementing layers that can
intercept and respond to GraphEngine events.
"""

from abc import ABC, abstractmethod

from core.workflow.graph_engine.protocols.command_channel import CommandChannel
from core.workflow.graph_events import GraphEngineEvent, GraphNodeEventBase
from core.workflow.nodes.base.node import Node
from core.workflow.runtime import ReadOnlyGraphRuntimeState


class GraphEngineLayerNotInitializedError(Exception):
    """Raised when a layer's runtime state is accessed before initialization."""

    def __init__(self, layer_name: str | None = None) -> None:
        name = layer_name or "GraphEngineLayer"
        super().__init__(f"{name} runtime state is not initialized. Bind the layer to a GraphEngine before access.")


class GraphEngineLayer(ABC):
    """
    Abstract base class for GraphEngine layers.

    Layers are middleware-like components that can:
    - Observe all events emitted by the GraphEngine
    - Access the graph runtime state
    - Send commands to control execution

    Subclasses should override the constructor to accept configuration parameters,
    then implement the three lifecycle methods.
    """

    def __init__(self) -> None:
        """Initialize the layer. Subclasses can override with custom parameters."""
        self._graph_runtime_state: ReadOnlyGraphRuntimeState | None = None
        self.command_channel: CommandChannel | None = None

    @property
    def graph_runtime_state(self) -> ReadOnlyGraphRuntimeState:
        if self._graph_runtime_state is None:
            raise GraphEngineLayerNotInitializedError(type(self).__name__)
        return self._graph_runtime_state

    def initialize(self, graph_runtime_state: ReadOnlyGraphRuntimeState, command_channel: CommandChannel) -> None:
        """
        Initialize the layer with engine dependencies.

        Called by GraphEngine to inject the read-only runtime state and command channel.
        This is invoked when the layer is registered with a `GraphEngine` instance.
        Implementations should be idempotent.
        Args:
            graph_runtime_state: Read-only view of the runtime state
            command_channel: Channel for sending commands to the engine
        """
        self._graph_runtime_state = graph_runtime_state
        self.command_channel = command_channel

    @abstractmethod
    def on_graph_start(self) -> None:
        """
        Called when graph execution starts.

        This is called after the engine has been initialized but before any nodes
        are executed. Layers can use this to set up resources or log start information.
        """
        pass

    @abstractmethod
    def on_event(self, event: GraphEngineEvent) -> None:
        """
        Called for every event emitted by the engine.

        This method receives all events generated during graph execution, including:
        - Graph lifecycle events (start, success, failure)
        - Node execution events (start, success, failure, retry)
        - Stream events for response nodes
        - Container events (iteration, loop)

        Args:
            event: The event emitted by the engine
        """
        pass

    @abstractmethod
    def on_graph_end(self, error: Exception | None) -> None:
        """
        Called when graph execution ends.

        This is called after all nodes have been executed or when execution is
        aborted. Layers can use this to clean up resources or log final state.

        Args:
            error: The exception that caused execution to fail, or None if successful
        """
        pass

    def on_node_run_start(self, node: Node) -> None:
        """
        Called immediately before a node begins execution.

        Layers can override to inject behavior (e.g., start spans) prior to node execution.
        The node's execution ID is available via `node._node_execution_id` and will be
        consistent with all events emitted by this node execution.

        Args:
            node: The node instance about to be executed
        """
        return

    def on_node_run_end(
        self, node: Node, error: Exception | None, result_event: GraphNodeEventBase | None = None
    ) -> None:
        """
        Called after a node finishes execution.

        The node's execution ID is available via `node._node_execution_id` and matches
        the `id` field in all events emitted by this node execution.

        Args:
            node: The node instance that just finished execution
            error: Exception instance if the node failed, otherwise None
            result_event: The final result event from node execution (succeeded/failed/paused), if any
        """
        return
