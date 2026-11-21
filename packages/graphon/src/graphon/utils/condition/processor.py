import json
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Literal, NamedTuple

from typing_extensions import TypeIs

from graphon.file import file_manager
from graphon.file.enums import FileAttribute
from graphon.runtime.runtime_state_protocol import ReadOnlyVariablePool
from graphon.variables.segments import (
    ArrayBooleanSegment,
    ArrayFileSegment,
    BooleanSegment,
)
from graphon.variables.template_resolution import convert_template

from .entities import Condition, SubCondition, SupportedComparisonOperator

_FILE_SUB_CONDITION_OPERATORS = frozenset(("contains", "not contains", "all of"))
_EXISTENCE_OPERATORS = frozenset(("exists", "not exists"))
_CONDITION_EVALUATOR_NAMES: dict[SupportedComparisonOperator, str] = {
    "contains": "_assert_contains",
    "not contains": "_assert_not_contains",
    "start with": "_assert_start_with",
    "end with": "_assert_end_with",
    "is": "_assert_is",
    "is not": "_assert_is_not",
    "empty": "_assert_empty",
    "not empty": "_assert_not_empty",
    "=": "_assert_equal",
    "≠": "_assert_not_equal",
    ">": "_assert_greater_than",
    "<": "_assert_less_than",
    "≥": "_assert_greater_than_or_equal",
    "≤": "_assert_less_than_or_equal",
    "null": "_assert_null",
    "not null": "_assert_not_null",
    "in": "_assert_in",
    "not in": "_assert_not_in",
    "all of": "_evaluate_all_of_condition",
    "exists": "_assert_exists",
    "not exists": "_assert_not_exists",
}
_UNARY_CONDITION_OPERATORS = frozenset((
    "empty",
    "not empty",
    "null",
    "not null",
    "exists",
    "not exists",
))


def _convert_to_bool(value: Any) -> bool:
    match value:
        case int():
            result = bool(value)
        case str():
            loaded = json.loads(value)
            match loaded:
                case int() | bool():
                    result = bool(loaded)
                case _:
                    msg = f"unexpected value: type={type(value)}, value={value}"
                    raise TypeError(msg)
        case _:
            msg = f"unexpected value: type={type(value)}, value={value}"
            raise TypeError(msg)
    return result


class ConditionCheckResult(NamedTuple):
    inputs: Sequence[Mapping[str, Any]]
    group_results: Sequence[bool]
    final_result: bool


class ConditionProcessor:
    def process_conditions(
        self,
        *,
        variable_pool: ReadOnlyVariablePool,
        conditions: Sequence[Condition],
        operator: Literal["and", "or"],
    ) -> ConditionCheckResult:
        input_conditions: list[Mapping[str, Any]] = []
        group_results: list[bool] = []

        for condition in conditions:
            variable = variable_pool.get(condition.variable_selector)
            if variable is None:
                msg = f"Variable {condition.variable_selector} not found"
                raise ValueError(msg)

            if (
                _is_array_file_segment(variable)
                and condition.comparison_operator in _FILE_SUB_CONDITION_OPERATORS
            ):
                # check sub conditions
                if not condition.sub_variable_condition:
                    msg = "Sub variable is required"
                    raise ValueError(msg)
                result = _process_sub_conditions(
                    variable=variable,
                    sub_conditions=condition.sub_variable_condition.conditions,
                    operator=condition.sub_variable_condition.logical_operator,
                )
            elif condition.comparison_operator in _EXISTENCE_OPERATORS:
                result = _evaluate_condition(
                    value=variable.value,
                    operator=condition.comparison_operator,
                    expected=None,
                )
            else:
                actual_value = variable.value
                expected_value = _prepare_expected_value(
                    variable=variable,
                    variable_pool=variable_pool,
                    expected_value=condition.value,
                )
                input_conditions.append({
                    "actual_value": actual_value,
                    "expected_value": expected_value,
                    "comparison_operator": condition.comparison_operator,
                })
                result = _evaluate_condition(
                    value=actual_value,
                    operator=condition.comparison_operator,
                    expected=expected_value,
                )
            group_results.append(result)
            # Implemented short-circuit evaluation for logical conditions
            if (operator == "and" and not result) or (operator == "or" and result):
                final_result = result
                return ConditionCheckResult(
                    input_conditions,
                    group_results,
                    final_result,
                )

        final_result = all(group_results) if operator == "and" else any(group_results)
        return ConditionCheckResult(input_conditions, group_results, final_result)


def _evaluate_condition(
    *,
    operator: SupportedComparisonOperator,
    value: Any,
    expected: str | Sequence[str] | bool | Sequence[bool] | None,
) -> bool:
    evaluator_name = _CONDITION_EVALUATOR_NAMES.get(operator)
    if evaluator_name is None:
        msg = f"Unsupported operator: {operator}"
        raise ValueError(msg)
    evaluator: Callable[..., bool] = globals()[evaluator_name]
    if operator in _UNARY_CONDITION_OPERATORS:
        return evaluator(value=value)
    return evaluator(value=value, expected=expected)


