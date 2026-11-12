import operator
from collections.abc import Callable, Sequence
from typing import Any, override

from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.file.models import File
from graphon.node_events.base import NodeRunResult
from graphon.nodes.base.node import Node
from graphon.variables.segments import (
    ArrayAnySegment,
    ArrayBooleanSegment,
    ArrayFileSegment,
    ArrayNumberSegment,
    ArraySegment,
    ArrayStringSegment,
)
from graphon.variables.template_resolution import convert_template

from .entities import FilterOperator, ListOperatorNodeData, Order
from .exc import (
    InvalidConditionError,
    InvalidFilterValueError,
    InvalidKeyError,
    ListOperatorError,
)

_SUPPORTED_TYPES_TUPLE = (
    ArrayFileSegment,
    ArrayNumberSegment,
    ArrayStringSegment,
    ArrayBooleanSegment,
)
type _SUPPORTED_TYPES_ALIAS = (
    ArrayFileSegment | ArrayNumberSegment | ArrayStringSegment | ArrayBooleanSegment
)


def _negation[T](filter_: Callable[[T], bool]) -> Callable[[T], bool]:
    """Returns the negation of a given filter function. If the original filter
    returns `True` for a value, the negated filter will return `False`, and vice versa.

    Returns:
        A predicate that inverts the boolean result of `filter_`.

    """

    def wrapper(value: T) -> bool:
        return not filter_(value)

    return wrapper


def _extract_file_name(file: File) -> str:
    return file.filename or ""


def _extract_file_type(file: File) -> str:
    return str(file.type)


def _extract_file_extension(file: File) -> str:
    return file.extension or ""


def _extract_file_mime_type(file: File) -> str:
    return file.mime_type or ""


def _extract_file_transfer_method(file: File) -> str:
    return str(file.transfer_method)


def _extract_file_url(file: File) -> str:
    return file.remote_url or ""


def _extract_file_related_id(file: File) -> str:
    return file.related_id or ""


_FILE_STRING_EXTRACTORS: dict[str, Callable[[File], str]] = {
    "name": _extract_file_name,
    "type": _extract_file_type,
    "extension": _extract_file_extension,
    "mime_type": _extract_file_mime_type,
    "transfer_method": _extract_file_transfer_method,
    "url": _extract_file_url,
    "related_id": _extract_file_related_id,
}


