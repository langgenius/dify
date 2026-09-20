"""Judgment condition entities for evaluation metric assessment.

Condition structure mirrors the workflow if-else ``Condition`` model from
``graphon.utils.condition.entities``.  The left-hand side uses
``variable_selector`` — a two-element list ``[node_id, metric_name]`` — to
uniquely identify an evaluation metric (different nodes may produce metrics
with the same name).

Operators reuse ``SupportedComparisonOperator`` from the workflow engine so
that type semantics stay consistent across the platform.

Typical usage::

    judgment_config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(
                variable_selector=["node_abc", "faithfulness"],
                comparison_operator=">",
                value="0.8",
            )
        ],
    )
"""

from collections.abc import Sequence
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from graphon.utils.condition.entities import SupportedComparisonOperator

COMPARISON_OPERATOR_ALIASES: dict[str, str] = {
    "==": "=",
    "!=": "≠",
    ">=": "≥",
    "<=": "≤",
    "is null": "null",
    "is not null": "not null",
}


class JudgmentCondition(BaseModel):
    """A single judgment condition that checks one metric value.

    Mirrors ``graphon.utils.condition.entities.Condition`` with the left-hand
    side being a metric selector instead of a workflow variable selector.

    Attributes:
        variable_selector: ``[node_id, metric_name]`` identifying the metric.
        comparison_operator: Reuses workflow's ``SupportedComparisonOperator``.
        value: The comparison target (right side).  For unary operators such
            as ``empty`` or ``null`` this can be ``None``.
    """

    variable_selector: list[str]
    comparison_operator: SupportedComparisonOperator
    value: str | Sequence[str] | bool | None = None

    @field_validator("comparison_operator", mode="before")
    @classmethod
    def normalize_comparison_operator(cls, value: Any) -> Any:
        """Accept common ASCII/API aliases for workflow comparison operators."""
        if not isinstance(value, str):
            return value

        normalized_value = value.strip().lower()
        alias = COMPARISON_OPERATOR_ALIASES.get(normalized_value)
        if alias is not None:
            return alias
        return value.strip()


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
        variable_selector: ``[node_id, metric_name]`` that was checked.
        comparison_operator: The operator that was applied.
        expected_value: The resolved comparison value.
        actual_value: The actual metric value that was evaluated.
        passed: Whether this individual condition passed.
        error: Error message if the condition evaluation failed.
    """

    variable_selector: list[str]
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
