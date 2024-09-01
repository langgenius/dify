from collections.abc import Sequence
from typing import Literal

from pydantic import BaseModel, Field

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
    "≥",
    "≤",
]


class FilterBy(BaseModel):
    key: str = ""
    comparison_operator: _Condition = "contains"
    value: str | Sequence[str] = ""


class OrderBy(BaseModel):
    enabled: bool = False
    key: str = ""
    value: Literal["asc", "desc"] = "asc"


class Limit(BaseModel):
    enabled: bool = False
    size: int = -1


class ListFilterNodeData(BaseNodeData):
    variable: Sequence[str] = Field(default_factory=list)
    filter_by: Sequence[FilterBy]
    order_by: OrderBy
    limit: Limit
