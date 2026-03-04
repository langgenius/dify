"""Judgment condition processor for evaluation metrics.

Evaluates pass/fail judgment conditions against evaluation metric values.
Reuses the core comparison engine from the workflow condition system
(core.workflow.utils.condition.processor._evaluate_condition) to ensure
consistent operator semantics across the platform.

"""

import logging
from typing import Any

from core.evaluation.entities.judgment_entity import (
    JudgmentCondition,
    JudgmentConditionResult,
    JudgmentConfig,
    JudgmentResult,
)
from core.workflow.utils.condition.processor import _evaluate_condition

logger = logging.getLogger(__name__)


class JudgmentProcessor:

    @staticmethod
    def evaluate(
        metric_values: dict[str, Any],
        config: JudgmentConfig,
    ) -> JudgmentResult:
        """Evaluate all judgment conditions against the given metric values.

        Args:
            metric_values: Mapping of metric name to its value
                (e.g. {"faithfulness": 0.85, "status": "success"}).
            config: The judgment configuration with logical_operator and conditions.

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
            result = JudgmentProcessor._evaluate_single_condition(
                metric_values, condition
            )
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
        metric_values: dict[str, Any],
        condition: JudgmentCondition,
    ) -> JudgmentConditionResult:
        """Evaluate a single judgment condition against the metric values.

        Looks up the metric by name, then delegates to the workflow condition
        engine for the actual comparison.

        Args:
            metric_values: Mapping of metric name to its value.
            condition: The condition to evaluate.

        Returns:
            JudgmentConditionResult with pass/fail and details.
        """
        metric_name = condition.metric_name
        actual_value = metric_values.get(metric_name)

        # Handle metric not found
        if actual_value is None and condition.comparison_operator not in (
            "null",
            "not null",
            "empty",
            "not empty",
            "exists",
            "not exists",
        ):
            return JudgmentConditionResult(
                metric_name=metric_name,
                comparison_operator=condition.comparison_operator,
                expected_value=condition.value,
                actual_value=None,
                passed=False,
                error=f"Metric '{metric_name}' not found in evaluation results",
            )

        try:
            passed = _evaluate_condition(
                operator=condition.comparison_operator,
                value=actual_value,
                expected=condition.value,
            )
            return JudgmentConditionResult(
                metric_name=metric_name,
                comparison_operator=condition.comparison_operator,
                expected_value=condition.value,
                actual_value=actual_value,
                passed=passed,
            )
        except Exception as e:
            logger.warning(
                "Judgment condition evaluation failed for metric '%s': %s",
                metric_name,
                str(e),
            )
            return JudgmentConditionResult(
                metric_name=metric_name,
                comparison_operator=condition.comparison_operator,
                expected_value=condition.value,
                actual_value=actual_value,
                passed=False,
                error=str(e),
            )
