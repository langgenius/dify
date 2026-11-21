from __future__ import annotations

import json
from collections.abc import Generator, Mapping, MutableMapping, Sequence
from typing import Any, override

from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.node_events.base import (
    NodeEventPayload,
    NodeRunResult,
)
from graphon.node_events.node import (
    StreamCompletedEvent,
    VariableUpdatedEvent,
)
from graphon.nodes.base.node import Node
from graphon.nodes.variable_assigner.common import helpers as common_helpers
from graphon.nodes.variable_assigner.common.exc import VariableOperatorNodeError
from graphon.runtime.init_params import InitParams
from graphon.runtime.runtime_state import RuntimeState
from graphon.variables.consts import SELECTORS_LENGTH
from graphon.variables.types import SegmentType
from graphon.variables.variables import VariableBase

from . import helpers
from .entities import VariableAssignerNodeData, VariableOperationItem
from .enums import InputType, Operation
from .exc import (
    InputTypeNotSupportedError,
    InvalidDataError,
    InvalidInputValueError,
    OperationNotSupportedError,
    VariableNotFoundError,
)

_SKIP_VARIABLE_UPDATE = object()


def _target_mapping_from_item(
    mapping: MutableMapping[str, Sequence[str]],
    node_id: str,
    item: VariableOperationItem,
) -> None:
    selector_str = ".".join(item.variable_selector)
    key = f"{node_id}.#{selector_str}#"
    mapping[key] = item.variable_selector


def _source_mapping_from_item(
    mapping: MutableMapping[str, Sequence[str]],
    node_id: str,
    item: VariableOperationItem,
) -> None:
    # Keep this in sync with the logic in _run methods...
    if item.input_type != InputType.VARIABLE:
        return
    selector = item.value
    if not isinstance(selector, list):
        msg = f"selector is not a list, {node_id=}, {item=}"
        raise InvalidDataError(msg)
    if len(selector) < SELECTORS_LENGTH:
        msg = f"selector too short, {node_id=}, {item=}"
        raise InvalidDataError(msg)
    selector_str = ".".join(selector)
    key = f"{node_id}.#{selector_str}#"
    mapping[key] = selector


def _trim_array_edge(*, value: Sequence[Any], remove_first: bool) -> Sequence[Any]:
    if not value:
        return value
    return value[1:] if remove_first else value[:-1]


