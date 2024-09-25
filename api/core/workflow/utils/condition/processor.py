from collections.abc import Sequence
from typing import Any, Literal

from core.file import FileAttribute, file_manager
from core.variables.segments import ArrayFileSegment
from core.workflow.entities.variable_pool import VariablePool

from .entities import Condition, SubCondition, SupportedComparisonOperator


class ConditionProcessor:
    def process_conditions(
        self,
        *,
        variable_pool: VariablePool,
        conditions: Sequence[Condition],
        operator: Literal["and", "or"],
    ):
        input_conditions = []
        group_results = []

        for condition in conditions:
            variable = variable_pool.get(condition.variable_selector)

            if isinstance(variable, ArrayFileSegment) and condition.comparison_operator in {
                "contains",
                "not contains",
                "all of",
            }:
                # check sub conditions
                if not condition.sub_variable_condition:
                    raise ValueError("Sub variable is required")
                result = _process_sub_conditions(
                    variable=variable,
                    sub_conditions=condition.sub_variable_condition.conditions,
                    operator=condition.sub_variable_condition.logical_operator,
                )
            else:
                actual_value = variable.value if variable else None
                expected_value = condition.value
                if isinstance(expected_value, str):
                    expected_value = variable_pool.convert_template(expected_value).text
                input_conditions.append(
                    {
                        "actual_value": actual_value,
                        "expected_value": expected_value,
                        "comparison_operator": condition.comparison_operator,
                    }
                )
                result = _evaluate_condition(
                    value=actual_value,
                    operator=condition.comparison_operator,
                    expected=expected_value,
                )
            group_results.append(result)

        final_result = all(group_results) if operator == "and" else any(group_results)
        return input_conditions, group_results, final_result


def _evaluate_condition(
    *,
    operator: SupportedComparisonOperator,
    value: Any,
    expected: str | Sequence[str] | None,
) -> bool:
    match operator:
        case "contains":
            return _assert_contains(value=value, expected=expected)
        case "not contains":
            return _assert_not_contains(value=value, expected=expected)
        case "start with":
            return _assert_start_with(value=value, expected=expected)
        case "end with":
            return _assert_end_with(value=value, expected=expected)
        case "is":
            return _assert_is(value=value, expected=expected)
        case "is not":
            return _assert_is_not(value=value, expected=expected)
        case "empty":
            return _assert_empty(value=value)
        case "not empty":
            return _assert_not_empty(value=value)
        case "=":
            return _assert_equal(value=value, expected=expected)
        case "≠":
            return _assert_not_equal(value=value, expected=expected)
        case ">":
            return _assert_greater_than(value=value, expected=expected)
        case "<":
            return _assert_less_than(value=value, expected=expected)
        case "≥":
            return _assert_greater_than_or_equal(value=value, expected=expected)
        case "≤":
            return _assert_less_than_or_equal(value=value, expected=expected)
        case "null":
            return _assert_null(value=value)
        case "not null":
            return _assert_not_null(value=value)
        case "in":
            return _assert_in(value=value, expected=expected)
        case "not in":
            return _assert_not_in(value=value, expected=expected)
        case "all of" if isinstance(expected, list):
            return _assert_all_of(value=value, expected=expected)
        case _:
            raise ValueError(f"Unsupported operator: {operator}")


def _assert_contains(*, value: Any, expected: Any) -> bool:
    if not value:
        return False

    if not isinstance(value, str | list):
        raise ValueError("Invalid actual value type: string or array")

    if expected not in value:
        return False
    return True


def _assert_not_contains(*, value: Any, expected: Any) -> bool:
    if not value:
        return True

    if not isinstance(value, str | list):
        raise ValueError("Invalid actual value type: string or array")

    if expected in value:
        return False
    return True


def _assert_start_with(*, value: Any, expected: Any) -> bool:
    if not value:
        return False

    if not isinstance(value, str):
        raise ValueError("Invalid actual value type: string")

    if not value.startswith(expected):
        return False
    return True


def _assert_end_with(*, value: Any, expected: Any) -> bool:
    if not value:
        return False

    if not isinstance(value, str):
        raise ValueError("Invalid actual value type: string")

    if not value.endswith(expected):
        return False
    return True


def _assert_is(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    if not isinstance(value, str):
        raise ValueError("Invalid actual value type: string")

    if value != expected:
        return False
    return True


def _assert_is_not(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    if not isinstance(value, str):
        raise ValueError("Invalid actual value type: string")

    if value == expected:
        return False
    return True


def _assert_empty(*, value: Any) -> bool:
    if not value:
        return True
    return False


def _assert_not_empty(*, value: Any) -> bool:
    if value:
        return True
    return False


def _assert_equal(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    if not isinstance(value, int | float):
        raise ValueError("Invalid actual value type: number")

    if isinstance(value, int):
        expected = int(expected)
    else:
        expected = float(expected)

    if value != expected:
        return False
    return True


def _assert_not_equal(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    if not isinstance(value, int | float):
        raise ValueError("Invalid actual value type: number")

    if isinstance(value, int):
        expected = int(expected)
    else:
        expected = float(expected)

    if value == expected:
        return False
    return True


def _assert_greater_than(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    if not isinstance(value, int | float):
        raise ValueError("Invalid actual value type: number")

    if isinstance(value, int):
        expected = int(expected)
    else:
        expected = float(expected)

    if value <= expected:
        return False
    return True


def _assert_less_than(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    if not isinstance(value, int | float):
        raise ValueError("Invalid actual value type: number")

    if isinstance(value, int):
        expected = int(expected)
    else:
        expected = float(expected)

    if value >= expected:
        return False
    return True


def _assert_greater_than_or_equal(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    if not isinstance(value, int | float):
        raise ValueError("Invalid actual value type: number")

    if isinstance(value, int):
        expected = int(expected)
    else:
        expected = float(expected)

    if value < expected:
        return False
    return True


def _assert_less_than_or_equal(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    if not isinstance(value, int | float):
        raise ValueError("Invalid actual value type: number")

    if isinstance(value, int):
        expected = int(expected)
    else:
        expected = float(expected)

    if value > expected:
        return False
    return True


def _assert_null(*, value: Any) -> bool:
    if value is None:
        return True
    return False


def _assert_not_null(*, value: Any) -> bool:
    if value is not None:
        return True
    return False


def _assert_in(*, value: Any, expected: Any) -> bool:
    if not value:
        return False

    if not isinstance(expected, list):
        raise ValueError("Invalid expected value type: array")

    if value not in expected:
        return False
    return True


def _assert_not_in(*, value: Any, expected: Any) -> bool:
    if not value:
        return True

    if not isinstance(expected, list):
        raise ValueError("Invalid expected value type: array")

    if value in expected:
        return False
    return True


def _assert_all_of(*, value: Any, expected: Sequence[str]) -> bool:
    if not value:
        return False

    if not all(item in value for item in expected):
        return False
    return True


def _process_sub_conditions(
    variable: ArrayFileSegment,
    sub_conditions: Sequence[SubCondition],
    operator: Literal["and", "or"],
) -> bool:
    files = variable.value
    group_results = []
    for condition in sub_conditions:
        key = FileAttribute(condition.key)
        values = [file_manager.get_attr(file=file, attr=key) for file in files]
        sub_group_results = [
            _evaluate_condition(
                value=value,
                operator=condition.comparison_operator,
                expected=condition.value,
            )
            for value in values
        ]
        # Determine the result based on the presence of "not" in the comparison operator
        result = all(sub_group_results) if "not" in condition.comparison_operator else any(sub_group_results)
        group_results.append(result)
    return all(group_results) if operator == "and" else any(group_results)
