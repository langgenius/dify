import json
from collections.abc import Mapping, MutableMapping, Sequence
from typing import Any, cast

from core.app.entities.app_invoke_entities import InvokeFrom
from core.variables import SegmentType, Variable
from core.variables.consts import SELECTORS_LENGTH
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID
from core.workflow.conversation_variable_updater import ConversationVariableUpdater
from core.workflow.enums import ErrorStrategy, NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.variable_assigner.common import helpers as common_helpers
from core.workflow.nodes.variable_assigner.common.exc import VariableOperatorNodeError
from core.workflow.nodes.variable_assigner.common.impl import conversation_variable_updater_factory

from . import helpers
from .constants import EMPTY_VALUE_MAPPING
from .entities import VariableAssignerNodeData, VariableOperationItem
from .enums import InputType, Operation
from .exc import (
    ConversationIDNotFoundError,
    InputTypeNotSupportedError,
    InvalidDataError,
    InvalidInputValueError,
    OperationNotSupportedError,
    VariableNotFoundError,
)


def _target_mapping_from_item(mapping: MutableMapping[str, Sequence[str]], node_id: str, item: VariableOperationItem):
    selector_node_id = item.variable_selector[0]
    if selector_node_id != CONVERSATION_VARIABLE_NODE_ID:
        return
    selector_str = ".".join(item.variable_selector)
    key = f"{node_id}.#{selector_str}#"
    mapping[key] = item.variable_selector


def _source_mapping_from_item(mapping: MutableMapping[str, Sequence[str]], node_id: str, item: VariableOperationItem):
    # Keep this in sync with the logic in _run methods...
    if item.input_type != InputType.VARIABLE:
        return
    selector = item.value
    if not isinstance(selector, list):
        raise InvalidDataError(f"selector is not a list, {node_id=}, {item=}")
    if len(selector) < SELECTORS_LENGTH:
        raise InvalidDataError(f"selector too short, {node_id=}, {item=}")
    selector_str = ".".join(selector)
    key = f"{node_id}.#{selector_str}#"
    mapping[key] = selector


