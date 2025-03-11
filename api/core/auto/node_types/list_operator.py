from enum import Enum
from typing import Optional, Union

from pydantic import BaseModel

from .common import BlockEnum, CommonNodeType, ValueSelector, VarType

# Import ComparisonOperator from if_else.py
from .if_else import ComparisonOperator


class OrderBy(str, Enum):
    ASC = "asc"
    DESC = "desc"


class Limit(BaseModel):
    enabled: bool
    size: Optional[int] = None


class Condition(BaseModel):
    key: str
    comparison_operator: ComparisonOperator
    value: Union[str, int, list[str]]


class FilterBy(BaseModel):
    enabled: bool
    conditions: list[Condition]


class ExtractBy(BaseModel):
    enabled: bool
    serial: Optional[str] = None


class OrderByConfig(BaseModel):
    enabled: bool
    key: Union[ValueSelector, str]
    value: OrderBy


class ListFilterNodeType(CommonNodeType):
    """List filter/operator node type implementation."""

    variable: ValueSelector
    var_type: VarType
    item_var_type: VarType
    filter_by: FilterBy
    extract_by: ExtractBy
    order_by: OrderByConfig
    limit: Limit


# 示例用法
if __name__ == "__main__":
    example_node = ListFilterNodeType(
        title="Example List Filter Node",
        desc="A list filter node example",
        type=BlockEnum.list_operator,  # Fixed: use list_operator instead of list_filter
        variable=ValueSelector(value=["varNode", "value"]),
        var_type=VarType.string,
        item_var_type=VarType.number,
        filter_by=FilterBy(
            enabled=True,
            conditions=[Condition(key="status", comparison_operator=ComparisonOperator.equals, value="active")],
        ),
        extract_by=ExtractBy(enabled=True, serial="serial_1"),
        order_by=OrderByConfig(enabled=True, key="created_at", value=OrderBy.DESC),
        limit=Limit(enabled=True, size=100),
    )
    print(example_node)
