from typing import Literal, Optional

from pydantic import BaseModel

from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.utils.condition.entities import Condition


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
