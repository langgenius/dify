from collections.abc import Sequence
from typing import Any, Optional

from core.file.file_obj import FileVar
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.utils.condition.entities import Condition
from core.workflow.utils.variable_template_parser import VariableTemplateParser


class ConditionProcessor:
    def process_conditions(self, variable_pool: VariablePool, conditions: Sequence[Condition]):
        input_conditions = []
        group_result = []

        index = 0
        for condition in conditions:
            index += 1
            actual_value = variable_pool.get_any(condition.variable_selector)

            expected_value = None
            if condition.value is not None:
                variable_template_parser = VariableTemplateParser(template=condition.value)
                variable_selectors = variable_template_parser.extract_variable_selectors()
                if variable_selectors:
                    for variable_selector in variable_selectors:
                        value = variable_pool.get_any(variable_selector.value_selector)
                        expected_value = variable_template_parser.format({variable_selector.variable: value})

                    if expected_value is None:
                        expected_value = condition.value
                else:
                    expected_value = condition.value

            comparison_operator = condition.comparison_operator
            input_conditions.append(
                {
                    "actual_value": actual_value,
                    "expected_value": expected_value,
                    "comparison_operator": comparison_operator,
                }
            )

            result = self.evaluate_condition(actual_value, comparison_operator, expected_value)
            group_result.append(result)

        return input_conditions, group_result

    def evaluate_condition(
        self,
        actual_value: Optional[str | int | float | dict[Any, Any] | list[Any] | FileVar | None],
        comparison_operator: str,
        expected_value: Optional[str] = None,
    ) -> bool:
        """
        Evaluate condition
        :param actual_value: actual value
        :param expected_value: expected value
        :param comparison_operator: comparison operator

        :return: bool
        """
        if comparison_operator == "contains":
            return self._assert_contains(actual_value, expected_value)
        elif comparison_operator == "not contains":
            return self._assert_not_contains(actual_value, expected_value)
        elif comparison_operator == "start with":
            return self._assert_start_with(actual_value, expected_value)
        elif comparison_operator == "end with":
            return self._assert_end_with(actual_value, expected_value)
        elif comparison_operator == "is":
            return self._assert_is(actual_value, expected_value)
        elif comparison_operator == "is not":
            return self._assert_is_not(actual_value, expected_value)
        elif comparison_operator == "empty":
            return self._assert_empty(actual_value)
        elif comparison_operator == "not empty":
            return self._assert_not_empty(actual_value)
        elif comparison_operator == "=":
            return self._assert_equal(actual_value, expected_value)
        elif comparison_operator == "≠":
            return self._assert_not_equal(actual_value, expected_value)
        elif comparison_operator == ">":
            return self._assert_greater_than(actual_value, expected_value)
        elif comparison_operator == "<":
            return self._assert_less_than(actual_value, expected_value)
        elif comparison_operator == "≥":
            return self._assert_greater_than_or_equal(actual_value, expected_value)
        elif comparison_operator == "≤":
            return self._assert_less_than_or_equal(actual_value, expected_value)
        elif comparison_operator == "null":
            return self._assert_null(actual_value)
        elif comparison_operator == "not null":
            return self._assert_not_null(actual_value)
        else:
            raise ValueError(f"Invalid comparison operator: {comparison_operator}")

    def _assert_contains(self, actual_value: Optional[str | list], expected_value: str) -> bool:
        """
        Assert contains
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if not actual_value:
            return False

        if not isinstance(actual_value, str | list):
            raise ValueError("Invalid actual value type: string or array")

        if expected_value not in actual_value:
            return False
        return True

    def _assert_not_contains(self, actual_value: Optional[str | list], expected_value: str) -> bool:
        """
        Assert not contains
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if not actual_value:
            return True

        if not isinstance(actual_value, str | list):
            raise ValueError("Invalid actual value type: string or array")

        if expected_value in actual_value:
            return False
        return True

    def _assert_start_with(self, actual_value: Optional[str], expected_value: str) -> bool:
        """
        Assert start with
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if not actual_value:
            return False

        if not isinstance(actual_value, str):
            raise ValueError("Invalid actual value type: string")

        if not actual_value.startswith(expected_value):
            return False
        return True

    def _assert_end_with(self, actual_value: Optional[str], expected_value: str) -> bool:
        """
        Assert end with
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if not actual_value:
            return False

        if not isinstance(actual_value, str):
            raise ValueError("Invalid actual value type: string")

        if not actual_value.endswith(expected_value):
            return False
        return True

    def _assert_is(self, actual_value: Optional[str], expected_value: str) -> bool:
        """
        Assert is
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if actual_value is None:
            return False

        if not isinstance(actual_value, str):
            raise ValueError("Invalid actual value type: string")

        if actual_value != expected_value:
            return False
        return True

    def _assert_is_not(self, actual_value: Optional[str], expected_value: str) -> bool:
        """
        Assert is not
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if actual_value is None:
            return False

        if not isinstance(actual_value, str):
            raise ValueError("Invalid actual value type: string")

        if actual_value == expected_value:
            return False
        return True

    def _assert_empty(self, actual_value: Optional[str]) -> bool:
        """
        Assert empty
        :param actual_value: actual value
        :return:
        """
        if not actual_value:
            return True
        return False

    def _assert_not_empty(self, actual_value: Optional[str]) -> bool:
        """
        Assert not empty
        :param actual_value: actual value
        :return:
        """
        if actual_value:
            return True
        return False

    def _assert_equal(self, actual_value: Optional[int | float], expected_value: str | int | float) -> bool:
        """
        Assert equal
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if actual_value is None:
            return False

        if not isinstance(actual_value, int | float):
            raise ValueError("Invalid actual value type: number")

        if isinstance(actual_value, int):
            expected_value = int(expected_value)
        else:
            expected_value = float(expected_value)

        if actual_value != expected_value:
            return False
        return True

    def _assert_not_equal(self, actual_value: Optional[int | float], expected_value: str | int | float) -> bool:
        """
        Assert not equal
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if actual_value is None:
            return False

        if not isinstance(actual_value, int | float):
            raise ValueError("Invalid actual value type: number")

        if isinstance(actual_value, int):
            expected_value = int(expected_value)
        else:
            expected_value = float(expected_value)

        if actual_value == expected_value:
            return False
        return True

    def _assert_greater_than(self, actual_value: Optional[int | float], expected_value: str | int | float) -> bool:
        """
        Assert greater than
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if actual_value is None:
            return False

        if not isinstance(actual_value, int | float):
            raise ValueError("Invalid actual value type: number")

        if isinstance(actual_value, int):
            expected_value = int(expected_value)
        else:
            expected_value = float(expected_value)

        if actual_value <= expected_value:
            return False
        return True

    def _assert_less_than(self, actual_value: Optional[int | float], expected_value: str | int | float) -> bool:
        """
        Assert less than
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if actual_value is None:
            return False

        if not isinstance(actual_value, int | float):
            raise ValueError("Invalid actual value type: number")

        if isinstance(actual_value, int):
            expected_value = int(expected_value)
        else:
            expected_value = float(expected_value)

        if actual_value >= expected_value:
            return False
        return True

    def _assert_greater_than_or_equal(
        self, actual_value: Optional[int | float], expected_value: str | int | float
    ) -> bool:
        """
        Assert greater than or equal
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if actual_value is None:
            return False

        if not isinstance(actual_value, int | float):
            raise ValueError("Invalid actual value type: number")

        if isinstance(actual_value, int):
            expected_value = int(expected_value)
        else:
            expected_value = float(expected_value)

        if actual_value < expected_value:
            return False
        return True

    def _assert_less_than_or_equal(
        self, actual_value: Optional[int | float], expected_value: str | int | float
    ) -> bool:
        """
        Assert less than or equal
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if actual_value is None:
            return False

        if not isinstance(actual_value, int | float):
            raise ValueError("Invalid actual value type: number")

        if isinstance(actual_value, int):
            expected_value = int(expected_value)
        else:
            expected_value = float(expected_value)

        if actual_value > expected_value:
            return False
        return True

    def _assert_null(self, actual_value: Optional[int | float]) -> bool:
        """
        Assert null
        :param actual_value: actual value
        :return:
        """
        if actual_value is None:
            return True
        return False

    def _assert_not_null(self, actual_value: Optional[int | float]) -> bool:
        """
        Assert not null
        :param actual_value: actual value
        :return:
        """
        if actual_value is not None:
            return True
        return False


class ConditionAssertionError(Exception):
    def __init__(self, message: str, conditions: list[dict], sub_condition_compare_results: list[dict]) -> None:
        self.message = message
        self.conditions = conditions
        self.sub_condition_compare_results = sub_condition_compare_results
        super().__init__(self.message)
