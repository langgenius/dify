"""Judgment condition processor for evaluation metrics.

Evaluates pass/fail judgment conditions against evaluation metric values.
Reuses the core comparison engine from the workflow condition system
(core.workflow.utils.condition.processor._evaluate_condition) to ensure
consistent operator semantics across the platform.

The processor is intentionally decoupled from evaluation frameworks
(RAGAS / Customized) and runners.  It operates on plain ``dict`` mappings
and can be invoked from any context.

Typical usage::

    metrics = {"faithfulness": 0.85, "answer_relevancy": 0.6}
    variables = {"expected_output": "Hello World", "created_at": "2025-01-01T00:00:00"}
    config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(metric_name="faithfulness", comparison_operator=">",
                              value="0.8", condition_type="number"),
            JudgmentCondition(metric_name="output", comparison_operator="contains",
                              value="expected_output", value_source="variable",
                              condition_type="string"),
        ],
    )
    result = JudgmentProcessor.evaluate(metrics, config, variable_values=variables)
"""

import logging
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from core.evaluation.entities.judgment_entity import (
    JudgmentCondition,
    JudgmentConditionResult,
    JudgmentConditionType,
    JudgmentConfig,
    JudgmentResult,
    JudgmentValueSource,
)
from core.workflow.utils.condition.processor import _evaluate_condition

logger = logging.getLogger(__name__)

# Operators that do not need a comparison value (unary operators).
_UNARY_OPERATORS = frozenset({"null", "not null", "empty", "not empty"})