class VariableAssignerNode(Node[VariableAssignerNodeData]):
    node_type = BuiltinNodeTypes.VARIABLE_ASSIGNER

    @override
    def __init__(
        self,
        node_id: str,
        data: VariableAssignerNodeData,
        *,
        init_params: InitParams,
        runtime_state: RuntimeState,
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            init_params=init_params,
            runtime_state=runtime_state,
        )

    @override
    def blocks_variable_output(self, variable_selectors: set[tuple[str, ...]]) -> bool:
        """Check if this Variable Assigner node blocks the output of specific variables.

        Returns True if this node updates any of the requested conversation variables.

        Returns:
            `True` when any assigned selector is among the requested selectors.

        """
        # Check each item in this Variable Assigner node
        for item in self.node_data.items:
            # Convert the item's variable_selector to tuple for comparison
            item_selector_tuple = tuple(item.variable_selector)

            # Check if this item updates any of the requested variables
            if item_selector_tuple in variable_selectors:
                return True

        return False

    @classmethod
    @override
    def version(cls) -> str:
        return "2"

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: VariableAssignerNodeData,
    ) -> Mapping[str, Sequence[str]]:
        _ = graph_config
        var_mapping: dict[str, Sequence[str]] = {}
        for item in node_data.items:
            _target_mapping_from_item(var_mapping, node_id, item)
            _source_mapping_from_item(var_mapping, node_id, item)
        return var_mapping

    @override
    def _run(self) -> Generator[NodeEventPayload, None, None]:
        inputs = self.node_data.model_dump()
        process_data: dict[str, Any] = {}
        # NOTE: This node has no outputs
        updated_variable_selectors: list[Sequence[str]] = []
        # Preserve intra-node read-after-write behavior without mutating the shared pool
        # until the engine processes the emitted VariableUpdatedEvent instances.
        working_variable_pool = self.runtime_state.variable_pool.model_copy(
            deep=True,
        )

        try:
            for item in self.node_data.items:
                updated_selector = self._apply_item(
                    item=item,
                    working_variable_pool=working_variable_pool,
                )
                if updated_selector is not None:
                    updated_variable_selectors.append(updated_selector)
        except VariableOperatorNodeError as e:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=inputs,
                    process_data=process_data,
                    error=str(e),
                ),
            )
            return

        # The `updated_variable_selectors` is a list containing list[str], which
        # is not hashable.
        # remove duplicated items while preserving the first update order.
        updated_variable_selectors = list(
            dict.fromkeys(map(tuple, updated_variable_selectors)),
        )

        for selector in updated_variable_selectors:
            variable = working_variable_pool.get_variable(selector)
            if variable is None:
                raise VariableNotFoundError(variable_selector=selector)
            process_data[variable.name] = variable.value

        updated_variables = [
            common_helpers.variable_to_processed_data(selector, seg)
            for selector in updated_variable_selectors
            if (seg := working_variable_pool.get(selector)) is not None
        ]

        process_data = common_helpers.set_updated_variables(
            process_data,
            updated_variables,
        )
        for selector in updated_variable_selectors:
            variable = working_variable_pool.get_variable(selector)
            if variable is None:
                raise VariableNotFoundError(variable_selector=selector)
            yield VariableUpdatedEvent(variable=variable)

        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs=inputs,
                process_data=process_data,
                outputs={},
            ),
        )

    def _apply_item(
        self,
        *,
        item: VariableOperationItem,
        working_variable_pool: Any,
    ) -> Sequence[str] | None:
        variable = working_variable_pool.get(item.variable_selector)
        if not isinstance(variable, VariableBase):
            raise VariableNotFoundError(variable_selector=item.variable_selector)
        self._validate_item_support(variable=variable, item=item)
        input_value = self._resolve_item_input_value(
            variable=variable,
            item=item,
            working_variable_pool=working_variable_pool,
        )
        if input_value is _SKIP_VARIABLE_UPDATE:
            return None

        if not helpers.is_input_value_valid(
            variable_type=variable.value_type,
            operation=item.operation,
            value=input_value,
        ):
            raise InvalidInputValueError(value=input_value)

        updated_value = self._handle_item(
            variable=variable,
            operation=item.operation,
            value=input_value,
        )
        updated_variable = variable.model_copy(update={"value": updated_value})
        working_variable_pool.add(updated_variable.selector, updated_variable)
        return updated_variable.selector

    @staticmethod
    def _validate_item_support(
        *,
        variable: VariableBase,
        item: VariableOperationItem,
    ) -> None:
        if not helpers.is_operation_supported(
            variable_type=variable.value_type,
            operation=item.operation,
        ):
            raise OperationNotSupportedError(
                operation=item.operation,
                variable_type=variable.value_type,
            )
        if item.input_type == InputType.VARIABLE:
            if helpers.is_variable_input_supported(operation=item.operation):
                return
            raise InputTypeNotSupportedError(
                input_type=InputType.VARIABLE,
                operation=item.operation,
            )
        if item.input_type == InputType.CONSTANT and not (
            helpers.is_constant_input_supported(
                variable_type=variable.value_type,
                operation=item.operation,
            )
        ):
            raise InputTypeNotSupportedError(
                input_type=InputType.CONSTANT,
                operation=item.operation,
            )

    def _resolve_item_input_value(
        self,
        *,
        variable: VariableBase,
        item: VariableOperationItem,
        working_variable_pool: Any,
    ) -> Any:
        input_value = item.value
        if self._should_read_input_from_variable(item):
            value = working_variable_pool.get(item.value)
            if value is None:
                raise VariableNotFoundError(variable_selector=item.value)
            if value.value_type == SegmentType.NONE:
                return _SKIP_VARIABLE_UPDATE
            input_value = value.value

        if (
            item.operation == Operation.SET
            and variable.value_type == SegmentType.OBJECT
            and isinstance(input_value, str | bytes | bytearray)
        ):
            try:
                return json.loads(input_value)
            except json.JSONDecodeError as error:
                raise InvalidInputValueError(value=input_value) from error
        return input_value

    @staticmethod
    def _should_read_input_from_variable(item: VariableOperationItem) -> bool:
        return (
            item.input_type == InputType.VARIABLE
            and item.operation
            not in frozenset((
                Operation.CLEAR,
                Operation.REMOVE_FIRST,
                Operation.REMOVE_LAST,
            ))
            and item.value is not None
        )

    def _handle_item(
        self,
        *,
        variable: VariableBase,
        operation: Operation,
        value: Any,
    ) -> Any:
        match operation:
            case Operation.OVER_WRITE | Operation.SET:
                result = value
            case Operation.CLEAR:
                result = SegmentType.get_zero_value(variable.value_type).to_object()
            case Operation.APPEND:
                result = [*variable.value, value]
            case Operation.EXTEND | Operation.ADD:
                result = variable.value + value
            case Operation.SUBTRACT:
                result = variable.value - value
            case Operation.MULTIPLY:
                result = variable.value * value
            case Operation.DIVIDE:
                result = variable.value / value
            case Operation.REMOVE_FIRST:
                result = _trim_array_edge(value=variable.value, remove_first=True)
            case Operation.REMOVE_LAST:
                result = _trim_array_edge(value=variable.value, remove_first=False)
        return result
