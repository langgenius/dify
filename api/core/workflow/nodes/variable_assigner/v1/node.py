from core.variables import SegmentType, Variable
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.variable_assigner.common import helpers as common_helpers
from core.workflow.nodes.variable_assigner.common.exc import VariableOperatorNodeError
from factories import variable_factory
from models.workflow import WorkflowNodeExecutionStatus

from .node_data import VariableAssignerData, WriteMode


class VariableAssignerNode(BaseNode[VariableAssignerData]):
    _node_data_cls = VariableAssignerData
    _node_type = NodeType.VARIABLE_ASSIGNER

    def _run(self) -> NodeRunResult:
        # Should be String, Number, Object, ArrayString, ArrayNumber, ArrayObject
        original_variable = self.graph_runtime_state.variable_pool.get(self.node_data.assigned_variable_selector)
        if not isinstance(original_variable, Variable):
            raise VariableOperatorNodeError("assigned variable not found")

        match self.node_data.write_mode:
            case WriteMode.OVER_WRITE:
                income_value = self.graph_runtime_state.variable_pool.get(self.node_data.input_variable_selector)
                if not income_value:
                    raise VariableOperatorNodeError("input value not found")
                updated_variable = original_variable.model_copy(update={"value": income_value.value})

            case WriteMode.APPEND:
                income_value = self.graph_runtime_state.variable_pool.get(self.node_data.input_variable_selector)
                if not income_value:
                    raise VariableOperatorNodeError("input value not found")
                updated_value = original_variable.value + [income_value.value]
                updated_variable = original_variable.model_copy(update={"value": updated_value})

            case WriteMode.CLEAR:
                income_value = get_zero_value(original_variable.value_type)
                if income_value is None:
                    raise VariableOperatorNodeError("income value not found")
                updated_variable = original_variable.model_copy(update={"value": income_value.to_object()})

            case _:
                raise VariableOperatorNodeError(f"unsupported write mode: {self.node_data.write_mode}")

        # Over write the variable.
        self.graph_runtime_state.variable_pool.add(self.node_data.assigned_variable_selector, updated_variable)

        # TODO: Move database operation to the pipeline.
        # Update conversation variable.
        conversation_id = self.graph_runtime_state.variable_pool.get(["sys", "conversation_id"])
        if not conversation_id:
            raise VariableOperatorNodeError("conversation_id not found")
        common_helpers.update_conversation_variable(conversation_id=conversation_id.text, variable=updated_variable)

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={
                "value": income_value.to_object(),
            },
        )


def get_zero_value(t: SegmentType):
    match t:
        case SegmentType.ARRAY_OBJECT | SegmentType.ARRAY_STRING | SegmentType.ARRAY_NUMBER:
            return variable_factory.build_segment([])
        case SegmentType.OBJECT:
            return variable_factory.build_segment({})
        case SegmentType.STRING:
            return variable_factory.build_segment("")
        case SegmentType.NUMBER:
            return variable_factory.build_segment(0)
        case _:
            raise VariableOperatorNodeError(f"unsupported variable type: {t}")
