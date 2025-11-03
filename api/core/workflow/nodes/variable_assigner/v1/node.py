from collections.abc import Callable, Mapping, Sequence
from typing import TYPE_CHECKING, Any, TypeAlias

from core.variables import SegmentType, Variable
from core.variables.segments import BooleanSegment
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID
from core.workflow.conversation_variable_updater import ConversationVariableUpdater
from core.workflow.entities import GraphInitParams
from core.workflow.enums import ErrorStrategy, NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.variable_assigner.common import helpers as common_helpers
from core.workflow.nodes.variable_assigner.common.exc import VariableOperatorNodeError
from factories import variable_factory

from ..common.impl import conversation_variable_updater_factory
from .node_data import VariableAssignerData, WriteMode

if TYPE_CHECKING:
    from core.workflow.runtime import GraphRuntimeState


_CONV_VAR_UPDATER_FACTORY: TypeAlias = Callable[[], ConversationVariableUpdater]


class VariableAssignerNode(Node):
    node_type = NodeType.VARIABLE_ASSIGNER
    _conv_var_updater_factory: _CONV_VAR_UPDATER_FACTORY

    _node_data: VariableAssignerData

    def init_node_data(self, data: Mapping[str, Any]):
        self._node_data = VariableAssignerData.model_validate(data)

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

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
        conv_var_updater_factory: _CONV_VAR_UPDATER_FACTORY = conversation_variable_updater_factory,
    ):
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        self._conv_var_updater_factory = conv_var_updater_factory

    @classmethod
    def version(cls) -> str:
        return "1"

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        # Create typed NodeData from dict
        typed_node_data = VariableAssignerData.model_validate(node_data)

        mapping = {}
        assigned_variable_node_id = typed_node_data.assigned_variable_selector[0]
        if assigned_variable_node_id == CONVERSATION_VARIABLE_NODE_ID:
            selector_key = ".".join(typed_node_data.assigned_variable_selector)
            key = f"{node_id}.#{selector_key}#"
            mapping[key] = typed_node_data.assigned_variable_selector

        selector_key = ".".join(typed_node_data.input_variable_selector)
        key = f"{node_id}.#{selector_key}#"
        mapping[key] = typed_node_data.input_variable_selector
        return mapping

    def _run(self) -> NodeRunResult:
        assigned_variable_selector = self._node_data.assigned_variable_selector
        # Should be String, Number, Object, ArrayString, ArrayNumber, ArrayObject
        original_variable = self.graph_runtime_state.variable_pool.get(assigned_variable_selector)
        if not isinstance(original_variable, Variable):
            raise VariableOperatorNodeError("assigned variable not found")

        match self._node_data.write_mode:
            case WriteMode.OVER_WRITE:
                income_value = self.graph_runtime_state.variable_pool.get(self._node_data.input_variable_selector)
                if not income_value:
                    raise VariableOperatorNodeError("input value not found")
                updated_variable = original_variable.model_copy(update={"value": income_value.value})

            case WriteMode.APPEND:
                income_value = self.graph_runtime_state.variable_pool.get(self._node_data.input_variable_selector)
                if not income_value:
                    raise VariableOperatorNodeError("input value not found")
                updated_value = original_variable.value + [income_value.value]
                updated_variable = original_variable.model_copy(update={"value": updated_value})

            case WriteMode.CLEAR:
                income_value = get_zero_value(original_variable.value_type)
                updated_variable = original_variable.model_copy(update={"value": income_value.to_object()})

        # Over write the variable.
        self.graph_runtime_state.variable_pool.add(assigned_variable_selector, updated_variable)

        # TODO: Move database operation to the pipeline.
        # Update conversation variable.
        conversation_id = self.graph_runtime_state.variable_pool.get(["sys", "conversation_id"])
        if not conversation_id:
            raise VariableOperatorNodeError("conversation_id not found")
        conv_var_updater = self._conv_var_updater_factory()
        conv_var_updater.update(conversation_id=conversation_id.text, variable=updated_variable)
        conv_var_updater.flush()
        updated_variables = [common_helpers.variable_to_processed_data(assigned_variable_selector, updated_variable)]

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={
                "value": income_value.to_object(),
            },
            # NOTE(QuantumGhost): although only one variable is updated in `v1.VariableAssignerNode`,
            # we still set `output_variables` as a list to ensure the schema of output is
            # compatible with `v2.VariableAssignerNode`.
            process_data=common_helpers.set_updated_variables({}, updated_variables),
            outputs={},
        )


def get_zero_value(t: SegmentType):
    # TODO(QuantumGhost): this should be a method of `SegmentType`.
    match t:
        case SegmentType.ARRAY_OBJECT | SegmentType.ARRAY_STRING | SegmentType.ARRAY_NUMBER | SegmentType.ARRAY_BOOLEAN:
            return variable_factory.build_segment_with_type(t, [])
        case SegmentType.OBJECT:
            return variable_factory.build_segment({})
        case SegmentType.STRING:
            return variable_factory.build_segment("")
        case SegmentType.INTEGER:
            return variable_factory.build_segment(0)
        case SegmentType.FLOAT:
            return variable_factory.build_segment(0.0)
        case SegmentType.NUMBER:
            return variable_factory.build_segment(0)
        case SegmentType.BOOLEAN:
            return BooleanSegment(value=False)
        case _:
            raise VariableOperatorNodeError(f"unsupported variable type: {t}")