class VariableAssignerNode(Node):
    node_type = NodeType.VARIABLE_ASSIGNER

    _node_data: VariableAssignerNodeData

    def init_node_data(self, data: Mapping[str, Any]):
        self._node_data = VariableAssignerNodeData.model_validate(data)

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

    def blocks_variable_output(self, variable_selectors: set[tuple[str, ...]]) -> bool:
        """
        Check if this Variable Assigner node blocks the output of specific variables.

        Returns True if this node updates any of the requested conversation variables.
        """
        # Check each item in this Variable Assigner node
        for item in self._node_data.items:
            # Convert the item's variable_selector to tuple for comparison
            item_selector_tuple = tuple(item.variable_selector)

            # Check if this item updates any of the requested variables
            if item_selector_tuple in variable_selectors:
                return True

        return False

    def _conv_var_updater_factory(self) -> ConversationVariableUpdater:
        return conversation_variable_updater_factory()

    @classmethod
    def version(cls) -> str:
        return "2"

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        # Create typed NodeData from dict
        typed_node_data = VariableAssignerNodeData.model_validate(node_data)

        var_mapping: dict[str, Sequence[str]] = {}
        for item in typed_node_data.items:
            _target_mapping_from_item(var_mapping, node_id, item)
            _source_mapping_from_item(var_mapping, node_id, item)
        return var_mapping

    def _run(self) -> NodeRunResult:
        inputs = self._node_data.model_dump()
        process_data: dict[str, Any] = {}
        # NOTE: This node has no outputs
        updated_variable_selectors: list[Sequence[str]] = []

        try:
            for item in self._node_data.items:
                variable = self.graph_runtime_state.variable_pool.get(item.variable_selector)

                # ==================== Validation Part

                # Check if variable exists
                if not isinstance(variable, Variable):
                    raise VariableNotFoundError(variable_selector=item.variable_selector)

                # Check if operation is supported
                if not helpers.is_operation_supported(variable_type=variable.value_type, operation=item.operation):
                    raise OperationNotSupportedError(operation=item.operation, variable_type=variable.value_type)

                # Check if variable input is supported
                if item.input_type == InputType.VARIABLE and not helpers.is_variable_input_supported(
                    operation=item.operation
                ):
                    raise InputTypeNotSupportedError(input_type=InputType.VARIABLE, operation=item.operation)

                # Check if constant input is supported
                if item.input_type == InputType.CONSTANT and not helpers.is_constant_input_supported(
                    variable_type=variable.value_type, operation=item.operation
                ):
                    raise InputTypeNotSupportedError(input_type=InputType.CONSTANT, operation=item.operation)

                # Get value from variable pool
                if (
                    item.input_type == InputType.VARIABLE
                    and item.operation not in {Operation.CLEAR, Operation.REMOVE_FIRST, Operation.REMOVE_LAST}
                    and item.value is not None
                ):
                    value = self.graph_runtime_state.variable_pool.get(item.value)
                    if value is None:
                        raise VariableNotFoundError(variable_selector=item.value)
                    # Skip if value is NoneSegment
                    if value.value_type == SegmentType.NONE:
                        continue
                    item.value = value.value

                # If set string / bytes / bytearray to object, try convert string to object.
                if (
                    item.operation == Operation.SET
                    and variable.value_type == SegmentType.OBJECT
                    and isinstance(item.value, str | bytes | bytearray)
                ):
                    try:
                        item.value = json.loads(item.value)
                    except json.JSONDecodeError:
                        raise InvalidInputValueError(value=item.value)

                # Check if input value is valid
                if not helpers.is_input_value_valid(
                    variable_type=variable.value_type, operation=item.operation, value=item.value
                ):
                    raise InvalidInputValueError(value=item.value)

                # ==================== Execution Part

                updated_value = self._handle_item(
                    variable=variable,
                    operation=item.operation,
                    value=item.value,
                )
                variable = variable.model_copy(update={"value": updated_value})
                self.graph_runtime_state.variable_pool.add(variable.selector, variable)
                updated_variable_selectors.append(variable.selector)
        except VariableOperatorNodeError as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=inputs,
                process_data=process_data,
                error=str(e),
            )

        # The `updated_variable_selectors` is a list contains list[str] which not hashable,
        # remove the duplicated items first.
        updated_variable_selectors = list(set(map(tuple, updated_variable_selectors)))

        conv_var_updater = self._conv_var_updater_factory()
        # Update variables
        for selector in updated_variable_selectors:
            variable = self.graph_runtime_state.variable_pool.get(selector)
            if not isinstance(variable, Variable):
                raise VariableNotFoundError(variable_selector=selector)
            process_data[variable.name] = variable.value

            if variable.selector[0] == CONVERSATION_VARIABLE_NODE_ID:
                conversation_id = self.graph_runtime_state.variable_pool.get(["sys", "conversation_id"])
                if not conversation_id:
                    if self.invoke_from != InvokeFrom.DEBUGGER:
                        raise ConversationIDNotFoundError
                else:
                    conversation_id = conversation_id.value
                    conv_var_updater.update(
                        conversation_id=cast(str, conversation_id),
                        variable=variable,
                    )
        conv_var_updater.flush()
        updated_variables = [
            common_helpers.variable_to_processed_data(selector, seg)
            for selector in updated_variable_selectors
            if (seg := self.graph_runtime_state.variable_pool.get(selector)) is not None
        ]

        process_data = common_helpers.set_updated_variables(process_data, updated_variables)
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=inputs,
            process_data=process_data,
            outputs={},
        )

    def _handle_item(
        self,
        *,
        variable: Variable,
        operation: Operation,
        value: Any,
    ):
        match operation:
            case Operation.OVER_WRITE:
                return value
            case Operation.CLEAR:
                return EMPTY_VALUE_MAPPING[variable.value_type]
            case Operation.APPEND:
                return variable.value + [value]
            case Operation.EXTEND:
                return variable.value + value
            case Operation.SET:
                return value
            case Operation.ADD:
                return variable.value + value
            case Operation.SUBTRACT:
                return variable.value - value
            case Operation.MULTIPLY:
                return variable.value * value
            case Operation.DIVIDE:
                return variable.value / value
            case Operation.REMOVE_FIRST:
                # If array is empty, do nothing
                if not variable.value:
                    return variable.value
                return variable.value[1:]
            case Operation.REMOVE_LAST:
                # If array is empty, do nothing
                if not variable.value:
                    return variable.value
                return variable.value[:-1]
