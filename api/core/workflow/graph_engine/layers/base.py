"""
Base layer class for GraphEngine extensions.

This module provides the abstract base class for implementing layers that can
intercept and respond to GraphEngine events.
"""

from abc import ABC, abstractmethod
from typing import Optional

from core.workflow.entities import GraphRuntimeState
from core.workflow.graph_engine.protocols.command_channel import CommandChannel
from core.workflow.graph_events.base import GraphEngineEvent


class Layer(ABC):
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
        self.graph_runtime_state: Optional[GraphRuntimeState] = None
        self.command_channel: Optional[CommandChannel] = None

    def initialize(self, graph_runtime_state: GraphRuntimeState, command_channel: CommandChannel) -> None:
        """
        Initialize the layer with engine dependencies.

        Called by GraphEngine before execution starts to inject the runtime state
        and command channel. This allows layers to access engine context and send
        commands.

        Args:
            graph_runtime_state: The runtime state of the graph execution
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
    def on_graph_end(self, error: Optional[Exception]) -> None:
        """
        Called when graph execution ends.

        This is called after all nodes have been executed or when execution is
        aborted. Layers can use this to clean up resources or log final state.

        Args:
            error: The exception that caused execution to fail, or None if successful
        """
        pass
