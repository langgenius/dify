from typing import Literal

from pydantic import BaseModel, Field

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.utils.condition.entities import Condition


class IfElseNodeData(BaseNodeData):
    """If Else Node Data."""

    type: NodeType = BuiltinNodeTypes.IF_ELSE

    class Case(BaseModel):
        """Case entity representing a single logical condition group"""

        case_id: str
        logical_operator: Literal["and", "or"]
        conditions: list[Condition]

    logical_operator: Literal["and", "or"] | None = "and"
    conditions: list[Condition] | None = Field(default=None, deprecated=True)

    cases: list[Case] | None = None

    def iter_cases(self) -> list[Case]:
        if self.cases is not None:
            return list(self.cases)
        legacy_conditions = self.__dict__.get("conditions") or []
        return [
            self.Case(
                case_id="true",
                logical_operator=self.logical_operator or "and",
                conditions=list(legacy_conditions),
            ),
        ]
