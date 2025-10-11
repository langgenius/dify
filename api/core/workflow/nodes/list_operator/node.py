from collections.abc import Callable, Mapping, Sequence
from typing import Any, TypeAlias, TypeVar

from core.file import File
from core.variables import ArrayFileSegment, ArrayNumberSegment, ArrayStringSegment
from core.variables.segments import ArrayAnySegment, ArrayBooleanSegment, ArraySegment
from core.workflow.enums import ErrorStrategy, NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node

from .entities import FilterOperator, ListOperatorNodeData, Order
from .exc import InvalidConditionError, InvalidFilterValueError, InvalidKeyError, ListOperatorError

_SUPPORTED_TYPES_TUPLE = (
    ArrayFileSegment,
    ArrayNumberSegment,
    ArrayStringSegment,
    ArrayBooleanSegment,
)
_SUPPORTED_TYPES_ALIAS: TypeAlias = ArrayFileSegment | ArrayNumberSegment | ArrayStringSegment | ArrayBooleanSegment


_T = TypeVar("_T")


def _negation(filter_: Callable[[_T], bool]) -> Callable[[_T], bool]:
    """Returns the negation of a given filter function. If the original filter
    returns `True` for a value, the negated filter will return `False`, and vice versa.
    """

    def wrapper(value: _T) -> bool:
        return not filter_(value)

    return wrapper


