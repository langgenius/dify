from typing import Literal, Optional

from pydantic import BaseModel, Field

from core.workflow.nodes.base import BaseNodeData
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
    conditions: Optional[list[Condition]] = Field(default=None, deprecated=True)

    cases: Optional[list[Case]] = None
