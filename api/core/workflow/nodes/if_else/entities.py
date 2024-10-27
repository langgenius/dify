from typing import Literal, Optional

from pydantic import BaseModel

from core.workflow.entities.base_node_data_entities import BaseNodeData


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


class IfElseNodeData(BaseNodeData):
    """
    Answer Node Data.
    """

    class Case(BaseModel):
        """
        Case entity representing a single logical condition group
        """
        case_id: str
        logical_operator: Literal["and", "or"]
        conditions: list[Condition]

    logical_operator: Optional[Literal["and", "or"]] = "and"
    conditions: Optional[list[Condition]] = None

    cases: Optional[list[Case]] = None
