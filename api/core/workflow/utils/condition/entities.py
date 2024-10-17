from collections.abc import Sequence
from typing import Literal

from pydantic import BaseModel, Field

SupportedComparisonOperator = Literal[
    # for string or array
    "contains",
    "not contains",
    "start with",
    "end with",
    "is",
    "is not",
    "empty",
    "not empty",
    "in",
    "not in",
    "all of",
    # for number
    "=",
    "≠",
    ">",
    "<",
    "≥",
    "≤",
    "null",
    "not null",
]


class SubCondition(BaseModel):
    key: str
    comparison_operator: SupportedComparisonOperator
    value: str | Sequence[str] | None = None


class SubVariableCondition(BaseModel):
    logical_operator: Literal["and", "or"]
    conditions: list[SubCondition] = Field(default=list)


class Condition(BaseModel):
    variable_selector: list[str]
    comparison_operator: SupportedComparisonOperator
    value: str | Sequence[str] | None = None
    sub_variable_condition: SubVariableCondition | None = None
