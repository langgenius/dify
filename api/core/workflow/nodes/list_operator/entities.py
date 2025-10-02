from collections.abc import Sequence
from enum import StrEnum

from pydantic import BaseModel, Field

from core.workflow.nodes.base import BaseNodeData


class FilterOperator(StrEnum):
    # string conditions
    CONTAINS = "contains"
    START_WITH = "start with"
    END_WITH = "end with"
    IS = "is"
    IN = "in"
    EMPTY = "empty"
    NOT_CONTAINS = "not contains"
    IS_NOT = "is not"
    NOT_IN = "not in"
    NOT_EMPTY = "not empty"
    # number conditions
    EQUAL = "="
    NOT_EQUAL = "≠"
    LESS_THAN = "<"
    GREATER_THAN = ">"
    GREATER_THAN_OR_EQUAL = "≥"
    LESS_THAN_OR_EQUAL = "≤"


class Order(StrEnum):
    ASC = "asc"
    DESC = "desc"


class FilterCondition(BaseModel):
    key: str = ""
    comparison_operator: FilterOperator = FilterOperator.CONTAINS
    # the value is bool if the filter operator is comparing with
    # a boolean constant.
    value: str | Sequence[str] | bool = ""


class FilterBy(BaseModel):
    enabled: bool = False
    conditions: Sequence[FilterCondition] = Field(default_factory=list)


class OrderByConfig(BaseModel):
    enabled: bool = False
    key: str = ""
    value: Order = Order.ASC


class Limit(BaseModel):
    enabled: bool = False
    size: int = -1


class ExtractConfig(BaseModel):
    enabled: bool = False
    serial: str = "1"


class ListOperatorNodeData(BaseNodeData):
    variable: Sequence[str] = Field(default_factory=list)
    filter_by: FilterBy
    order_by: OrderByConfig
    limit: Limit
    extract_by: ExtractConfig = Field(default_factory=ExtractConfig)
