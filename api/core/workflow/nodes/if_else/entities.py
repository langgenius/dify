from typing import Literal, Optional

from pydantic import BaseModel

from core.workflow.entities.base_node_data_entities import BaseNodeData


class IfElseNodeData(BaseNodeData):
    """
    Answer Node Data.
    """
    class Condition(BaseModel):
        """
        Condition entity
        """
        variable_selector: list[str]
        comparison_operator: Literal[
            # for string or array
            "contains", "not contains", "start with", "end with", "is", "is not", "empty", "not empty",
            # for number
            "=", "≠", ">", "<", "≥", "≤", "null", "not null"
        ]
        value: Optional[str] = None

    logical_operator: Literal["and", "or"] = "and"
    conditions: list[Condition]