class ListOperatorNode(Node[ListOperatorNodeData]):
    node_type = BuiltinNodeTypes.LIST_OPERATOR

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(self) -> NodeRunResult:
        variable = self.runtime_state.variable_pool.get(self.node_data.variable)
        if variable is None:
            return self._failed_result(
                f"Variable not found for selector: {self.node_data.variable}",
            )
        if not variable.value:
            return self._empty_result(variable)
        if not isinstance(variable, _SUPPORTED_TYPES_TUPLE):
            return self._failed_result(
                f"Variable {self.node_data.variable} is not an array type, "
                f"actual type: {type(variable)}"
            )

        inputs, process_data = self._build_input_payloads(variable)

        try:
            variable = self._apply_operations(variable)
            outputs = self._build_outputs(variable)
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
                outputs={},
            )

    def _failed_result(self, error_message: str) -> NodeRunResult:
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.FAILED,
            error=error_message,
            inputs={},
            outputs={},
        )

    def _empty_result(self, variable: ArraySegment | Any) -> NodeRunResult:
        result = (
            variable.model_copy(update={"value": []})
            if isinstance(variable, ArraySegment)
            else ArrayAnySegment(value=[])
        )
        inputs = {"variable": []}
        process_data = {"variable": []}
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=inputs,
            process_data=process_data,
            outputs=self._build_outputs(result),
        )

    def _build_input_payloads(
        self,
        variable: _SUPPORTED_TYPES_ALIAS,
    ) -> tuple[dict[str, Sequence[object]], dict[str, Sequence[object]]]:
        if isinstance(variable, ArrayFileSegment):
            return (
                {"variable": [item.to_dict() for item in variable.value]},
                {"variable": [item.to_dict() for item in variable.value]},
            )
        return {"variable": variable.value}, {"variable": variable.value}

    def _apply_operations(
        self,
        variable: _SUPPORTED_TYPES_ALIAS,
    ) -> _SUPPORTED_TYPES_ALIAS:
        operations = (
            (self.node_data.filter_by.enabled, self._apply_filter),
            (self.node_data.extract_by.enabled, self._extract_slice),
            (self.node_data.order_by.enabled, self._apply_order),
            (self.node_data.limit.enabled, self._apply_slice),
        )
        for enabled, operation in operations:
            if enabled:
                variable = operation(variable)
        return variable

    @staticmethod
    def _build_outputs(variable: ArraySegment) -> dict[str, Any]:
        return {
            "result": variable,
            "first_record": variable.value[0] if variable.value else None,
            "last_record": variable.value[-1] if variable.value else None,
        }

    def _apply_filter(self, variable: _SUPPORTED_TYPES_ALIAS) -> _SUPPORTED_TYPES_ALIAS:
        filter_func: Callable[[Any], bool]
        result: list[Any] = []
        for condition in self.node_data.filter_by.conditions:
            if isinstance(variable, ArrayStringSegment):
                if not isinstance(condition.value, str):
                    msg = f"Invalid filter value: {condition.value}"
                    raise InvalidFilterValueError(msg)
                value = convert_template(
                    self.runtime_state.variable_pool,
                    condition.value,
                ).text
                filter_func = _get_string_filter_func(
                    condition=condition.comparison_operator,
                    value=value,
                )
                result = list(filter(filter_func, variable.value))
                variable = variable.model_copy(update={"value": result})
            elif isinstance(variable, ArrayNumberSegment):
                if not isinstance(condition.value, str):
                    msg = f"Invalid filter value: {condition.value}"
                    raise InvalidFilterValueError(msg)
                value = convert_template(
                    self.runtime_state.variable_pool,
                    condition.value,
                ).text
                filter_func = _get_number_filter_func(
                    condition=condition.comparison_operator,
                    value=float(value),
                )
                result = list(filter(filter_func, variable.value))
                variable = variable.model_copy(update={"value": result})
            elif isinstance(variable, ArrayFileSegment):
                if isinstance(condition.value, str):
                    value = convert_template(
                        self.runtime_state.variable_pool,
                        condition.value,
                    ).text
                elif isinstance(condition.value, bool):
                    msg = (
                        "File filter expects a string value, "
                        f"got {type(condition.value)}"
                    )
                    raise TypeError(msg)
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
                    msg = (
                        "Boolean filter expects a boolean value, "
                        f"got {type(condition.value)}"
                    )
                    raise TypeError(msg)
                filter_func = _get_boolean_filter_func(
                    condition=condition.comparison_operator,
                    value=condition.value,
                )
                result = list(filter(filter_func, variable.value))
                variable = variable.model_copy(update={"value": result})
        return variable

    def _apply_order(self, variable: _SUPPORTED_TYPES_ALIAS) -> _SUPPORTED_TYPES_ALIAS:
        if isinstance(
            variable,
            (ArrayStringSegment, ArrayNumberSegment, ArrayBooleanSegment),
        ):
            result = sorted(
                variable.value,
                reverse=self.node_data.order_by.value == Order.DESC,
            )
            variable = variable.model_copy(update={"value": result})
        else:
            result = _order_file(
                order=self.node_data.order_by.value,
                order_by=self.node_data.order_by.key,
                array=variable.value,
            )
            variable = variable.model_copy(update={"value": result})

        return variable

    def _apply_slice(self, variable: _SUPPORTED_TYPES_ALIAS) -> _SUPPORTED_TYPES_ALIAS:
        result = variable.value[: self.node_data.limit.size]
        return variable.model_copy(update={"value": result})

    def _extract_slice(
        self,
        variable: _SUPPORTED_TYPES_ALIAS,
    ) -> _SUPPORTED_TYPES_ALIAS:
        value = int(
            convert_template(
                self.runtime_state.variable_pool,
                self.node_data.extract_by.serial,
            ).text,
        )
        if value < 1:
            msg = f"Invalid serial index: must be >= 1, got {value}"
            raise ValueError(msg)
        if value > len(variable.value):
            msg = f"Invalid serial index: must be <= {len(variable.value)}, got {value}"
            raise InvalidKeyError(msg)
        value -= 1
        result = variable.value[value]
        return variable.model_copy(update={"value": [result]})


def _get_file_extract_number_func(*, key: str) -> Callable[[File], int]:
    match key:
        case "size":
            return lambda x: x.size
        case _:
            msg = f"Invalid key: {key}"
            raise InvalidKeyError(msg)


def _get_file_extract_string_func(*, key: str) -> Callable[[File], str]:
    extractor = _FILE_STRING_EXTRACTORS.get(key)
    if extractor is None:
        msg = f"Invalid key: {key}"
        raise InvalidKeyError(msg)
    return extractor


