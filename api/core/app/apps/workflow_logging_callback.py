from typing import Optional

from core.app.entities.queue_entities import AppQueueEvent
from core.model_runtime.utils.encoders import jsonable_encoder
from core.workflow.callbacks.base_workflow_callback import WorkflowCallback
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeType

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

    def on_workflow_run_started(self) -> None:
        """
        Workflow run started
        """
        self.print_text("\n[on_workflow_run_started]", color='pink')

    def on_workflow_run_succeeded(self) -> None:
        """
        Workflow run succeeded
        """
        self.print_text("\n[on_workflow_run_succeeded]", color='green')

    def on_workflow_run_failed(self, error: str) -> None:
        """
        Workflow run failed
        """
        self.print_text("\n[on_workflow_run_failed]", color='red')

    def on_workflow_node_execute_started(self, node_id: str,
                                         node_type: NodeType,
                                         node_data: BaseNodeData,
                                         node_run_index: int = 1,
                                         predecessor_node_id: Optional[str] = None) -> None:
        """
        Workflow node execute started
        """
        self.print_text("\n[on_workflow_node_execute_started]", color='yellow')
        self.print_text(f"Node ID: {node_id}", color='yellow')
        self.print_text(f"Type: {node_type.value}", color='yellow')
        self.print_text(f"Index: {node_run_index}", color='yellow')
        if predecessor_node_id:
            self.print_text(f"Predecessor Node ID: {predecessor_node_id}", color='yellow')

    def on_workflow_node_execute_succeeded(self, node_id: str,
                                           node_type: NodeType,
                                           node_data: BaseNodeData,
                                           inputs: Optional[dict] = None,
                                           process_data: Optional[dict] = None,
                                           outputs: Optional[dict] = None,
                                           execution_metadata: Optional[dict] = None) -> None:
        """
        Workflow node execute succeeded
        """
        self.print_text("\n[on_workflow_node_execute_succeeded]", color='green')
        self.print_text(f"Node ID: {node_id}", color='green')
        self.print_text(f"Type: {node_type.value}", color='green')
        self.print_text(f"Inputs: {jsonable_encoder(inputs) if inputs else ''}", color='green')
        self.print_text(f"Process Data: {jsonable_encoder(process_data) if process_data else ''}", color='green')
        self.print_text(f"Outputs: {jsonable_encoder(outputs) if outputs else ''}", color='green')
        self.print_text(f"Metadata: {jsonable_encoder(execution_metadata) if execution_metadata else ''}",
                        color='green')

    def on_workflow_node_execute_failed(self, node_id: str,
                                        node_type: NodeType,
                                        node_data: BaseNodeData,
                                        error: str,
                                        inputs: Optional[dict] = None,
                                        outputs: Optional[dict] = None,
                                        process_data: Optional[dict] = None) -> None:
        """
        Workflow node execute failed
        """
        self.print_text("\n[on_workflow_node_execute_failed]", color='red')
        self.print_text(f"Node ID: {node_id}", color='red')
        self.print_text(f"Type: {node_type.value}", color='red')
        self.print_text(f"Error: {error}", color='red')
        self.print_text(f"Inputs: {jsonable_encoder(inputs) if inputs else ''}", color='red')
        self.print_text(f"Process Data: {jsonable_encoder(process_data) if process_data else ''}", color='red')
        self.print_text(f"Outputs: {jsonable_encoder(outputs) if outputs else ''}", color='red')

    def on_node_text_chunk(self, node_id: str, text: str, metadata: Optional[dict] = None) -> None:
        """
        Publish text chunk
        """
        if not self.current_node_id or self.current_node_id != node_id:
            self.current_node_id = node_id
            self.print_text('\n[on_node_text_chunk]')
            self.print_text(f"Node ID: {node_id}")
            self.print_text(f"Metadata: {jsonable_encoder(metadata) if metadata else ''}")

        self.print_text(text, color="pink", end="")

    def on_workflow_iteration_started(self, 
                                      node_id: str,
                                      node_type: NodeType,
                                      node_run_index: int = 1,
                                      node_data: Optional[BaseNodeData] = None,
                                      inputs: dict = None,
                                      predecessor_node_id: Optional[str] = None,
                                      metadata: Optional[dict] = None) -> None:
        """
        Publish iteration started
        """
        self.print_text("\n[on_workflow_iteration_started]", color='blue')
        self.print_text(f"Node ID: {node_id}", color='blue')

    def on_workflow_iteration_next(self, node_id: str, 
                                   node_type: NodeType,
                                   index: int, 
                                   node_run_index: int,
                                   output: Optional[dict]) -> None:
        """
        Publish iteration next
        """
        self.print_text("\n[on_workflow_iteration_next]", color='blue')

    def on_workflow_iteration_completed(self, node_id: str, 
                                        node_type: NodeType,
                                        node_run_index: int,
                                        outputs: dict) -> None:
        """
        Publish iteration completed
        """
        self.print_text("\n[on_workflow_iteration_completed]", color='blue')

    def on_event(self, event: AppQueueEvent) -> None:
        """
        Publish event
        """
        self.print_text("\n[on_workflow_event]", color='blue')
        self.print_text(f"Event: {jsonable_encoder(event)}", color='blue')

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
