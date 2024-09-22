from collections.abc import Sequence
from typing import Any

from core.file import ArrayFileAttribute, FileAttribute, file_manager
from core.helper import ssrf_proxy
from core.variables import FileSegment
from core.variables.segments import ArrayFileSegment
from core.workflow.entities.variable_pool import VariablePool

from .entities import Condition, SupportedComparisonOperator


class ConditionProcessor:
    def process_conditions(self, variable_pool: VariablePool, conditions: Sequence[Condition]):
        input_conditions = []
        group_results = []

        for condition in conditions:
            variable = variable_pool.get(condition.variable_selector)

            if condition.sub_variable:
                if not isinstance(variable, FileSegment | ArrayFileSegment):
                    raise ValueError("Invalid actual value type: FileSegment or ArrayFileSegment")
                for sub_condition in condition.sub_variable.conditions:
                    sub_group_results = []
                    actual_value = _get_sub_attribute(key=sub_condition.key, variable=variable)
                    expected_value = sub_condition.value
                    expected_value = variable_pool.convert_template(expected_value).text if expected_value else None
                    sub_result = self.evaluate_condition(
                        actual_value=actual_value,
                        operator=sub_condition.comparison_operator,
                        expected_value=expected_value,
                    )
                    input_conditions.append(
                        {
                            "actual_value": actual_value,
                            "expected_value": expected_value,
                            "comparison_operator": sub_condition.comparison_operator,
                        }
                    )
                    sub_group_results.append(sub_result)
                result = (
                    all(sub_group_results)
                    if condition.sub_variable.logical_operator == "and"
                    else any(sub_group_results)
                )
            else:
                actual_value = variable.value if variable else None
                expected_value = condition.value
                expected_value = variable_pool.convert_template(expected_value).text if expected_value else None
                input_conditions.append(
                    {
                        "actual_value": actual_value,
                        "expected_value": expected_value,
                        "comparison_operator": condition.comparison_operator,
                    }
                )
                result = self.evaluate_condition(
                    actual_value=actual_value,
                    operator=condition.comparison_operator,
                    expected_value=expected_value,
                )
            group_results.append(result)

        return input_conditions, group_results

    def evaluate_condition(
        self,
        actual_value: Any,
        operator: SupportedComparisonOperator,
        expected_value: str | None,
    ) -> bool:
        match operator:
            case "contains":
                return self._assert_contains(actual_value=actual_value, expected_value=expected_value)
            case "not contains":
                return self._assert_not_contains(actual_value=actual_value, expected_value=expected_value)
            case "start with":
                return self._assert_start_with(actual_value=actual_value, expected_value=expected_value)
            case "end with":
                return self._assert_end_with(actual_value=actual_value, expected_value=expected_value)
            case "is":
                return self._assert_is(actual_value=actual_value, expected_value=expected_value)
            case "is not":
                return self._assert_is_not(actual_value=actual_value, expected_value=expected_value)
            case "empty":
                return self._assert_empty(actual_value=actual_value)
            case "not empty":
                return self._assert_not_empty(actual_value=actual_value)
            case "=":
                return self._assert_equal(actual_value=actual_value, expected_value=expected_value)
            case "≠":
                return self._assert_not_equal(actual_value=actual_value, expected_value=expected_value)
            case ">":
                return self._assert_greater_than(actual_value=actual_value, expected_value=expected_value)
            case "<":
                return self._assert_less_than(actual_value=actual_value, expected_value=expected_value)
            case "≥":
                return self._assert_greater_than_or_equal(actual_value=actual_value, expected_value=expected_value)
            case "≤":
                return self._assert_less_than_or_equal(actual_value=actual_value, expected_value=expected_value)
            case "null":
                return self._assert_null(actual_value=actual_value)
            case "not null":
                return self._assert_not_null(actual_value=actual_value)
            case _:
                raise ValueError(f"Unsupported operator: {operator}")

    def _assert_contains(self, actual_value: Any, expected_value: Any) -> bool:
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

    def _assert_not_contains(self, actual_value: Any, expected_value: Any) -> bool:
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

    def _assert_start_with(self, actual_value: Any, expected_value: Any) -> bool:
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

    def _assert_end_with(self, actual_value: Any, expected_value: Any) -> bool:
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

    def _assert_is(self, actual_value: Any, expected_value: Any) -> bool:
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

    def _assert_is_not(self, actual_value: Any, expected_value: Any) -> bool:
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

    def _assert_empty(self, actual_value: Any) -> bool:
        """
        Assert empty
        :param actual_value: actual value
        :return:
        """
        if not actual_value:
            return True
        return False

    def _assert_not_empty(self, actual_value: Any) -> bool:
        """
        Assert not empty
        :param actual_value: actual value
        :return:
        """
        if actual_value:
            return True
        return False

    def _assert_equal(self, actual_value: Any, expected_value: Any) -> bool:
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

    def _assert_not_equal(self, actual_value: Any, expected_value: Any) -> bool:
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

    def _assert_greater_than(self, actual_value: Any, expected_value: Any) -> bool:
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

    def _assert_less_than(self, actual_value: Any, expected_value: Any) -> bool:
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

    def _assert_greater_than_or_equal(self, actual_value: Any, expected_value: Any) -> bool:
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

    def _assert_less_than_or_equal(self, actual_value: Any, expected_value: Any) -> bool:
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

    def _assert_null(self, actual_value: Any) -> bool:
        """
        Assert null
        :param actual_value: actual value
        :return:
        """
        if actual_value is None:
            return True
        return False

    def _assert_not_null(self, actual_value: Any) -> bool:
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


def _get_sub_attribute(*, key: str, variable: FileSegment | ArrayFileSegment) -> Any:
    if isinstance(variable, FileSegment):
        attribute = FileAttribute(key)
        match attribute:
            case FileAttribute.NAME:
                actual_value = variable.value.filename
            case FileAttribute.SIZE:
                file = variable.value
                if file.related_id:
                    file_contnet = file_manager.download(upload_file_id=file.related_id, tenant_id=file.tenant_id)
                    actual_value = len(file_contnet)
                elif file.url:
                    response = ssrf_proxy.head(url=file.url)
                    response.raise_for_status()
                    actual_value = int(response.headers.get("Content-Length", 0))
                else:
                    raise ValueError("Invalid file")
            case FileAttribute.TYPE:
                actual_value = variable.value.type
            case FileAttribute.MIME_TYPE:
                actual_value = variable.value.mime_type
            case FileAttribute.TRANSFER_METHOD:
                actual_value = variable.value.transfer_method
            case FileAttribute.URL:
                actual_value = variable.value.url
            case _:
                raise ValueError(f"Invalid file attribute: {attribute}")
    elif isinstance(variable, ArrayFileSegment):
        attribute = ArrayFileAttribute(key)
        match attribute:
            case ArrayFileAttribute.LENGTH:
                actual_value = len(variable.value)
            case _:
                raise ValueError(f"Invalid array file attribute: {attribute}")

    return actual_value