class ListOperatorNode(Node):
    node_type = NodeType.LIST_OPERATOR

    _node_data: ListOperatorNodeData

    def init_node_data(self, data: Mapping[str, Any]):
        self._node_data = ListOperatorNodeData.model_validate(data)

    def _get_error_strategy(self) -> ErrorStrategy | None:
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._node_data.retry_config

    def _get_title(self) -> str:
        return self._node_data.title

    def _get_description(self) -> str | None:
        return self._node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        return self._node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        return self._node_data

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self):
        inputs: dict[str, Sequence[object]] = {}
        process_data: dict[str, Sequence[object]] = {}
        outputs: dict[str, Any] = {}

        variable = self.graph_runtime_state.variable_pool.get(self._node_data.variable)
        if variable is None:
            error_message = f"Variable not found for selector: {self._node_data.variable}"
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED, error=error_message, inputs=inputs, outputs=outputs
            )
        if not variable.value:
            inputs = {"variable": []}
            process_data = {"variable": []}
            if isinstance(variable, ArraySegment):
                result = variable.model_copy(update={"value": []})
            else:
                result = ArrayAnySegment(value=[])
            outputs = {"result": result, "first_record": None, "last_record": None}
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs=inputs,
                process_data=process_data,
                outputs=outputs,
            )
        if not isinstance(variable, _SUPPORTED_TYPES_TUPLE):
            error_message = f"Variable {self._node_data.variable} is not an array type, actual type: {type(variable)}"
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED, error=error_message, inputs=inputs, outputs=outputs
            )

        if isinstance(variable, ArrayFileSegment):
            inputs = {"variable": [item.to_dict() for item in variable.value]}
            process_data["variable"] = [item.to_dict() for item in variable.value]
        else:
            inputs = {"variable": variable.value}
            process_data["variable"] = variable.value

        try:
            # Filter
            if self._node_data.filter_by.enabled:
                variable = self._apply_filter(variable)

            # Extract
            if self._node_data.extract_by.enabled:
                variable = self._extract_slice(variable)

            # Order
            if self._node_data.order_by.enabled:
                variable = self._apply_order(variable)

            # Slice
            if self._node_data.limit.enabled:
                variable = self._apply_slice(variable)

            outputs = {
                "result": variable,
                "first_record": variable.value[0] if variable.value else None,
                "last_record": variable.value[-1] if variable.value else None,
            }
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs=inputs,
                process_data=process_data,
                outputs=outputs,
            )
        except ListOperatorError as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
                inputs=inputs,
                process_data=process_data,
                outputs=outputs,
            )

    def _apply_filter(self, variable: _SUPPORTED_TYPES_ALIAS) -> _SUPPORTED_TYPES_ALIAS:
        filter_func: Callable[[Any], bool]
        result: list[Any] = []
        for condition in self._node_data.filter_by.conditions:
            if isinstance(variable, ArrayStringSegment):
                if not isinstance(condition.value, str):
                    raise InvalidFilterValueError(f"Invalid filter value: {condition.value}")
                value = self.graph_runtime_state.variable_pool.convert_template(condition.value).text
                filter_func = _get_string_filter_func(condition=condition.comparison_operator, value=value)
                result = list(filter(filter_func, variable.value))
                variable = variable.model_copy(update={"value": result})
            elif isinstance(variable, ArrayNumberSegment):
                if not isinstance(condition.value, str):
                    raise InvalidFilterValueError(f"Invalid filter value: {condition.value}")
                value = self.graph_runtime_state.variable_pool.convert_template(condition.value).text
                filter_func = _get_number_filter_func(condition=condition.comparison_operator, value=float(value))
                result = list(filter(filter_func, variable.value))
                variable = variable.model_copy(update={"value": result})
            elif isinstance(variable, ArrayFileSegment):
                if isinstance(condition.value, str):
                    value = self.graph_runtime_state.variable_pool.convert_template(condition.value).text
                elif isinstance(condition.value, bool):
                    raise ValueError(f"File filter expects a string value, got {type(condition.value)}")
                else:
                    value = condition.value
                filter_func = _get_file_filter_func(
                    key=condition.key,
                    condition=condition.comparison_operator,
                    value=value,
                )
                result = list(filter(filter_func, variable.value))
                variable = variable.model_copy(update={"value": result})
            else:
                if not isinstance(condition.value, bool):
                    raise ValueError(f"Boolean filter expects a boolean value, got {type(condition.value)}")
                filter_func = _get_boolean_filter_func(condition=condition.comparison_operator, value=condition.value)
                result = list(filter(filter_func, variable.value))
                variable = variable.model_copy(update={"value": result})
        return variable

    def _apply_order(self, variable: _SUPPORTED_TYPES_ALIAS) -> _SUPPORTED_TYPES_ALIAS:
        if isinstance(variable, (ArrayStringSegment, ArrayNumberSegment, ArrayBooleanSegment)):
            result = sorted(variable.value, reverse=self._node_data.order_by.value == Order.DESC)
            variable = variable.model_copy(update={"value": result})
        else:
            result = _order_file(
                order=self._node_data.order_by.value, order_by=self._node_data.order_by.key, array=variable.value
            )
            variable = variable.model_copy(update={"value": result})

        return variable

    def _apply_slice(self, variable: _SUPPORTED_TYPES_ALIAS) -> _SUPPORTED_TYPES_ALIAS:
        result = variable.value[: self._node_data.limit.size]
        return variable.model_copy(update={"value": result})

    def _extract_slice(self, variable: _SUPPORTED_TYPES_ALIAS) -> _SUPPORTED_TYPES_ALIAS:
        value = int(self.graph_runtime_state.variable_pool.convert_template(self._node_data.extract_by.serial).text)
        if value < 1:
            raise ValueError(f"Invalid serial index: must be >= 1, got {value}")
        if value > len(variable.value):
            raise InvalidKeyError(f"Invalid serial index: must be <= {len(variable.value)}, got {value}")
        value -= 1
        result = variable.value[value]
        return variable.model_copy(update={"value": [result]})


def _get_file_extract_number_func(*, key: str) -> Callable[[File], int]:
    match key:
        case "size":
            return lambda x: x.size
        case _:
            raise InvalidKeyError(f"Invalid key: {key}")


def _get_file_extract_string_func(*, key: str) -> Callable[[File], str]:
    match key:
        case "name":
            return lambda x: x.filename or ""
        case "type":
            return lambda x: x.type
        case "extension":
            return lambda x: x.extension or ""
        case "mime_type":
            return lambda x: x.mime_type or ""
        case "transfer_method":
            return lambda x: x.transfer_method
        case "url":
            return lambda x: x.remote_url or ""
        case _:
            raise InvalidKeyError(f"Invalid key: {key}")


