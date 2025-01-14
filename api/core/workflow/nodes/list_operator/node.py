from collections.abc import Callable, Sequence
from typing import Any, Literal, Union

from core.file import File
from core.variables import ArrayFileSegment, ArrayNumberSegment, ArrayStringSegment
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from models.workflow import WorkflowNodeExecutionStatus

from .entities import ListOperatorNodeData
from .exc import InvalidConditionError, InvalidFilterValueError, InvalidKeyError, ListOperatorError


class ListOperatorNode(BaseNode[ListOperatorNodeData]):
    _node_data_cls = ListOperatorNodeData
    _node_type = NodeType.LIST_OPERATOR

    def _run(self):
        inputs: dict[str, list] = {}
        process_data: dict[str, list] = {}
        outputs: dict[str, Any] = {}

        variable = self.graph_runtime_state.variable_pool.get(self.node_data.variable)
        if variable is None:
            error_message = f"Variable not found for selector: {self.node_data.variable}"
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED, error=error_message, inputs=inputs, outputs=outputs
            )
        if not variable.value:
            inputs = {"variable": []}
            process_data = {"variable": []}
            outputs = {"result": [], "first_record": None, "last_record": None}
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs=inputs,
                process_data=process_data,
                outputs=outputs,
            )
        if not isinstance(variable, ArrayFileSegment | ArrayNumberSegment | ArrayStringSegment):
            error_message = (
                f"Variable {self.node_data.variable} is not an ArrayFileSegment, ArrayNumberSegment "
                "or ArrayStringSegment"
            )
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
            if self.node_data.filter_by.enabled:
                variable = self._apply_filter(variable)

            # Extract
            if self.node_data.extract_by.enabled:
                variable = self._extract_slice(variable)

            # Order
            if self.node_data.order_by.enabled:
                variable = self._apply_order(variable)

            # Slice
            if self.node_data.limit.enabled:
                variable = self._apply_slice(variable)

            outputs = {
                "result": variable.value,
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

    def _apply_filter(
        self, variable: Union[ArrayFileSegment, ArrayNumberSegment, ArrayStringSegment]
    ) -> Union[ArrayFileSegment, ArrayNumberSegment, ArrayStringSegment]:
        filter_func: Callable[[Any], bool]
        result: list[Any] = []
        for condition in self.node_data.filter_by.conditions:
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
                else:
                    value = condition.value
                filter_func = _get_file_filter_func(
                    key=condition.key,
                    condition=condition.comparison_operator,
                    value=value,
                )
                result = list(filter(filter_func, variable.value))
                variable = variable.model_copy(update={"value": result})
        return variable

    def _apply_order(
        self, variable: Union[ArrayFileSegment, ArrayNumberSegment, ArrayStringSegment]
    ) -> Union[ArrayFileSegment, ArrayNumberSegment, ArrayStringSegment]:
        if isinstance(variable, ArrayStringSegment):
            result = _order_string(order=self.node_data.order_by.value, array=variable.value)
            variable = variable.model_copy(update={"value": result})
        elif isinstance(variable, ArrayNumberSegment):
            result = _order_number(order=self.node_data.order_by.value, array=variable.value)
            variable = variable.model_copy(update={"value": result})
        elif isinstance(variable, ArrayFileSegment):
            result = _order_file(
                order=self.node_data.order_by.value, order_by=self.node_data.order_by.key, array=variable.value
            )
            variable = variable.model_copy(update={"value": result})
        return variable

    def _apply_slice(
        self, variable: Union[ArrayFileSegment, ArrayNumberSegment, ArrayStringSegment]
    ) -> Union[ArrayFileSegment, ArrayNumberSegment, ArrayStringSegment]:
        result = variable.value[: self.node_data.limit.size]
        return variable.model_copy(update={"value": result})

    def _extract_slice(
        self, variable: Union[ArrayFileSegment, ArrayNumberSegment, ArrayStringSegment]
    ) -> Union[ArrayFileSegment, ArrayNumberSegment, ArrayStringSegment]:
        value = int(self.graph_runtime_state.variable_pool.convert_template(self.node_data.extract_by.serial).text) - 1
        if len(variable.value) > int(value):
            result = variable.value[value]
        else:
            result = ""
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
            return lambda x: not _contains(value)(x)
        case "is not":
            return lambda x: not _is(value)(x)
        case "not in":
            return lambda x: not _in(value)(x)
        case "not empty":
            return lambda x: x != ""
        case _:
            raise InvalidConditionError(f"Invalid condition: {condition}")


def _get_sequence_filter_func(*, condition: str, value: Sequence[str]) -> Callable[[str], bool]:
    match condition:
        case "in":
            return _in(value)
        case "not in":
            return lambda x: not _in(value)(x)
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


def _get_file_filter_func(*, key: str, condition: str, value: str | Sequence[str]) -> Callable[[File], bool]:
    extract_func: Callable[[File], Any]
    if key in {"name", "extension", "mime_type", "url"} and isinstance(value, str):
        extract_func = _get_file_extract_string_func(key=key)
        return lambda x: _get_string_filter_func(condition=condition, value=value)(extract_func(x))
    if key in {"type", "transfer_method"} and isinstance(value, Sequence):
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


def _is(value: str) -> Callable[[str], bool]:
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


def _order_number(*, order: Literal["asc", "desc"], array: Sequence[int | float]):
    return sorted(array, key=lambda x: x, reverse=order == "desc")


def _order_string(*, order: Literal["asc", "desc"], array: Sequence[str]):
    return sorted(array, key=lambda x: x, reverse=order == "desc")


def _order_file(*, order: Literal["asc", "desc"], order_by: str = "", array: Sequence[File]):
    extract_func: Callable[[File], Any]
    if order_by in {"name", "type", "extension", "mime_type", "transfer_method", "url"}:
        extract_func = _get_file_extract_string_func(key=order_by)
        return sorted(array, key=lambda x: extract_func(x), reverse=order == "desc")
    elif order_by == "size":
        extract_func = _get_file_extract_number_func(key=order_by)
        return sorted(array, key=lambda x: extract_func(x), reverse=order == "desc")
    else:
        raise InvalidKeyError(f"Invalid order key: {order_by}")
