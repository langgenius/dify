"""
Base layer class for GraphEngine extensions.

This module provides the abstract base class for implementing layers that can
intercept and respond to GraphEngine events.
"""

from abc import ABC, abstractmethod

from core.workflow.graph_engine.protocols.command_channel import CommandChannel
from core.workflow.graph_events import GraphEngineEvent
from core.workflow.runtime import ReadOnlyGraphRuntimeState


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
        self.graph_runtime_state: ReadOnlyGraphRuntimeState | None = None
        self.command_channel: CommandChannel | None = None

    def initialize(self, graph_runtime_state: ReadOnlyGraphRuntimeState, command_channel: CommandChannel) -> None:
        """
        Initialize the layer with engine dependencies.

        Called by GraphEngine before execution starts to inject the read-only runtime state
        and command channel. This allows layers to observe engine context and send
        commands, but prevents direct state modification.

        Args:
            graph_runtime_state: Read-only view of the runtime state
            command_channel: Channel for sending commands to the engine
        """
        self.graph_runtime_state = graph_runtime_state
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
