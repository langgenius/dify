import json
from collections.abc import Mapping, MutableMapping, Sequence
from typing import TYPE_CHECKING, Any

from core.variables import SegmentType, VariableBase
from core.variables.consts import SELECTORS_LENGTH
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.variable_assigner.common import helpers as common_helpers
from core.workflow.nodes.variable_assigner.common.exc import VariableOperatorNodeError

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

if TYPE_CHECKING:
    from core.workflow.entities import GraphInitParams
    from core.workflow.runtime import GraphRuntimeState


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


class VariableAssignerNode(Node[VariableAssignerNodeData]):
    node_type = NodeType.VARIABLE_ASSIGNER

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
    ):
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )

    def blocks_variable_output(self, variable_selectors: set[tuple[str, ...]]) -> bool:
        """
        Check if this Variable Assigner node blocks the output of specific variables.

        Returns True if this node updates any of the requested conversation variables.
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
        inputs = self.node_data.model_dump()
        process_data: dict[str, Any] = {}
        # NOTE: This node has no outputs
        updated_variable_selectors: list[Sequence[str]] = []

        try:
            for item in self.node_data.items:
                variable = self.graph_runtime_state.variable_pool.get(item.variable_selector)

                # ==================== Validation Part

                # Check if variable exists
                if not isinstance(variable, VariableBase):
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

        for selector in updated_variable_selectors:
            variable = self.graph_runtime_state.variable_pool.get(selector)
            if not isinstance(variable, VariableBase):
                raise VariableNotFoundError(variable_selector=selector)
            process_data[variable.name] = variable.value

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
        variable: VariableBase,
        operation: Operation,
        value: Any,
    ):
        match operation:
            case Operation.OVER_WRITE:
                return value
            case Operation.CLEAR:
                return SegmentType.get_zero_value(variable.value_type).to_object()
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