class JudgmentProcessor:

    @staticmethod
    def evaluate(
        metric_values: dict[str, Any],
        config: JudgmentConfig,
        variable_values: dict[str, Any] | None = None,
    ) -> JudgmentResult:
        """Evaluate all judgment conditions against the given metric values.

        Args:
            metric_values: Mapping of metric name → metric value
                (e.g. ``{"faithfulness": 0.85, "status": "success"}``).
            config: The judgment configuration with logical_operator and conditions.
            variable_values: Optional mapping of variable name → value, used when
                a condition's ``value_source`` is ``"variable"``.  Typically built
                from the evaluation target's inputs / outputs.

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
                metric_values, condition, variable_values
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

        # All conditions evaluated
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
        variable_values: dict[str, Any] | None = None,
    ) -> JudgmentConditionResult:
        """Evaluate a single judgment condition.

        Steps:
          1. Look up the metric value (left side) by ``metric_name``.
          2. Resolve the comparison value (right side) — either a constant
             or a variable reference.
          3. Dispatch to the correct type handler (string / number / datetime).
        """
        metric_name = condition.metric_name
        actual_value = metric_values.get(metric_name)

        # Handle metric not found — skip for unary operators that work on None
        if actual_value is None and condition.comparison_operator not in _UNARY_OPERATORS:
            return JudgmentConditionResult(
                metric_name=metric_name,
                comparison_operator=condition.comparison_operator,
                expected_value=condition.value,
                actual_value=None,
                passed=False,
                error=f"Metric '{metric_name}' not found in evaluation results",
            )

        # Resolve the comparison value (right side)
        try:
            resolved_value = JudgmentProcessor._resolve_comparison_value(
                condition, variable_values
            )
        except ValueError as e:
            return JudgmentConditionResult(
                metric_name=metric_name,
                comparison_operator=condition.comparison_operator,
                expected_value=condition.value,
                actual_value=actual_value,
                passed=False,
                error=str(e),
            )

        # Dispatch to the appropriate type handler
        try:
            match condition.condition_type:
                case JudgmentConditionType.DATETIME:
                    passed = _evaluate_datetime_condition(
                        actual_value, condition.comparison_operator, resolved_value
                    )
                case JudgmentConditionType.NUMBER:
                    passed = _evaluate_number_condition(
                        actual_value, condition.comparison_operator, resolved_value
                    )
                case _:  # STRING (default) — delegate to workflow engine
                    passed = _evaluate_condition(
                        operator=condition.comparison_operator,
                        value=actual_value,
                        expected=resolved_value,
                    )

            return JudgmentConditionResult(
                metric_name=metric_name,
                comparison_operator=condition.comparison_operator,
                expected_value=resolved_value,
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
                expected_value=resolved_value,
                actual_value=actual_value,
                passed=False,
                error=str(e),
            )

    @staticmethod
    def _resolve_comparison_value(
        condition: JudgmentCondition,
        variable_values: dict[str, Any] | None,
    ) -> str | Sequence[str] | None:
        """Resolve the right-side comparison value.

        For ``value_source == "constant"``, returns ``condition.value`` as-is.
        For ``value_source == "variable"``, looks up ``condition.value`` (as a key)
        in ``variable_values`` and returns the resolved value (converted to string
        for compatibility with the comparison engine).

        Raises:
            ValueError: If the variable cannot be resolved.
        """
        if condition.value_source == JudgmentValueSource.CONSTANT:
            return condition.value

        # Variable resolution
        if condition.value is None:
            raise ValueError("Variable name (value) must be provided when value_source is 'variable'")

        if not variable_values:
            raise ValueError(
                f"Cannot resolve variable '{condition.value}': no variable values provided"
            )

        var_key = condition.value if isinstance(condition.value, str) else str(condition.value)
        if var_key not in variable_values:
            raise ValueError(
                f"Variable '{var_key}' not found in evaluation target data. "
                f"Available variables: {list(variable_values.keys())}"
            )

        resolved = variable_values[var_key]
        # Convert to string for the comparison engine, unless it's already
        # a str/Sequence[str]/None which the engine expects.
        if resolved is None:
            return None
        if isinstance(resolved, str):
            return resolved
        if isinstance(resolved, Sequence) and all(isinstance(v, str) for v in resolved):
            return resolved
        return str(resolved)


_DATETIME_FORMATS = [
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%dT%H:%M:%S.%fZ",
    "%Y-%m-%dT%H:%M:%S%z",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
]


def _parse_datetime(value: object) -> datetime:
    """Parse a value into a datetime object.

    Accepts datetime instances, numeric timestamps (int/float), and common
    ISO 8601 string formats.

    Raises:
        ValueError: If the value cannot be parsed as a datetime.
    """
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value)
    if not isinstance(value, str):
        raise ValueError(f"Cannot parse '{value}' (type={type(value).__name__}) as datetime")

    for fmt in _DATETIME_FORMATS:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue

    raise ValueError(
        f"Cannot parse datetime string '{value}'. "
        f"Supported formats: ISO 8601, 'YYYY-MM-DD HH:MM:SS', 'YYYY-MM-DD', or numeric timestamp."
    )


def _evaluate_datetime_condition(
    actual: object,
    operator: str,
    expected: object,
) -> bool:
    """Evaluate a datetime comparison condition.

    Also supports the universal unary operators (null, not null, empty, not empty)
    and the numeric-style operators (=, ≠, >, <, ≥, ≤) for datetime values.

    Args:
        actual: The actual metric value (left side).
        operator: The comparison operator.
        expected: The expected/threshold value (right side).

    Returns:
        True if the condition passes.

    Raises:
        ValueError: If values cannot be parsed or operator is unsupported.
    """
    # Handle unary operators first
    if operator == "null":
        return actual is None
    if operator == "not null":
        return actual is not None
    if operator == "empty":
        return not actual
    if operator == "not empty":
        return bool(actual)

    if actual is None:
        return False

    actual_dt = _parse_datetime(actual)
    expected_dt = _parse_datetime(expected) if expected is not None else None

    if expected_dt is None:
        raise ValueError(f"Expected datetime value is required for operator '{operator}'")

    match operator:
        case "before" | "<":
            return actual_dt < expected_dt
        case "after" | ">":
            return actual_dt > expected_dt
        case "=" | "is":
            return actual_dt == expected_dt
        case "≠" | "is not":
            return actual_dt != expected_dt
        case "≥":
            return actual_dt >= expected_dt
        case "≤":
            return actual_dt <= expected_dt
        case _:
            raise ValueError(f"Unsupported datetime operator: '{operator}'")


def _evaluate_number_condition(
    actual: object,
    operator: str,
    expected: object,
) -> bool:
    """Evaluate a numeric comparison condition.

    Ensures proper numeric type coercion before delegating to the workflow
    condition engine.  This avoids string-vs-number comparison pitfalls
    (e.g. comparing float metric 0.85 against string threshold "0.8").

    For unary operators (null, not null, empty, not empty), delegates directly.
    """
    # Unary operators — delegate to workflow engine as-is
    if operator in _UNARY_OPERATORS:
        return _evaluate_condition(operator=operator, value=actual, expected=expected)

    if actual is None:
        return False

    # Coerce actual to numeric
    if not isinstance(actual, (int, float)):
        try:
            actual = float(actual)
        except (TypeError, ValueError) as e:
            raise ValueError(f"Cannot convert actual value '{actual}' to number") from e

    # Coerce expected to numeric string for the workflow engine
    # (the workflow engine's _normalize_numeric_values handles str → float)
    if expected is not None and not isinstance(expected, str):
        expected = str(expected)

    return _evaluate_condition(operator=operator, value=actual, expected=expected)
