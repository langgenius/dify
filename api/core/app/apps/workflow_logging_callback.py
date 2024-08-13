from typing import Optional

from core.model_runtime.utils.encoders import jsonable_encoder
from core.workflow.callbacks.base_workflow_callback import WorkflowCallback
from core.workflow.graph_engine.entities.event import (
    GraphEngineEvent,
    GraphRunFailedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    IterationRunFailedEvent,
    IterationRunNextEvent,
    IterationRunStartedEvent,
    IterationRunSucceededEvent,
    NodeRunFailedEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState

_TEXT_COLOR_MAPPING = {
    "blue": "36;1",
    "yellow": "33;1",
    "pink": "38;5;200",
    "green": "32;1",
    "red": "31;1",
}


class WorkflowLoggingCallback(WorkflowCallback):

    def __init__(self) -> None:
        self.current_node_id = None

    def on_event(
            self,
            graph: Graph,
            graph_init_params: GraphInitParams,
            graph_runtime_state: GraphRuntimeState,
            event: GraphEngineEvent
    ) -> None:
        if isinstance(event, GraphRunStartedEvent):
            self.print_text("\n[on_workflow_run_started]", color='pink')
        elif isinstance(event, GraphRunSucceededEvent):
            self.print_text("\n[on_workflow_run_succeeded]", color='green')
        elif isinstance(event, GraphRunFailedEvent):
            self.print_text(f"\n[on_workflow_run_failed] reason: {event.error}", color='red')
        elif isinstance(event, NodeRunStartedEvent):
            self.on_workflow_node_execute_started(
                graph=graph,
                event=event
            )
        elif isinstance(event, NodeRunSucceededEvent):
            self.on_workflow_node_execute_succeeded(
                graph=graph,
                graph_init_params=graph_init_params,
                graph_runtime_state=graph_runtime_state,
                event=event
            )
        elif isinstance(event, NodeRunFailedEvent):
            self.on_workflow_node_execute_failed(
                graph=graph,
                graph_init_params=graph_init_params,
                graph_runtime_state=graph_runtime_state,
                event=event
            )
        elif isinstance(event, NodeRunStreamChunkEvent):
            self.on_node_text_chunk(
                graph=graph,
                graph_init_params=graph_init_params,
                graph_runtime_state=graph_runtime_state,
                event=event
            )
        elif isinstance(event, IterationRunStartedEvent):
            self.on_workflow_iteration_started(
                graph=graph,
                graph_init_params=graph_init_params,
                graph_runtime_state=graph_runtime_state,
                event=event
            )
        elif isinstance(event, IterationRunNextEvent):
            self.on_workflow_iteration_next(
                graph=graph,
                graph_init_params=graph_init_params,
                graph_runtime_state=graph_runtime_state,
                event=event
            )
        elif isinstance(event, IterationRunSucceededEvent | IterationRunFailedEvent):
            self.on_workflow_iteration_completed(
                graph=graph,
                graph_init_params=graph_init_params,
                graph_runtime_state=graph_runtime_state,
                event=event
            )
        else:
            self.print_text(f"\n[{event.__class__.__name__}]", color='blue')

    def on_workflow_node_execute_started(
            self,
            graph: Graph,
            event: NodeRunStartedEvent
    ) -> None:
        """
        Workflow node execute started
        """
        route_node_state = event.route_node_state
        node_config = graph.node_id_config_mapping.get(route_node_state.node_id)
        node_type = None
        if node_config:
            node_type = node_config.get("data", {}).get("type")

        self.print_text("\n[on_workflow_node_execute_started]", color='yellow')
        self.print_text(f"Node ID: {route_node_state.node_id}", color='yellow')
        self.print_text(f"Type: {node_type}", color='yellow')

    def on_workflow_node_execute_succeeded(
            self,
            graph: Graph,
            graph_init_params: GraphInitParams,
            graph_runtime_state: GraphRuntimeState,
            event: NodeRunSucceededEvent
    ) -> None:
        """
        Workflow node execute succeeded
        """
        route_node_state = event.route_node_state
        node_config = graph.node_id_config_mapping.get(route_node_state.node_id)
        node_type = None
        if node_config:
            node_type = node_config.get("data", {}).get("type")

        self.print_text("\n[on_workflow_node_execute_succeeded]", color='green')
        self.print_text(f"Node ID: {route_node_state.node_id}", color='green')
        self.print_text(f"Type: {node_type}", color='green')

        if route_node_state.node_run_result:
            node_run_result = route_node_state.node_run_result
            self.print_text(f"Inputs: {jsonable_encoder(node_run_result.inputs) if node_run_result.inputs else ''}",
                            color='green')
            self.print_text(
                f"Process Data: {jsonable_encoder(node_run_result.process_data) if node_run_result.process_data else ''}",
                color='green')
            self.print_text(f"Outputs: {jsonable_encoder(node_run_result.outputs) if node_run_result.outputs else ''}",
                            color='green')
            self.print_text(
                f"Metadata: {jsonable_encoder(node_run_result.metadata) if node_run_result.metadata else ''}",
                color='green')

    def on_workflow_node_execute_failed(
            self,
            graph: Graph,
            graph_init_params: GraphInitParams,
            graph_runtime_state: GraphRuntimeState,
            event: NodeRunFailedEvent
    ) -> None:
        """
        Workflow node execute failed
        """
        route_node_state = event.route_node_state
        node_config = graph.node_id_config_mapping.get(route_node_state.node_id)
        node_type = None
        if node_config:
            node_type = node_config.get("data", {}).get("type")

        self.print_text("\n[on_workflow_node_execute_failed]", color='red')
        self.print_text(f"Node ID: {route_node_state.node_id}", color='red')
        self.print_text(f"Type: {node_type}", color='red')

        if route_node_state.node_run_result:
            node_run_result = route_node_state.node_run_result
            self.print_text(f"Error: {node_run_result.error}", color='red')
            self.print_text(f"Inputs: {jsonable_encoder(node_run_result.inputs) if node_run_result.inputs else ''}",
                            color='red')
            self.print_text(
                f"Process Data: {jsonable_encoder(node_run_result.process_data) if node_run_result.process_data else ''}",
                color='red')
            self.print_text(f"Outputs: {jsonable_encoder(node_run_result.outputs) if node_run_result.outputs else ''}",
                            color='red')

    def on_node_text_chunk(
            self,
            graph: Graph,
            graph_init_params: GraphInitParams,
            graph_runtime_state: GraphRuntimeState,
            event: NodeRunStreamChunkEvent
    ) -> None:
        """
        Publish text chunk
        """
        route_node_state = event.route_node_state
        if not self.current_node_id or self.current_node_id != route_node_state.node_id:
            self.current_node_id = route_node_state.node_id
            self.print_text('\n[on_node_text_chunk]')
            self.print_text(f"Node ID: {route_node_state.node_id}")

            node_run_result = route_node_state.node_run_result
            if node_run_result:
                self.print_text(
                    f"Metadata: {jsonable_encoder(node_run_result.metadata) if node_run_result.metadata else ''}")

        self.print_text(event.chunk_content, color="pink", end="")

    def on_workflow_iteration_started(
            self,
            graph: Graph,
            graph_init_params: GraphInitParams,
            graph_runtime_state: GraphRuntimeState,
            event: IterationRunStartedEvent
    ) -> None:
        """
        Publish iteration started
        """
        self.print_text("\n[on_workflow_iteration_started]", color='blue')
        self.print_text(f"Node ID: {event.iteration_id}", color='blue')

    def on_workflow_iteration_next(
            self,
            graph: Graph,
            graph_init_params: GraphInitParams,
            graph_runtime_state: GraphRuntimeState,
            event: IterationRunNextEvent
    ) -> None:
        """
        Publish iteration next
        """
        self.print_text("\n[on_workflow_iteration_next]", color='blue')
        self.print_text(f"Node ID: {event.iteration_id}", color='blue')

    def on_workflow_iteration_completed(
            self,
            graph: Graph,
            graph_init_params: GraphInitParams,
            graph_runtime_state: GraphRuntimeState,
            event: IterationRunSucceededEvent | IterationRunFailedEvent
    ) -> None:
        """
        Publish iteration completed
        """
        self.print_text("\n[on_workflow_iteration_completed]", color='blue')
        self.print_text(f"Node ID: {event.iteration_id}", color='blue')

    def print_text(
            self, text: str, color: Optional[str] = None, end: str = "\n"
    ) -> None:
        """Print text with highlighting and no end characters."""
        text_to_print = self._get_colored_text(text, color) if color else text
        print(f'{text_to_print}', end=end)

    def _get_colored_text(self, text: str, color: str) -> str:
        """Get colored text."""
        color_str = _TEXT_COLOR_MAPPING[color]
        return f"\u001b[{color_str}m\033[1;3m{text}\u001b[0m"
