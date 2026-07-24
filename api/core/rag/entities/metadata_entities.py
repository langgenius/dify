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
    # for number
    "=",
    "≠",
    ">",
    "<",
    "≥",
    "≤",
    # for time
    "before",
    "after",
]


class Condition(BaseModel):
    """
    Condition detail
    """

    name: str
    comparison_operator: SupportedComparisonOperator
    value: str | Sequence[str] | None | int | float = None


class MetadataCondition(BaseModel):
    """
    Metadata Condition.
    """

    logical_operator: Literal["and", "or"] | None = "and"
    conditions: list[Condition] | None = Field(default=None, deprecated=True)
