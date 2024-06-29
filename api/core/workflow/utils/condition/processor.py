from typing import Literal, Optional

from core.workflow.entities.variable_pool import VariablePool
from core.workflow.utils.condition.entities import Condition


class ConditionProcessor:
    def process(self, variable_pool: VariablePool,
                logical_operator: Literal["and", "or"],
                conditions: list[Condition]) -> tuple[bool, list[dict]]:
        """
        Process conditions

        :param variable_pool: variable pool
        :param logical_operator: logical operator
        :param conditions: conditions
        """
        input_conditions = []
        sub_condition_compare_results = []

        try:
            for condition in conditions:
                actual_value = variable_pool.get_variable_value(
                    variable_selector=condition.variable_selector
                )

                expected_value = condition.value

                input_conditions.append({
                    "actual_value": actual_value,
                    "expected_value": expected_value,
                    "comparison_operator": condition.comparison_operator
                })

            for input_condition in input_conditions:
                actual_value = input_condition["actual_value"]
                expected_value = input_condition["expected_value"]
                comparison_operator = input_condition["comparison_operator"]

                if comparison_operator == "contains":
                    compare_result = self._assert_contains(actual_value, expected_value)
                elif comparison_operator == "not contains":
                    compare_result = self._assert_not_contains(actual_value, expected_value)
                elif comparison_operator == "start with":
                    compare_result = self._assert_start_with(actual_value, expected_value)
                elif comparison_operator == "end with":
                    compare_result = self._assert_end_with(actual_value, expected_value)
                elif comparison_operator == "is":
                    compare_result = self._assert_is(actual_value, expected_value)
                elif comparison_operator == "is not":
                    compare_result = self._assert_is_not(actual_value, expected_value)
                elif comparison_operator == "empty":
                    compare_result = self._assert_empty(actual_value)
                elif comparison_operator == "not empty":
                    compare_result = self._assert_not_empty(actual_value)
                elif comparison_operator == "=":
                    compare_result = self._assert_equal(actual_value, expected_value)
                elif comparison_operator == "≠":
                    compare_result = self._assert_not_equal(actual_value, expected_value)
                elif comparison_operator == ">":
                    compare_result = self._assert_greater_than(actual_value, expected_value)
                elif comparison_operator == "<":
                    compare_result = self._assert_less_than(actual_value, expected_value)
                elif comparison_operator == "≥":
                    compare_result = self._assert_greater_than_or_equal(actual_value, expected_value)
                elif comparison_operator == "≤":
                    compare_result = self._assert_less_than_or_equal(actual_value, expected_value)
                elif comparison_operator == "null":
                    compare_result = self._assert_null(actual_value)
                elif comparison_operator == "not null":
                    compare_result = self._assert_not_null(actual_value)
                else:
                    continue

                sub_condition_compare_results.append({
                    **input_condition,
                    "result": compare_result
                })
        except Exception as e:
            raise ConditionAssertionError(str(e), input_conditions, sub_condition_compare_results)

        if logical_operator == "and":
            compare_result = False not in [condition["result"] for condition in sub_condition_compare_results]
        else:
            compare_result = True in [condition["result"] for condition in sub_condition_compare_results]

        return compare_result, sub_condition_compare_results

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
            raise ValueError('Invalid actual value type: string or array')

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
            raise ValueError('Invalid actual value type: string or array')

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
            raise ValueError('Invalid actual value type: string')

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
            raise ValueError('Invalid actual value type: string')

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
            raise ValueError('Invalid actual value type: string')

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
            raise ValueError('Invalid actual value type: string')

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

    def _assert_equal(self, actual_value: Optional[int | float], expected_value: str) -> bool:
        """
        Assert equal
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if actual_value is None:
            return False

        if not isinstance(actual_value, int | float):
            raise ValueError('Invalid actual value type: number')

        if isinstance(actual_value, int):
            expected_value = int(expected_value)
        else:
            expected_value = float(expected_value)

        if actual_value != expected_value:
            return False
        return True

    def _assert_not_equal(self, actual_value: Optional[int | float], expected_value: str) -> bool:
        """
        Assert not equal
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if actual_value is None:
            return False

        if not isinstance(actual_value, int | float):
            raise ValueError('Invalid actual value type: number')

        if isinstance(actual_value, int):
            expected_value = int(expected_value)
        else:
            expected_value = float(expected_value)

        if actual_value == expected_value:
            return False
        return True

    def _assert_greater_than(self, actual_value: Optional[int | float], expected_value: str) -> bool:
        """
        Assert greater than
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if actual_value is None:
            return False

        if not isinstance(actual_value, int | float):
            raise ValueError('Invalid actual value type: number')

        if isinstance(actual_value, int):
            expected_value = int(expected_value)
        else:
            expected_value = float(expected_value)

        if actual_value <= expected_value:
            return False
        return True

    def _assert_less_than(self, actual_value: Optional[int | float], expected_value: str) -> bool:
        """
        Assert less than
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if actual_value is None:
            return False

        if not isinstance(actual_value, int | float):
            raise ValueError('Invalid actual value type: number')

        if isinstance(actual_value, int):
            expected_value = int(expected_value)
        else:
            expected_value = float(expected_value)

        if actual_value >= expected_value:
            return False
        return True

    def _assert_greater_than_or_equal(self, actual_value: Optional[int | float], expected_value: str) -> bool:
        """
        Assert greater than or equal
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if actual_value is None:
            return False

        if not isinstance(actual_value, int | float):
            raise ValueError('Invalid actual value type: number')

        if isinstance(actual_value, int):
            expected_value = int(expected_value)
        else:
            expected_value = float(expected_value)

        if actual_value < expected_value:
            return False
        return True

    def _assert_less_than_or_equal(self, actual_value: Optional[int | float], expected_value: str) -> bool:
        """
        Assert less than or equal
        :param actual_value: actual value
        :param expected_value: expected value
        :return:
        """
        if actual_value is None:
            return False

        if not isinstance(actual_value, int | float):
            raise ValueError('Invalid actual value type: number')

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