def _get_string_filter_func(*, condition: str, value: str) -> Callable[[str], bool]:
    match condition:
        case "contains":
            return _contains(value)
        case "start with":
            return _startswith(value)
        case "end with":
            return _endswith(value)
        case "is":
            return _is(value)
        case "in":
            return _in(value)
        case "empty":
            return lambda x: x == ""
        case "not contains":
            return _negation(_contains(value))
        case "is not":
            return _negation(_is(value))
        case "not in":
            return _negation(_in(value))
        case "not empty":
            return lambda x: x != ""
        case _:
            raise InvalidConditionError(f"Invalid condition: {condition}")


def _get_sequence_filter_func(*, condition: str, value: Sequence[str]) -> Callable[[str], bool]:
    match condition:
        case "in":
            return _in(value)
        case "not in":
            return _negation(_in(value))
        case _:
            raise InvalidConditionError(f"Invalid condition: {condition}")


def _get_number_filter_func(*, condition: str, value: int | float) -> Callable[[int | float], bool]:
    match condition:
        case "=":
            return _eq(value)
        case "≠":
            return _ne(value)
        case "<":
            return _lt(value)
        case "≤":
            return _le(value)
        case ">":
            return _gt(value)
        case "≥":
            return _ge(value)
        case _:
            raise InvalidConditionError(f"Invalid condition: {condition}")


def _get_boolean_filter_func(*, condition: FilterOperator, value: bool) -> Callable[[bool], bool]:
    match condition:
        case FilterOperator.IS:
            return _is(value)
        case FilterOperator.IS_NOT:
            return _negation(_is(value))
        case _:
            raise InvalidConditionError(f"Invalid condition: {condition}")


def _get_file_filter_func(*, key: str, condition: str, value: str | Sequence[str]) -> Callable[[File], bool]:
    extract_func: Callable[[File], Any]
    if key in {"name", "extension", "mime_type", "url"} and isinstance(value, str):
        extract_func = _get_file_extract_string_func(key=key)
        return lambda x: _get_string_filter_func(condition=condition, value=value)(extract_func(x))
    if key in {"type", "transfer_method"}:
        extract_func = _get_file_extract_string_func(key=key)
        return lambda x: _get_sequence_filter_func(condition=condition, value=value)(extract_func(x))
    elif key == "size" and isinstance(value, str):
        extract_func = _get_file_extract_number_func(key=key)
        return lambda x: _get_number_filter_func(condition=condition, value=float(value))(extract_func(x))
    else:
        raise InvalidKeyError(f"Invalid key: {key}")


def _contains(value: str) -> Callable[[str], bool]:
    return lambda x: value in x


def _startswith(value: str) -> Callable[[str], bool]:
    return lambda x: x.startswith(value)


def _endswith(value: str) -> Callable[[str], bool]:
    return lambda x: x.endswith(value)


def _is(value: _T) -> Callable[[_T], bool]:
    return lambda x: x == value


def _in(value: str | Sequence[str]) -> Callable[[str], bool]:
    return lambda x: x in value


def _eq(value: int | float) -> Callable[[int | float], bool]:
    return lambda x: x == value


def _ne(value: int | float) -> Callable[[int | float], bool]:
    return lambda x: x != value


def _lt(value: int | float) -> Callable[[int | float], bool]:
    return lambda x: x < value


def _le(value: int | float) -> Callable[[int | float], bool]:
    return lambda x: x <= value


def _gt(value: int | float) -> Callable[[int | float], bool]:
    return lambda x: x > value


def _ge(value: int | float) -> Callable[[int | float], bool]:
    return lambda x: x >= value


def _order_file(*, order: Order, order_by: str = "", array: Sequence[File]):
    extract_func: Callable[[File], Any]
    if order_by in {"name", "type", "extension", "mime_type", "transfer_method", "url"}:
        extract_func = _get_file_extract_string_func(key=order_by)
        return sorted(array, key=lambda x: extract_func(x), reverse=order == Order.DESC)
    elif order_by == "size":
        extract_func = _get_file_extract_number_func(key=order_by)
        return sorted(array, key=lambda x: extract_func(x), reverse=order == Order.DESC)
    else:
        raise InvalidKeyError(f"Invalid order key: {order_by}")
