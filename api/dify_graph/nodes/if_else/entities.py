from typing import Literal

from pydantic import BaseModel, Field

from dify_graph.entities.base_node_data import BaseNodeData
from dify_graph.enums import BuiltinNodeTypes, NodeType
from dify_graph.utils.condition.entities import Condition


class IfElseNodeData(BaseNodeData):
    """
    If Else Node Data.
    """

    type: NodeType = BuiltinNodeTypes.IF_ELSE

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
