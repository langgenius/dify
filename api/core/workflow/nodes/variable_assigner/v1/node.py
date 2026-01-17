from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

from core.variables import SegmentType, VariableBase
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID
from core.workflow.entities import GraphInitParams
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.variable_assigner.common import helpers as common_helpers
from core.workflow.nodes.variable_assigner.common.exc import VariableOperatorNodeError

from .node_data import VariableAssignerData, WriteMode

if TYPE_CHECKING:
    from core.workflow.runtime import GraphRuntimeState


class VariableAssignerNode(Node[VariableAssignerData]):
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
        assigned_selector = tuple(self.node_data.assigned_variable_selector)
        return assigned_selector in variable_selectors

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
        assigned_variable_selector = self.node_data.assigned_variable_selector
        # Should be String, Number, Object, ArrayString, ArrayNumber, ArrayObject
        original_variable = self.graph_runtime_state.variable_pool.get(assigned_variable_selector)
        if not isinstance(original_variable, VariableBase):
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
                income_value = SegmentType.get_zero_value(original_variable.value_type)
                updated_variable = original_variable.model_copy(update={"value": income_value.to_object()})

        # Over write the variable.
        self.graph_runtime_state.variable_pool.add(assigned_variable_selector, updated_variable)

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