def _is_array_file_segment(variable: object) -> TypeIs[ArrayFileSegment]:
    return isinstance(variable, ArrayFileSegment)


def _is_string_sequence(value: object) -> TypeIs[Sequence[str]]:
    return (
        isinstance(value, Sequence)
        and not isinstance(value, str)
        and all(isinstance(item, str) for item in value)
    )


def _is_bool_sequence(value: object) -> TypeIs[Sequence[bool]]:
    return isinstance(value, Sequence) and all(isinstance(item, bool) for item in value)


def _prepare_expected_value(
    *,
    variable: Any,
    variable_pool: ReadOnlyVariablePool,
    expected_value: str | Sequence[str] | bool | Sequence[bool] | None,
) -> str | Sequence[str] | bool | list[bool] | None:
    match expected_value:
        case str():
            normalized_expected_value = convert_template(
                variable_pool,
                expected_value,
            ).text
        case _:
            normalized_expected_value = expected_value

    if normalized_expected_value is None:
        return None

    if isinstance(variable, BooleanSegment | ArrayBooleanSegment):
        if isinstance(normalized_expected_value, list):
            return [_convert_to_bool(item) for item in normalized_expected_value]
        return _convert_to_bool(normalized_expected_value)

    if normalized_expected_value is None or isinstance(
        normalized_expected_value, str | bool
    ):
        return normalized_expected_value
    if _is_string_sequence(normalized_expected_value):
        return normalized_expected_value
    if _is_bool_sequence(normalized_expected_value):
        return list(normalized_expected_value)
    msg = f"unexpected expected value: {normalized_expected_value!r}"
    raise TypeError(msg)


def _evaluate_all_of_condition(*, value: Any, expected: Any) -> bool:
    match expected:
        case list() if all(isinstance(item, str) for item in expected):
            str_list: list[str] = [item for item in expected if isinstance(item, str)]
            result = _assert_all_of(value=value, expected=str_list)
        case list() if all(isinstance(item, bool) for item in expected):
            bool_list: list[bool] = [
                item for item in expected if isinstance(item, bool)
            ]
            result = _assert_all_of_bool(value=value, expected=bool_list)
        case _:
            msg = "all of operator expects homogeneous list of strings or booleans"
            raise ValueError(msg)
    return result


def _assert_contains(*, value: Any, expected: Any) -> bool:
    if not value:
        return False

    match value:
        case str():
            match expected:
                case str():
                    normalized_expected = expected
                case _:
                    normalized_expected = str(expected)
            result = normalized_expected in value
        case list():
            result = expected in value
        case _:
            msg = "Invalid actual value type: string or array"
            raise ValueError(msg)
    return result


def _assert_not_contains(*, value: Any, expected: Any) -> bool:
    if not value:
        return True

    match value:
        case str():
            match expected:
                case str():
                    normalized_expected = expected
                case _:
                    normalized_expected = str(expected)
            result = normalized_expected not in value
        case list():
            result = expected not in value
        case _:
            msg = "Invalid actual value type: string or array"
            raise ValueError(msg)
    return result


def _assert_start_with(*, value: Any, expected: Any) -> bool:
    if not value:
        return False

    if not isinstance(value, str):
        msg = "Invalid actual value type: string"
        raise TypeError(msg)
    if not isinstance(expected, str):
        msg = "Expected value must be a string for startswith"
        raise TypeError(msg)
    return value.startswith(expected)


def _assert_end_with(*, value: Any, expected: Any) -> bool:
    if not value:
        return False

    if not isinstance(value, str):
        msg = "Invalid actual value type: string"
        raise TypeError(msg)
    if not isinstance(expected, str):
        msg = "Expected value must be a string for endswith"
        raise TypeError(msg)
    return value.endswith(expected)


