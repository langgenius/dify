"""Judgment condition entities for evaluation metric assessment.

Key concepts:
  - **condition_type**: Determines operator semantics and type coercion.
    - "string": string operators (contains, is, start with, …).
    - "number": numeric operators (>, <, =, ≠, ≥, ≤).
    - "datetime": temporal operators (before, after).

Typical usage:
    judgment_config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(
                metric_name="faithfulness",
                comparison_operator=">",
                condition_value="0.8",
                condition_type="number",
            )
        ],
    )
"""

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class JudgmentConditionType(StrEnum):
    """Category of the condition, controls operator semantics and type coercion."""

    STRING = "string"
    NUMBER = "number"
    DATETIME = "datetime"


# Supported comparison operators for judgment conditions.
JudgmentComparisonOperator = Literal[
    # string
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
    # number
    "=",
    "≠",
    ">",
    "<",
    "≥",
    "≤",
    # datetime
    "before",
    "after",
    # universal
    "null",
    "not null",
]


class JudgmentCondition(BaseModel):
    """A single judgment condition that checks one metric value.

    Attributes:
        metric_name: The name of the evaluation metric to check (left side).
            Must match an EvaluationMetric.name in the results.
        comparison_operator: The comparison operator to apply.
        condition_value: The comparison target (right side). For unary operators
            such as ``empty`` or ``null`` this can be ``None``.
        condition_type: Controls type coercion and which operators are valid.
            "string" (default), "number", or "datetime".
    """

    metric_name: str
    comparison_operator: JudgmentComparisonOperator
    condition_value: Any | None = None
    condition_type: JudgmentConditionType = JudgmentConditionType.STRING


class JudgmentConfig(BaseModel):
    """A group of judgment conditions combined with a logical operator.

    Attributes:
        logical_operator: How to combine condition results — "and" requires
            all conditions to pass, "or" requires at least one.
        conditions: The list of individual conditions to evaluate.
    """

    logical_operator: Literal["and", "or"] = "and"
    conditions: list[JudgmentCondition] = Field(default_factory=list)


class JudgmentConditionResult(BaseModel):
    """Result of evaluating a single judgment condition.

    Attributes:
        metric_name: Which metric was checked.
        comparison_operator: The operator that was applied.
        expected_value: The resolved comparison value (after variable resolution).
        actual_value: The actual metric value that was evaluated.
        passed: Whether this individual condition passed.
        error: Error message if the condition evaluation failed.
    """

    metric_name: str
    comparison_operator: str
    expected_value: Any = None
    actual_value: Any = None
    passed: bool = False
    error: str | None = None


class JudgmentResult(BaseModel):
    """Overall result of evaluating all judgment conditions for one item.

    Attributes:
        passed: Whether the overall judgment passed (based on logical_operator).
        logical_operator: The logical operator used to combine conditions.
        condition_results: Detailed result for each individual condition.
    """

    passed: bool = False
    logical_operator: Literal["and", "or"] = "and"
    condition_results: list[JudgmentConditionResult] = Field(default_factory=list)
