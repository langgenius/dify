from typing import Optional

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
    outputs: list[dict] = None

    def get_last_output(self) -> Optional[dict]:
        """
        Get last output.
        """
        if self.outputs:
            return self.outputs[-1]
        return None