import json
from collections.abc import Mapping, Sequence
from typing import Literal, NamedTuple

from core.file import FileAttribute, file_manager
from core.variables import ArrayFileSegment
from core.variables.segments import ArrayBooleanSegment, BooleanSegment
from core.workflow.runtime import VariablePool

from .entities import Condition, SubCondition, SupportedComparisonOperator


def _convert_to_bool(value: object) -> bool:
    if isinstance(value, int):
        return bool(value)

    if isinstance(value, str):
        loaded = json.loads(value)
        if isinstance(loaded, (int, bool)):
            return bool(loaded)

    raise TypeError(f"unexpected value: type={type(value)}, value={value}")


class ConditionCheckResult(NamedTuple):
    inputs: Sequence[Mapping[str, object]]
    group_results: Sequence[bool]
    final_result: bool


class ConditionProcessor:
    def process_conditions(
        self,
        *,
        variable_pool: VariablePool,
        conditions: Sequence[Condition],
        operator: Literal["and", "or"],
    ) -> ConditionCheckResult:
        input_conditions: list[Mapping[str, object]] = []
        group_results: list[bool] = []

        for condition in conditions:
            variable = variable_pool.get(condition.variable_selector)
            if variable is None:
                raise ValueError(f"Variable {condition.variable_selector} not found")

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
            elif condition.comparison_operator in {
                "exists",
                "not exists",
            }:
                result = _evaluate_condition(
                    value=variable.value,
                    operator=condition.comparison_operator,
                    expected=None,
                )
            else:
                actual_value = variable.value if variable else None
                expected_value: str | Sequence[str] | bool | list[bool] | None = condition.value
                if isinstance(expected_value, str):
                    expected_value = variable_pool.convert_template(expected_value).text
                # Here we need to explicit convet the input string to boolean.
                if isinstance(variable, (BooleanSegment, ArrayBooleanSegment)) and expected_value is not None:
                    # The following two lines is for compatibility with existing workflows.
                    if isinstance(expected_value, list):
                        expected_value = [_convert_to_bool(i) for i in expected_value]
                    else:
                        expected_value = _convert_to_bool(expected_value)
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
            # Implemented short-circuit evaluation for logical conditions
            if (operator == "and" and not result) or (operator == "or" and result):
                final_result = result
                return ConditionCheckResult(input_conditions, group_results, final_result)

        final_result = all(group_results) if operator == "and" else any(group_results)
        return ConditionCheckResult(input_conditions, group_results, final_result)


