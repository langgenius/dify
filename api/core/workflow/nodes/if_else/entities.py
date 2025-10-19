from typing import Literal

from pydantic import BaseModel, Field

from core.workflow.nodes.base import BaseNodeData
from core.workflow.utils.condition.entities import Condition


class IfElseNodeData(BaseNodeData):
    """
    If Else Node Data.
    """

    class Case(BaseModel):
        """
        Case entity representing a single logical condition group
        """

        case_id: str
        logical_operator: Literal["and", "or"]
        conditions: list[Condition]

    logical_operator: Literal["and", "or"] | None = "and"
    conditions: list[Condition] | None = Field(default=None, deprecated=True)

    cases: list[Case] | None = None