def _assert_is(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    match value:
        case str() | bool():
            result = value == expected
        case _:
            msg = "Invalid actual value type: string or boolean"
            raise ValueError(msg)
    return result


def _assert_is_not(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    match value:
        case str() | bool():
            result = value != expected
        case _:
            msg = "Invalid actual value type: string or boolean"
            raise ValueError(msg)
    return result


def _assert_empty(*, value: Any) -> bool:
    return not value


def _assert_not_empty(*, value: Any) -> bool:
    return bool(value)


def _normalize_numeric_values(
    value: float,
    expected: Any,
) -> tuple[int | float, int | float]:
    """Normalize value and expected to compatible numeric types for comparison.

    Args:
        value: The actual numeric value (int or float)
        expected: The expected value (int, float, or str)

    Returns:
        A tuple of (normalized_value, normalized_expected) with compatible types

    Raises:
        ValueError: If expected cannot be converted to a number

    """
    match expected:
        case str():
            try:
                expected_float = float(expected)
            except ValueError as e:
                msg = f"Cannot convert '{expected}' to number"
                raise ValueError(msg) from e

            match value:
                case int() if expected_float.is_integer():
                    normalized_values = (value, int(expected_float))
                case int():
                    normalized_values = (float(value), expected_float)
                case _:
                    normalized_values = (value, expected_float)
        case float():
            match value:
                case int():
                    normalized_values = (float(value), expected)
                case _:
                    normalized_values = (value, expected)
        case int():
            normalized_values = (value, expected)
        case _:
            msg = f"Cannot convert {type(expected)} to number"
            raise ValueError(msg)
    return normalized_values


def _normalize_numeric_equality_expected(*, value: Any, expected: Any) -> Any:
    match value:
        case bool():
            match expected:
                case bool() | int() | str():
                    normalized_expected = bool(expected)
                case _:
                    msg = f"Cannot convert {type(expected)} to bool"
                    raise ValueError(msg)
        case int():
            match expected:
                case int() | float() | str():
                    normalized_expected = int(expected)
                case _:
                    msg = f"Cannot convert {type(expected)} to int"
                    raise ValueError(msg)
        case float():
            match expected:
                case int() | float() | str():
                    normalized_expected = float(expected)
                case _:
                    msg = f"Cannot convert {type(expected)} to float"
                    raise ValueError(msg)
        case _:
            msg = "Invalid actual value type: number or boolean"
            raise ValueError(msg)
    return normalized_expected


def _assert_equal(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    normalized_expected = _normalize_numeric_equality_expected(
        value=value,
        expected=expected,
    )
    return value == normalized_expected


def _assert_not_equal(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    normalized_expected = _normalize_numeric_equality_expected(
        value=value,
        expected=expected,
    )
    return value != normalized_expected


def _assert_greater_than(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    match value:
        case int() | float():
            normalized_value, normalized_expected = _normalize_numeric_values(
                value,
                expected,
            )
            result = normalized_value > normalized_expected
        case _:
            msg = "Invalid actual value type: number"
            raise ValueError(msg)
    return result


def _assert_less_than(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    match value:
        case int() | float():
            normalized_value, normalized_expected = _normalize_numeric_values(
                value,
                expected,
            )
            result = normalized_value < normalized_expected
        case _:
            msg = "Invalid actual value type: number"
            raise ValueError(msg)
    return result


def _assert_greater_than_or_equal(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    match value:
        case int() | float():
            normalized_value, normalized_expected = _normalize_numeric_values(
                value,
                expected,
            )
            result = normalized_value >= normalized_expected
        case _:
            msg = "Invalid actual value type: number"
            raise ValueError(msg)
    return result


def _assert_less_than_or_equal(*, value: Any, expected: Any) -> bool:
    if value is None:
        return False

    match value:
        case int() | float():
            normalized_value, normalized_expected = _normalize_numeric_values(
                value,
                expected,
            )
            result = normalized_value <= normalized_expected
        case _:
            msg = "Invalid actual value type: number"
            raise ValueError(msg)
    return result


def _assert_null(*, value: Any) -> bool:
    return value is None


def _assert_not_null(*, value: Any) -> bool:
    return value is not None


def _assert_in(*, value: Any, expected: Any) -> bool:
    if not value:
        return False

    match expected:
        case list():
            result = value in expected
        case _:
            msg = "Invalid expected value type: array"
            raise ValueError(msg)
    return result


def _assert_not_in(*, value: Any, expected: Any) -> bool:
    if not value:
        return True

    match expected:
        case list():
            result = value not in expected
        case _:
            msg = "Invalid expected value type: array"
            raise ValueError(msg)
    return result


def _assert_all_of(*, value: Any, expected: Sequence[str]) -> bool:
    if not value:
        return False

    match value:
        case list() | tuple() | set() | str():
            result = all(item in value for item in expected)
        case _:
            result = False
    return result


def _assert_all_of_bool(*, value: Any, expected: Sequence[bool]) -> bool:
    if not value:
        return False

    match value:
        case list() | tuple() | set():
            result = all(item in value for item in expected)
        case _:
            result = False
    return result


def _assert_exists(*, value: Any) -> bool:
    return value is not None


def _assert_not_exists(*, value: Any) -> bool:
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
                msg = (
                    "Expected value must be a string when key is "
                    "FileAttribute.EXTENSION"
                )
                raise TypeError(msg)
            if expected_value and not expected_value.startswith("."):
                expected_value = "." + expected_value

            normalized_values: list[Any] = []
            for value in values:
                if value and isinstance(value, str) and not value.startswith("."):
                    normalized_value = "." + value
                else:
                    normalized_value = value
                normalized_values.append(normalized_value)
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
        result = (
            all(sub_group_results)
            if "not" in condition.comparison_operator
            else any(sub_group_results)
        )
        group_results.append(result)
    return all(group_results) if operator == "and" else any(group_results)
