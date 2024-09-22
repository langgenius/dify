from collections.abc import Sequence
from typing import Literal

from pydantic import Field

from core.workflow.entities.base_node_data_entities import BaseNodeData

_Condition = Literal[
    # string conditions
    "contains",
    "startswith",
    "endswith",
    "is",
    "in",
    "empty",
    "not contains",
    "not is",
    "not in",
    "not empty",
    # number conditions
    "=",
    "!=",
    "<",
    ">",
    "<=",
    ">=",
]


class ListFilterNodeData(BaseNodeData):
    variable_selector: Sequence[str] = Field(default_factory=list)
    order_by: str = ""
    order: Literal["asc", "desc"] | None = None
    limit: int = -1
    key: str = ""
    condition: _Condition
    value: str
