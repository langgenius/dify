from typing import Literal

from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.utils.condition.entities import Condition


class IfElseNodeData(BaseNodeData):
    """
    Answer Node Data.
    """
    logical_operator: Literal["and", "or"] = "and"
    conditions: list[Condition]
