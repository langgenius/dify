from collections.abc import Sequence
from typing import Annotated, Literal

from pydantic import BaseModel, Field, WithJsonSchema

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
ConditionValue = Annotated[
    str | Sequence[str] | None | int | float,
    WithJsonSchema(
        {
            "anyOf": [
                {"type": "string"},
                {"items": {"type": "string"}, "type": "array"},
                {"type": "number"},
                {"type": "null"},
            ]
        }
    ),
]


class Condition(BaseModel):
    """
    Condition detail
    """

    name: str = Field(description="Metadata field name to compare against.")
    comparison_operator: SupportedComparisonOperator = Field(
        description=(
            "Comparison to apply. String operators (`contains`, `not contains`, `start with`, `end with`, `is`, "
            "`is not`, `empty`, `not empty`, `in`, `not in`) act on string or array metadata; numeric operators "
            "(`=`, `≠`, `>`, `<`, `≥`, `≤`) act on numeric metadata; time operators (`before`, `after`) act on "
            "time metadata."
        )
    )
    value: ConditionValue = Field(
        default=None,
        description=(
            "Value to compare against. Type depends on `comparison_operator`: string for most string operators, "
            "array of strings for `in` and `not in`, number for numeric operators, and omit or use `null` for "
            "`empty` and `not empty`."
        ),
    )


class MetadataFilteringCondition(BaseModel):
    """
    Metadata Filtering Condition.
    """

    logical_operator: Literal["and", "or"] | None = Field(
        default="and",
        description="How to combine multiple conditions.",
    )
    conditions: list[Condition] | None = Field(
        default=None,
        deprecated=True,
        description="List of metadata conditions to evaluate.",
    )