def _evaluate_condition(
    *,
    operator: SupportedComparisonOperator,
    value: object,
    expected: str | Sequence[str] | bool | Sequence[bool] | None,
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
            # Type narrowing: at this point expected is a list, could be list[str] or list[bool]
            if all(isinstance(item, str) for item in expected):
                # Create a new typed list to satisfy type checker
                str_list: list[str] = [item for item in expected if isinstance(item, str)]
                return _assert_all_of(value=value, expected=str_list)
            elif all(isinstance(item, bool) for item in expected):
                # Create a new typed list to satisfy type checker
                bool_list: list[bool] = [item for item in expected if isinstance(item, bool)]
                return _assert_all_of_bool(value=value, expected=bool_list)
            else:
                raise ValueError("all of operator expects homogeneous list of strings or booleans")
        case "exists":
            return _assert_exists(value=value)
        case "not exists":
            return _assert_not_exists(value=value)
        case _:
            raise ValueError(f"Unsupported operator: {operator}")


def _assert_contains(*, value: object, expected: object) -> bool:
    if not value:
        return False

    if not isinstance(value, (str, list)):
        raise ValueError("Invalid actual value type: string or array")

    # Type checking ensures value is str or list at this point
    if isinstance(value, str):
        if not isinstance(expected, str):
            expected = str(expected)
        if expected not in value:
            return False
    else:  # value is list
        if expected not in value:
            return False
    return True


def _assert_not_contains(*, value: object, expected: object) -> bool:
    if not value:
        return True

    if not isinstance(value, (str, list)):
        raise ValueError("Invalid actual value type: string or array")

    # Type checking ensures value is str or list at this point
    if isinstance(value, str):
        if not isinstance(expected, str):
            expected = str(expected)
        if expected in value:
            return False
    else:  # value is list
        if expected in value:
            return False
    return True


def _assert_start_with(*, value: object, expected: object) -> bool:
    if not value:
        return False

    if not isinstance(value, str):
        raise ValueError("Invalid actual value type: string")

    if not isinstance(expected, str):
        raise ValueError("Expected value must be a string for startswith")
    if not value.startswith(expected):
        return False
    return True


def _assert_end_with(*, value: object, expected: object) -> bool:
    if not value:
        return False

    if not isinstance(value, str):
        raise ValueError("Invalid actual value type: string")

    if not isinstance(expected, str):
        raise ValueError("Expected value must be a string for endswith")
    if not value.endswith(expected):
        return False
    return True


def _assert_is(*, value: object, expected: object) -> bool:
    if value is None:
        return False

    if not isinstance(value, (str, bool)):
        raise ValueError("Invalid actual value type: string or boolean")

    if value != expected:
        return False
    return True


def _assert_is_not(*, value: object, expected: object) -> bool:
    if value is None:
        return False

    if not isinstance(value, (str, bool)):
        raise ValueError("Invalid actual value type: string or boolean")

    if value == expected:
        return False
    return True


def _assert_empty(*, value: object) -> bool:
    if not value:
        return True
    return False


def _assert_not_empty(*, value: object) -> bool:
    if value:
        return True
    return False


def _assert_equal(*, value: object, expected: object) -> bool:
    if value is None:
        return False

    if not isinstance(value, (int, float, bool)):
        raise ValueError("Invalid actual value type: number or boolean")

    # Handle boolean comparison
    if isinstance(value, bool):
        if not isinstance(expected, (bool, int, str)):
            raise ValueError(f"Cannot convert {type(expected)} to bool")
        expected = bool(expected)
    elif isinstance(value, int):
        if not isinstance(expected, (int, float, str)):
            raise ValueError(f"Cannot convert {type(expected)} to int")
        expected = int(expected)
    else:
        if not isinstance(expected, (int, float, str)):
            raise ValueError(f"Cannot convert {type(expected)} to float")
        expected = float(expected)

    if value != expected:
        return False
    return True


def _assert_not_equal(*, value: object, expected: object) -> bool:
    if value is None:
        return False

    if not isinstance(value, (int, float, bool)):
        raise ValueError("Invalid actual value type: number or boolean")

    # Handle boolean comparison
    if isinstance(value, bool):
        if not isinstance(expected, (bool, int, str)):
            raise ValueError(f"Cannot convert {type(expected)} to bool")
        expected = bool(expected)
    elif isinstance(value, int):
        if not isinstance(expected, (int, float, str)):
            raise ValueError(f"Cannot convert {type(expected)} to int")
        expected = int(expected)
    else:
        if not isinstance(expected, (int, float, str)):
            raise ValueError(f"Cannot convert {type(expected)} to float")
        expected = float(expected)

    if value == expected:
        return False
    return True


def _assert_greater_than(*, value: object, expected: object) -> bool:
    if value is None:
        return False

    if not isinstance(value, (int, float)):
        raise ValueError("Invalid actual value type: number")

    if isinstance(value, int):
        if not isinstance(expected, (int, float, str)):
            raise ValueError(f"Cannot convert {type(expected)} to int")
        expected = int(expected)
    else:
        if not isinstance(expected, (int, float, str)):
            raise ValueError(f"Cannot convert {type(expected)} to float")
        expected = float(expected)

    if value <= expected:
        return False
    return True


def _assert_less_than(*, value: object, expected: object) -> bool:
    if value is None:
        return False

    if not isinstance(value, (int, float)):
        raise ValueError("Invalid actual value type: number")

    if isinstance(value, int):
        if not isinstance(expected, (int, float, str)):
            raise ValueError(f"Cannot convert {type(expected)} to int")
        expected = int(expected)
    else:
        if not isinstance(expected, (int, float, str)):
            raise ValueError(f"Cannot convert {type(expected)} to float")
        expected = float(expected)

    if value >= expected:
        return False
    return True


def _assert_greater_than_or_equal(*, value: object, expected: object) -> bool:
    if value is None:
        return False

    if not isinstance(value, (int, float)):
        raise ValueError("Invalid actual value type: number")

    if isinstance(value, int):
        if not isinstance(expected, (int, float, str)):
            raise ValueError(f"Cannot convert {type(expected)} to int")
        expected = int(expected)
    else:
        if not isinstance(expected, (int, float, str)):
            raise ValueError(f"Cannot convert {type(expected)} to float")
        expected = float(expected)

    if value < expected:
        return False
    return True


def _assert_less_than_or_equal(*, value: object, expected: object) -> bool:
    if value is None:
        return False

    if not isinstance(value, (int, float)):
        raise ValueError("Invalid actual value type: number")

    if isinstance(value, int):
        if not isinstance(expected, (int, float, str)):
            raise ValueError(f"Cannot convert {type(expected)} to int")
        expected = int(expected)
    else:
        if not isinstance(expected, (int, float, str)):
            raise ValueError(f"Cannot convert {type(expected)} to float")
        expected = float(expected)

    if value > expected:
        return False
    return True


def _assert_null(*, value: object) -> bool:
    if value is None:
        return True
    return False


def _assert_not_null(*, value: object) -> bool:
    if value is not None:
        return True
    return False


def _assert_in(*, value: object, expected: object) -> bool:
    if not value:
        return False

    if not isinstance(expected, list):
        raise ValueError("Invalid expected value type: array")

    if value not in expected:
        return False
    return True


def _assert_not_in(*, value: object, expected: object) -> bool:
    if not value:
        return True

    if not isinstance(expected, list):
        raise ValueError("Invalid expected value type: array")

    if value in expected:
        return False
    return True


def _assert_all_of(*, value: object, expected: Sequence[str]) -> bool:
    if not value:
        return False

    # Ensure value is a container that supports 'in' operator
    if not isinstance(value, (list, tuple, set, str)):
        return False

    return all(item in value for item in expected)


def _assert_all_of_bool(*, value: object, expected: Sequence[bool]) -> bool:
    if not value:
        return False

    # Ensure value is a container that supports 'in' operator
    if not isinstance(value, (list, tuple, set)):
        return False

    return all(item in value for item in expected)


def _assert_exists(*, value: object) -> bool:
    return value is not None


def _assert_not_exists(*, value: object) -> bool:
    return value is None


def _process_sub_conditions(
    variable: ArrayFileSegment,
    sub_conditions: Sequence[SubCondition],
    operator: Literal["and", "or"],
) -> bool:
    files = variable.value
    group_results: list[bool] = []
    for condition in sub_conditions:
        key = FileAttribute(condition.key)
        values = [file_manager.get_attr(file=file, attr=key) for file in files]
        expected_value = condition.value
        if key == FileAttribute.EXTENSION:
            if not isinstance(expected_value, str):
                raise TypeError("Expected value must be a string when key is FileAttribute.EXTENSION")
            if expected_value and not expected_value.startswith("."):
                expected_value = "." + expected_value

            normalized_values: list[object] = []
            for value in values:
                if value and isinstance(value, str):
                    if not value.startswith("."):
                        value = "." + value
                normalized_values.append(value)
            values = normalized_values
        sub_group_results: list[bool] = [
            _evaluate_condition(
                value=value,
                operator=condition.comparison_operator,
                expected=expected_value,
            )
            for value in values
        ]
        # Determine the result based on the presence of "not" in the comparison operator
        result = all(sub_group_results) if "not" in condition.comparison_operator else any(sub_group_results)
        group_results.append(result)
    return all(group_results) if operator == "and" else any(group_results)
