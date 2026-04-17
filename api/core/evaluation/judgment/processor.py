"""Judgment condition processor for evaluation metrics.

Evaluates pass/fail judgment conditions against evaluation metric values.
Each condition uses ``variable_selector`` (``[node_id, metric_name]``) to
look up the metric value, then delegates the actual comparison to the
workflow condition engine (``graphon.utils.condition.processor``).

The processor is intentionally decoupled from evaluation frameworks and
runners.  It operates on plain ``dict`` mappings and can be invoked
anywhere that already has per-item metric results.
"""

import logging
from collections.abc import Sequence
from typing import Any, cast

from core.evaluation.entities.judgment_entity import (
    JudgmentCondition,
    JudgmentConditionResult,
    JudgmentConfig,
    JudgmentResult,
)
from graphon.utils.condition.entities import SupportedComparisonOperator
from graphon.utils.condition.processor import _evaluate_condition  # pyright: ignore[reportPrivateUsage]

logger = logging.getLogger(__name__)

_UNARY_OPERATORS = frozenset({"null", "not null", "empty", "not empty"})


class JudgmentProcessor:
    @staticmethod
    def evaluate(
        metric_values: dict[tuple[str, str], Any],
        config: JudgmentConfig,
    ) -> JudgmentResult:
        """Evaluate all judgment conditions against the given metric values.

        Args:
            metric_values: Mapping of ``(node_id, metric_name)`` → metric
                value (e.g. ``{("node_abc", "faithfulness"): 0.85}``).
            config: The judgment configuration with logical_operator and
                conditions.

        Returns:
            JudgmentResult with overall pass/fail and per-condition details.
        """
        if not config.conditions:
            return JudgmentResult(
                passed=True,
                logical_operator=config.logical_operator,
                condition_results=[],
            )

        condition_results: list[JudgmentConditionResult] = []

        for condition in config.conditions:
            result = JudgmentProcessor._evaluate_single_condition(metric_values, condition)
            condition_results.append(result)

            if config.logical_operator == "and" and not result.passed:
                return JudgmentResult(
                    passed=False,
                    logical_operator=config.logical_operator,
                    condition_results=condition_results,
                )
            if config.logical_operator == "or" and result.passed:
                return JudgmentResult(
                    passed=True,
                    logical_operator=config.logical_operator,
                    condition_results=condition_results,
                )

        if config.logical_operator == "and":
            final_passed = all(r.passed for r in condition_results)
        else:
            final_passed = any(r.passed for r in condition_results)

        return JudgmentResult(
            passed=final_passed,
            logical_operator=config.logical_operator,
            condition_results=condition_results,
        )

    @staticmethod
    def _evaluate_single_condition(
        metric_values: dict[tuple[str, str], Any],
        condition: JudgmentCondition,
    ) -> JudgmentConditionResult:
        """Evaluate a single judgment condition.

        Steps:
          1. Extract ``(node_id, metric_name)`` from ``variable_selector``.
          2. Look up the metric value from ``metric_values``.
          3. Delegate comparison to the workflow condition engine.
        """
        selector = condition.variable_selector
        if len(selector) < 2:
            return JudgmentConditionResult(
                variable_selector=selector,
                comparison_operator=condition.comparison_operator,
                expected_value=condition.value,
                actual_value=None,
                passed=False,
                error=f"variable_selector must have at least 2 elements, got {len(selector)}",
            )

        node_id, metric_name = selector[0], selector[1]
        actual_value = metric_values.get((node_id, metric_name))

        if actual_value is None and condition.comparison_operator not in _UNARY_OPERATORS:
            return JudgmentConditionResult(
                variable_selector=selector,
                comparison_operator=condition.comparison_operator,
                expected_value=condition.value,
                actual_value=None,
                passed=False,
                error=f"Metric '{metric_name}' on node '{node_id}' not found in evaluation results",
            )

        try:
            expected = condition.value
            # Numeric operators need the actual value coerced to int/float
            # so that the workflow engine's numeric assertions work correctly.
            coerced_actual: object = actual_value
            if (
                condition.comparison_operator in {"=", "≠", ">", "<", "≥", "≤"}
                and actual_value is not None
                and not isinstance(actual_value, (int, float, bool))
            ):
                coerced_actual = float(actual_value)

            passed = _evaluate_condition(
                operator=cast(SupportedComparisonOperator, condition.comparison_operator),
                value=coerced_actual,
                expected=cast(str | Sequence[str] | bool | Sequence[bool] | None, expected),
            )

            return JudgmentConditionResult(
                variable_selector=selector,
                comparison_operator=condition.comparison_operator,
                expected_value=expected,
                actual_value=actual_value,
                passed=passed,
            )
        except Exception as e:
            logger.warning(
                "Judgment condition evaluation failed for [%s, %s]: %s",
                node_id,
                metric_name,
                str(e),
            )
            return JudgmentConditionResult(
                variable_selector=selector,
                comparison_operator=condition.comparison_operator,
                expected_value=condition.value,
                actual_value=actual_value,
                passed=False,
                error=str(e),
            )
