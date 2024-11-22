from typing import Any

from core.variables import SegmentType, Variable
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.variable_operator.common.exc import VariableOperatorNodeError
from models.workflow import WorkflowNodeExecutionStatus

from . import helpers
from .constants import EMPTY_VALUE_MAPPING
from .entities import VariableOperatorNodeData
from .enums import InputType, Operation
from .exc import (
    InputTypeNotSupportedError,
    InvalidInputValueError,
    OperationNotSupportedError,
    VariableNotFoundError,
)


class VariableOperatorNode(BaseNode[VariableOperatorNodeData]):
    _node_data_cls = VariableOperatorNodeData
    _node_type = NodeType.VARIABLE_OPERATOR

    def _run(self) -> NodeRunResult:
        inputs = self.node_data.model_dump()
        process_data = {}
        # NOTE: This node has no outputs
        updated_variables: list[Variable] = []

        try:
            for item in self.node_data.items:
                variable = self.graph_runtime_state.variable_pool.get(item.variable_selector)

                # ==================== Validation Part

                # Check if variable exists
                if not isinstance(variable, Variable):
                    raise VariableNotFoundError(variable_selector=item.variable_selector)

                # Check if operation is supported
                if not helpers.is_operation_supported(variable_type=variable.value_type, operation=item.operation):
                    raise OperationNotSupportedError(operation=item.operation, varialbe_type=variable.value_type)

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
                if item.input_type == InputType.VARIABLE:
                    value = self.graph_runtime_state.variable_pool.get(item.value)
                    if value is None:
                        raise VariableNotFoundError(variable_selector=item.value)
                    # Skip if value is NoneSegment
                    if value.value_type == SegmentType.NONE:
                        continue
                    item.value = value.value

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
                updated_variables.append(variable)
        except VariableOperatorNodeError as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=inputs,
                process_data=process_data,
                error=str(e),
            )

        # Update variables
        for variable in updated_variables:
            self.graph_runtime_state.variable_pool.add(variable.selector, variable)
            process_data[variable.name] = variable.value

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=inputs,
            process_data=process_data,
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
                return variable.value.append(value)
            case Operation.EXTEND:
                return variable.value.extend(value)
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
            case _:
                raise OperationNotSupportedError(operation=operation, varialbe_type=variable.value_type)
