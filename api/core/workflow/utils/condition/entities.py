from typing import Literal, Optional

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
    value: Optional[str] = None


class SubVariable(BaseModel):
    logical_operator: Literal["and", "or"]
    conditions: list[SubCondition] = Field(default=list)


class Condition(BaseModel):
    variable_selector: list[str]
    comparison_operator: SupportedComparisonOperator
    value: Optional[str] = None
    sub_variable: SubVariable | None = None
