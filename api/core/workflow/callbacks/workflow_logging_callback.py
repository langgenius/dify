from typing import Optional

from core.model_runtime.utils.encoders import jsonable_encoder
from core.workflow.graph_engine.entities.event import (
    GraphEngineEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    IterationRunFailedEvent,
    IterationRunNextEvent,
    IterationRunStartedEvent,
    IterationRunSucceededEvent,
    LoopRunFailedEvent,
    LoopRunNextEvent,
    LoopRunStartedEvent,
    LoopRunSucceededEvent,
    NodeRunFailedEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
    ParallelBranchRunFailedEvent,
    ParallelBranchRunStartedEvent,
    ParallelBranchRunSucceededEvent,
)

from .base_workflow_callback import WorkflowCallback

_TEXT_COLOR_MAPPING = {
    "blue": "36;1",
    "yellow": "33;1",
    "pink": "38;5;200",
    "green": "32;1",
    "red": "31;1",
}


class WorkflowLoggingCallback(WorkflowCallback):
    def __init__(self) -> None:
        self.current_node_id: Optional[str] = None

    def on_event(self, event: GraphEngineEvent) -> None:
        if isinstance(event, GraphRunStartedEvent):
            self.print_text("\n[GraphRunStartedEvent]", color="pink")
        elif isinstance(event, GraphRunSucceededEvent):
            self.print_text("\n[GraphRunSucceededEvent]", color="green")
        elif isinstance(event, GraphRunPartialSucceededEvent):
            self.print_text("\n[GraphRunPartialSucceededEvent]", color="pink")
        elif isinstance(event, GraphRunFailedEvent):
            self.print_text(f"\n[GraphRunFailedEvent] reason: {event.error}", color="red")
        elif isinstance(event, NodeRunStartedEvent):
            self.on_workflow_node_execute_started(event=event)
        elif isinstance(event, NodeRunSucceededEvent):
            self.on_workflow_node_execute_succeeded(event=event)
        elif isinstance(event, NodeRunFailedEvent):
            self.on_workflow_node_execute_failed(event=event)
        elif isinstance(event, NodeRunStreamChunkEvent):
            self.on_node_text_chunk(event=event)
        elif isinstance(event, ParallelBranchRunStartedEvent):
            self.on_workflow_parallel_started(event=event)
        elif isinstance(event, ParallelBranchRunSucceededEvent | ParallelBranchRunFailedEvent):
            self.on_workflow_parallel_completed(event=event)
        elif isinstance(event, IterationRunStartedEvent):
            self.on_workflow_iteration_started(event=event)
        elif isinstance(event, IterationRunNextEvent):
            self.on_workflow_iteration_next(event=event)
        elif isinstance(event, IterationRunSucceededEvent | IterationRunFailedEvent):
            self.on_workflow_iteration_completed(event=event)
        elif isinstance(event, LoopRunStartedEvent):
            self.on_workflow_loop_started(event=event)
        elif isinstance(event, LoopRunNextEvent):
            self.on_workflow_loop_next(event=event)
        elif isinstance(event, LoopRunSucceededEvent | LoopRunFailedEvent):
            self.on_workflow_loop_completed(event=event)
        else:
            self.print_text(f"\n[{event.__class__.__name__}]", color="blue")

    def on_workflow_node_execute_started(self, event: NodeRunStartedEvent) -> None:
        """
        Workflow node execute started
        """
        self.print_text("\n[NodeRunStartedEvent]", color="yellow")
        self.print_text(f"Node ID: {event.node_id}", color="yellow")
        self.print_text(f"Node Title: {event.node_data.title}", color="yellow")
        self.print_text(f"Type: {event.node_type.value}", color="yellow")

    def on_workflow_node_execute_succeeded(self, event: NodeRunSucceededEvent) -> None:
        """
        Workflow node execute succeeded
        """
        route_node_state = event.route_node_state

        self.print_text("\n[NodeRunSucceededEvent]", color="green")
        self.print_text(f"Node ID: {event.node_id}", color="green")
        self.print_text(f"Node Title: {event.node_data.title}", color="green")
        self.print_text(f"Type: {event.node_type.value}", color="green")

        if route_node_state.node_run_result:
            node_run_result = route_node_state.node_run_result
            self.print_text(
                f"Inputs: {jsonable_encoder(node_run_result.inputs) if node_run_result.inputs else ''}",
                color="green",
            )
            self.print_text(
                f"Process Data: "
                f"{jsonable_encoder(node_run_result.process_data) if node_run_result.process_data else ''}",
                color="green",
            )
            self.print_text(
                f"Outputs: {jsonable_encoder(node_run_result.outputs) if node_run_result.outputs else ''}",
                color="green",
            )
            self.print_text(
                f"Metadata: {jsonable_encoder(node_run_result.metadata) if node_run_result.metadata else ''}",
                color="green",
            )

    def on_workflow_node_execute_failed(self, event: NodeRunFailedEvent) -> None:
        """
        Workflow node execute failed
        """
        route_node_state = event.route_node_state

        self.print_text("\n[NodeRunFailedEvent]", color="red")
        self.print_text(f"Node ID: {event.node_id}", color="red")
        self.print_text(f"Node Title: {event.node_data.title}", color="red")
        self.print_text(f"Type: {event.node_type.value}", color="red")

        if route_node_state.node_run_result:
            node_run_result = route_node_state.node_run_result
            self.print_text(f"Error: {node_run_result.error}", color="red")
            self.print_text(
                f"Inputs: {jsonable_encoder(node_run_result.inputs) if node_run_result.inputs else ''}",
                color="red",
            )
            self.print_text(
                f"Process Data: "
                f"{jsonable_encoder(node_run_result.process_data) if node_run_result.process_data else ''}",
                color="red",
            )
            self.print_text(
                f"Outputs: {jsonable_encoder(node_run_result.outputs) if node_run_result.outputs else ''}",
                color="red",
            )

    def on_node_text_chunk(self, event: NodeRunStreamChunkEvent) -> None:
        """
        Publish text chunk
        """
        route_node_state = event.route_node_state
        if not self.current_node_id or self.current_node_id != route_node_state.node_id:
            self.current_node_id = route_node_state.node_id
            self.print_text("\n[NodeRunStreamChunkEvent]")
            self.print_text(f"Node ID: {route_node_state.node_id}")

            node_run_result = route_node_state.node_run_result
            if node_run_result:
                self.print_text(
                    f"Metadata: {jsonable_encoder(node_run_result.metadata) if node_run_result.metadata else ''}"
                )

        self.print_text(event.chunk_content, color="pink", end="")

    def on_workflow_parallel_started(self, event: ParallelBranchRunStartedEvent) -> None:
        """
        Publish parallel started
        """
        self.print_text("\n[ParallelBranchRunStartedEvent]", color="blue")
        self.print_text(f"Parallel ID: {event.parallel_id}", color="blue")
        self.print_text(f"Branch ID: {event.parallel_start_node_id}", color="blue")
        if event.in_iteration_id:
            self.print_text(f"Iteration ID: {event.in_iteration_id}", color="blue")
        if event.in_loop_id:
            self.print_text(f"Loop ID: {event.in_loop_id}", color="blue")

    def on_workflow_parallel_completed(
        self, event: ParallelBranchRunSucceededEvent | ParallelBranchRunFailedEvent
    ) -> None:
        """
        Publish parallel completed
        """
        if isinstance(event, ParallelBranchRunSucceededEvent):
            color = "blue"
        elif isinstance(event, ParallelBranchRunFailedEvent):
            color = "red"

        self.print_text(
            "\n[ParallelBranchRunSucceededEvent]"
            if isinstance(event, ParallelBranchRunSucceededEvent)
            else "\n[ParallelBranchRunFailedEvent]",
            color=color,
        )
        self.print_text(f"Parallel ID: {event.parallel_id}", color=color)
        self.print_text(f"Branch ID: {event.parallel_start_node_id}", color=color)
        if event.in_iteration_id:
            self.print_text(f"Iteration ID: {event.in_iteration_id}", color=color)
        if event.in_loop_id:
            self.print_text(f"Loop ID: {event.in_loop_id}", color=color)

        if isinstance(event, ParallelBranchRunFailedEvent):
            self.print_text(f"Error: {event.error}", color=color)

    def on_workflow_iteration_started(self, event: IterationRunStartedEvent) -> None:
        """
        Publish iteration started
        """
        self.print_text("\n[IterationRunStartedEvent]", color="blue")
        self.print_text(f"Iteration Node ID: {event.iteration_id}", color="blue")

    def on_workflow_iteration_next(self, event: IterationRunNextEvent) -> None:
        """
        Publish iteration next
        """
        self.print_text("\n[IterationRunNextEvent]", color="blue")
        self.print_text(f"Iteration Node ID: {event.iteration_id}", color="blue")
        self.print_text(f"Iteration Index: {event.index}", color="blue")

    def on_workflow_iteration_completed(self, event: IterationRunSucceededEvent | IterationRunFailedEvent) -> None:
        """
        Publish iteration completed
        """
        self.print_text(
            "\n[IterationRunSucceededEvent]"
            if isinstance(event, IterationRunSucceededEvent)
            else "\n[IterationRunFailedEvent]",
            color="blue",
        )
        self.print_text(f"Node ID: {event.iteration_id}", color="blue")

    def on_workflow_loop_started(self, event: LoopRunStartedEvent) -> None:
        """
        Publish loop started
        """
        self.print_text("\n[LoopRunStartedEvent]", color="blue")
        self.print_text(f"Loop Node ID: {event.loop_node_id}", color="blue")

    def on_workflow_loop_next(self, event: LoopRunNextEvent) -> None:
        """
        Publish loop next
        """
        self.print_text("\n[LoopRunNextEvent]", color="blue")
        self.print_text(f"Loop Node ID: {event.loop_node_id}", color="blue")
        self.print_text(f"Loop Index: {event.index}", color="blue")

    def on_workflow_loop_completed(self, event: LoopRunSucceededEvent | LoopRunFailedEvent) -> None:
        """
        Publish loop completed
        """
        self.print_text(
            "\n[LoopRunSucceededEvent]" if isinstance(event, LoopRunSucceededEvent) else "\n[LoopRunFailedEvent]",
            color="blue",
        )
        self.print_text(f"Loop Node ID: {event.loop_node_id}", color="blue")

    def print_text(self, text: str, color: Optional[str] = None, end: str = "\n") -> None:
        """Print text with highlighting and no end characters."""
        text_to_print = self._get_colored_text(text, color) if color else text
        print(f"{text_to_print}", end=end)

    def _get_colored_text(self, text: str, color: str) -> str:
        """Get colored text."""
        color_str = _TEXT_COLOR_MAPPING[color]
        return f"\u001b[{color_str}m\033[1;3m{text}\u001b[0m"
