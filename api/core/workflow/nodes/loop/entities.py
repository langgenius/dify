from pydantic import BaseModel

from core.workflow.entities.base_node_data_entities import BaseIterationNodeData


class LoopNodeData(BaseIterationNodeData):
    """
    Loop Node Data.
    """

class LoopState(BaseModel):
    """
    Loop State.
    """