def _get_string_filter_func(*, condition: str, value: str) -> Callable[[str], bool]:
    if condition == "empty":
        return operator.not_
    if condition == "not empty":
        return bool

    builder_map: dict[str, Callable[[str], Callable[[str], bool]]] = {
        "contains": _contains,
        "start with": _startswith,
        "end with": _endswith,
        "is": _is,
        "in": _in,
        "not contains": lambda raw_value: _negation(_contains(raw_value)),
        "is not": lambda raw_value: _negation(_is(raw_value)),
        "not in": lambda raw_value: _negation(_in(raw_value)),
    }
    builder = builder_map.get(condition)
    if builder is None:
        msg = f"Invalid condition: {condition}"
        raise InvalidConditionError(msg)
    return builder(value)


def _get_sequence_filter_func(
    *,
    condition: str,
    value: Sequence[str],
) -> Callable[[str], bool]:
    match condition:
        case "in":
            return _in(value)
        case "not in":
            return _negation(_in(value))
        case _:
            msg = f"Invalid condition: {condition}"
            raise InvalidConditionError(msg)


def _get_number_filter_func(
    *,
    condition: str,
    value: float,
) -> Callable[[int | float], bool]:
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
            msg = f"Invalid condition: {condition}"
            raise InvalidConditionError(msg)


def _get_boolean_filter_func(
    *,
    condition: FilterOperator,
    value: bool,
) -> Callable[[bool], bool]:
    match condition:
        case FilterOperator.IS:
            return _is(value)
        case FilterOperator.IS_NOT:
            return _negation(_is(value))
        case _:
            msg = f"Invalid condition: {condition}"
            raise InvalidConditionError(msg)


def _get_file_filter_func(
    *,
    key: str,
    condition: str,
    value: str | Sequence[str],
) -> Callable[[File], bool]:
    if key in frozenset((
        "name",
        "extension",
        "mime_type",
        "url",
        "related_id",
    )) and isinstance(value, str):
        extract_func = _get_file_extract_string_func(key=key)
        return lambda x: _get_string_filter_func(condition=condition, value=value)(
            extract_func(x),
        )
    if key in frozenset(("type", "transfer_method")):
        extract_func = _get_file_extract_string_func(key=key)
        return lambda x: _get_sequence_filter_func(condition=condition, value=value)(
            extract_func(x),
        )
    if key == "size" and isinstance(value, str):
        extract_number = _get_file_extract_number_func(key=key)
        return lambda x: _get_number_filter_func(
            condition=condition,
            value=float(value),
        )(extract_number(x))
    msg = f"Invalid key: {key}"
    raise InvalidKeyError(msg)


def _contains(value: str) -> Callable[[str], bool]:
    return lambda x: value in x


def _startswith(value: str) -> Callable[[str], bool]:
    return lambda x: x.startswith(value)


def _endswith(value: str) -> Callable[[str], bool]:
    return lambda x: x.endswith(value)


def _is[T](value: T) -> Callable[[T], bool]:
    return lambda x: x == value


def _in(value: str | Sequence[str]) -> Callable[[str], bool]:
    return lambda x: x in value


def _eq(value: float) -> Callable[[int | float], bool]:
    return lambda x: x == value


def _ne(value: float) -> Callable[[int | float], bool]:
    return lambda x: x != value


def _lt(value: float) -> Callable[[int | float], bool]:
    return lambda x: x < value


def _le(value: float) -> Callable[[int | float], bool]:
    return lambda x: x <= value


def _gt(value: float) -> Callable[[int | float], bool]:
    return lambda x: x > value


def _ge(value: float) -> Callable[[int | float], bool]:
    return lambda x: x >= value


def _order_file(
    *,
    order: Order,
    order_by: str = "",
    array: Sequence[File],
) -> list[File]:
    extract_func: Callable[[File], Any]
    if order_by in frozenset((
        "name",
        "type",
        "extension",
        "mime_type",
        "transfer_method",
        "url",
        "related_id",
    )):
        extract_func = _get_file_extract_string_func(key=order_by)
        return sorted(array, key=extract_func, reverse=order == Order.DESC)
    if order_by == "size":
        extract_func = _get_file_extract_number_func(key=order_by)
        return sorted(array, key=extract_func, reverse=order == Order.DESC)
    msg = f"Invalid order key: {order_by}"
    raise InvalidKeyError(msg)
