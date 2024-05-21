from typing import Any, Optional

from core.workflow.entities.base_node_data_entities import BaseIterationNodeData, BaseIterationState


class IterationNodeData(BaseIterationNodeData):
    """
    Iteration Node Data.
    """
    parent_loop_id: Optional[str] # redundant field, not used currently
    iterator_selector: list[str] # variable selector
    output_selector: list[str] # output selector

class IterationState(BaseIterationState):
    """
    Iteration State.
    """
    outputs: list[Any] = None
    current_output: Optional[Any] = None

    class MetaData(BaseIterationState.MetaData):
        """
        Data.
        """
        iterator_length: int

    def get_last_output(self) -> Optional[Any]:
        """
        Get last output.
        """
        if self.outputs:
            return self.outputs[-1]
        return None
    
    def get_current_output(self) -> Optional[Any]:
        """
        Get current output.
        """
        return self.current_output