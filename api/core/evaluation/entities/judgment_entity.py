"""Judgment condition entities for evaluation metric assessment.

Typical usage:
    judgment_config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(metric_name="faithfulness", comparison_operator=">", value="0.8"),
            JudgmentCondition(metric_name="answer_relevancy", comparison_operator="≥", value="0.7"),
        ],
    )
"""

from collections.abc import Sequence
from typing import Any, Literal

from pydantic import BaseModel, Field

from core.workflow.utils.condition.entities import SupportedComparisonOperator


class JudgmentCondition(BaseModel):
    """A single judgment condition that checks one metric value.

    Attributes:
        metric_name: The name of the evaluation metric to check
            (must match an EvaluationMetric.name in the results).
        comparison_operator: The comparison operator to apply
            (reuses the same operator set as workflow condition branches).
        value: The expected/threshold value to compare against.
            For numeric operators (>, <, =, etc.), this should be a numeric string.
            For string operators (contains, is, etc.), this should be a string.
            For unary operators (empty, null, etc.), this can be None.
    """

    metric_name: str
    comparison_operator: SupportedComparisonOperator
    value: str | Sequence[str] | None = None


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
        expected_value: The threshold/expected value from the condition config.
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
