"""
QueueBasedGraphEngine - Main orchestrator for queue-based workflow execution.

This engine uses a modular architecture with separated packages following
Domain-Driven Design principles for improved maintainability and testability.
"""

import contextvars
import logging
import queue
from collections.abc import Generator, Mapping
from typing import final

from flask import Flask, current_app

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphRuntimeState
from core.workflow.enums import NodeExecutionType
from core.workflow.graph import Graph
from core.workflow.graph_events import (
    GraphEngineEvent,
    GraphNodeEventBase,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
)
from models.enums import UserFrom

from .command_processing import AbortCommandHandler, CommandProcessor
from .domain import ExecutionContext, GraphExecution
from .entities.commands import AbortCommand
from .error_handling import ErrorHandler
from .event_management import EventCollector, EventEmitter, EventHandlerRegistry
from .graph_traversal import BranchHandler, EdgeProcessor, NodeReadinessChecker, SkipPropagator
from .layers.base import Layer
from .orchestration import Dispatcher, ExecutionCoordinator
from .protocols.command_channel import CommandChannel
from .response_coordinator import ResponseStreamCoordinator
from .state_management import UnifiedStateManager
from .worker_management import SimpleWorkerPool

logger = logging.getLogger(__name__)


@final
class GraphEngine:
    """
    Queue-based graph execution engine.

    Uses a modular architecture that delegates responsibilities to specialized
    subsystems, following Domain-Driven Design and SOLID principles.
    """

    def __init__(
        self,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        user_id: str,
        user_from: UserFrom,
        invoke_from: InvokeFrom,
        call_depth: int,
        graph: Graph,
        graph_config: Mapping[str, object],
        graph_runtime_state: GraphRuntimeState,
        max_execution_steps: int,
        max_execution_time: int,
        command_channel: CommandChannel,
        min_workers: int | None = None,
        max_workers: int | None = None,
        scale_up_threshold: int | None = None,
        scale_down_idle_time: float | None = None,
    ) -> None:
        """Initialize the graph engine with separated concerns."""

        # Create domain models
        self.execution_context = ExecutionContext(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            user_id=user_id,
            user_from=user_from,
            invoke_from=invoke_from,
            call_depth=call_depth,
            max_execution_steps=max_execution_steps,
            max_execution_time=max_execution_time,
        )

        self.graph_execution = GraphExecution(workflow_id=workflow_id)

        # Store core dependencies
        self.graph = graph
        self.graph_config = graph_config
        self.graph_runtime_state = graph_runtime_state
        self.command_channel = command_channel

        # Store worker management parameters
        self._min_workers = min_workers
        self._max_workers = max_workers
        self._scale_up_threshold = scale_up_threshold
        self._scale_down_idle_time = scale_down_idle_time

        # Initialize queues
        self.ready_queue: queue.Queue[str] = queue.Queue()
        self.event_queue: queue.Queue[GraphNodeEventBase] = queue.Queue()

        # Initialize subsystems
        self._initialize_subsystems()

        # Layers for extensibility
        self._layers: list[Layer] = []

        # Validate graph state consistency
        self._validate_graph_state_consistency()

    def _initialize_subsystems(self) -> None:
        """Initialize all subsystems with proper dependency injection."""

        # Unified state management - single instance handles all state operations
        self.state_manager = UnifiedStateManager(self.graph, self.ready_queue)

        # Response coordination
        self.response_coordinator = ResponseStreamCoordinator(
            variable_pool=self.graph_runtime_state.variable_pool, graph=self.graph
        )

        # Event management
        self.event_collector = EventCollector()
        self.event_emitter = EventEmitter(self.event_collector)

        # Error handling
        self.error_handler = ErrorHandler(self.graph, self.graph_execution)

        # Graph traversal
        self.node_readiness_checker = NodeReadinessChecker(self.graph)
        self.edge_processor = EdgeProcessor(
            graph=self.graph,
            state_manager=self.state_manager,
            response_coordinator=self.response_coordinator,
        )
        self.skip_propagator = SkipPropagator(
            graph=self.graph,
            state_manager=self.state_manager,
        )
        self.branch_handler = BranchHandler(
            graph=self.graph,
            edge_processor=self.edge_processor,
            skip_propagator=self.skip_propagator,
            state_manager=self.state_manager,
        )

        # Event handler registry with all dependencies
        self.event_handler_registry = EventHandlerRegistry(
            graph=self.graph,
            graph_runtime_state=self.graph_runtime_state,
            graph_execution=self.graph_execution,
            response_coordinator=self.response_coordinator,
            event_collector=self.event_collector,
            branch_handler=self.branch_handler,
            edge_processor=self.edge_processor,
            state_manager=self.state_manager,
            error_handler=self.error_handler,
        )

        # Command processing
        self.command_processor = CommandProcessor(
            command_channel=self.command_channel,
            graph_execution=self.graph_execution,
        )
        self._setup_command_handlers()

        # Worker management
        self._setup_worker_management()

        # Orchestration
        self.execution_coordinator = ExecutionCoordinator(
            graph_execution=self.graph_execution,
            state_manager=self.state_manager,
            event_handler=self.event_handler_registry,
            event_collector=self.event_collector,
            command_processor=self.command_processor,
            worker_pool=self._worker_pool,
        )

        self.dispatcher = Dispatcher(
            event_queue=self.event_queue,
            event_handler=self.event_handler_registry,
            event_collector=self.event_collector,
            execution_coordinator=self.execution_coordinator,
            max_execution_time=self.execution_context.max_execution_time,
            event_emitter=self.event_emitter,
        )

    def _setup_command_handlers(self) -> None:
        """Configure command handlers."""
        # Create handler instance that follows the protocol
        abort_handler = AbortCommandHandler()
        self.command_processor.register_handler(
            AbortCommand,
            abort_handler,
        )

    def _setup_worker_management(self) -> None:
        """Initialize worker management subsystem."""
        # Capture context for workers
        flask_app: Flask | None = None
        try:
            app = current_app._get_current_object()  # type: ignore
            if isinstance(app, Flask):
                flask_app = app
        except RuntimeError:
            pass

        context_vars = contextvars.copy_context()

        # Create simple worker pool
        self._worker_pool = SimpleWorkerPool(
            ready_queue=self.ready_queue,
            event_queue=self.event_queue,
            graph=self.graph,
            flask_app=flask_app,
            context_vars=context_vars,
            min_workers=self._min_workers,
            max_workers=self._max_workers,
            scale_up_threshold=self._scale_up_threshold,
            scale_down_idle_time=self._scale_down_idle_time,
        )

    def _validate_graph_state_consistency(self) -> None:
        """Validate that all nodes share the same GraphRuntimeState."""
        expected_state_id = id(self.graph_runtime_state)
        for node in self.graph.nodes.values():
            if id(node.graph_runtime_state) != expected_state_id:
                raise ValueError(f"GraphRuntimeState consistency violation: Node '{node.id}' has a different instance")

    def layer(self, layer: Layer) -> "GraphEngine":
        """Add a layer for extending functionality."""
        self._layers.append(layer)
        return self

    def run(self) -> Generator[GraphEngineEvent, None, None]:
        """
        Execute the graph using the modular architecture.

        Returns:
            Generator yielding GraphEngineEvent instances
        """
        try:
            # Initialize layers
            self._initialize_layers()

            # Start execution
            self.graph_execution.start()
            start_event = GraphRunStartedEvent()
            yield start_event

            # Start subsystems
            self._start_execution()

            # Yield events as they occur
            yield from self.event_emitter.emit_events()

            # Handle completion
            if self.graph_execution.aborted:
                abort_reason = "Workflow execution aborted by user command"
                if self.graph_execution.error:
                    abort_reason = str(self.graph_execution.error)
                yield GraphRunAbortedEvent(
                    reason=abort_reason,
                    outputs=self.graph_runtime_state.outputs,
                )
            elif self.graph_execution.has_error:
                if self.graph_execution.error:
                    raise self.graph_execution.error
            else:
                yield GraphRunSucceededEvent(
                    outputs=self.graph_runtime_state.outputs,
                )

        except Exception as e:
            yield GraphRunFailedEvent(error=str(e))
            raise

        finally:
            self._stop_execution()

    def _initialize_layers(self) -> None:
        """Initialize layers with context."""
        self.event_collector.set_layers(self._layers)
        for layer in self._layers:
            try:
                layer.initialize(self.graph_runtime_state, self.command_channel)
            except Exception as e:
                logger.warning("Failed to initialize layer %s: %s", layer.__class__.__name__, e)

            try:
                layer.on_graph_start()
            except Exception as e:
                logger.warning("Layer %s failed on_graph_start: %s", layer.__class__.__name__, e)

    def _start_execution(self) -> None:
        """Start execution subsystems."""
        # Start worker pool (it calculates initial workers internally)
        self._worker_pool.start()

        # Register response nodes
        for node in self.graph.nodes.values():
            if node.execution_type == NodeExecutionType.RESPONSE:
                self.response_coordinator.register(node.id)

        # Enqueue root node
        root_node = self.graph.root_node
        self.state_manager.enqueue_node(root_node.id)
        self.state_manager.start_execution(root_node.id)

        # Start dispatcher
        self.dispatcher.start()

    def _stop_execution(self) -> None:
        """Stop execution subsystems."""
        self.dispatcher.stop()
        self._worker_pool.stop()
        # Don't mark complete here as the dispatcher already does it

        # Notify layers
        logger = logging.getLogger(__name__)

        for layer in self._layers:
            try:
                layer.on_graph_end(self.graph_execution.error)
            except Exception as e:
                logger.warning("Layer %s failed on_graph_end: %s", layer.__class__.__name__, e)
