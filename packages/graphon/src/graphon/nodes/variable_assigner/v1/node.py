from __future__ import annotations

from collections.abc import Generator, Mapping, Sequence
from typing import Any, assert_never, override

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
from graphon.variables.types import SegmentType
from graphon.variables.variables import (
    ArrayAnyVariable,
    ArrayBooleanVariable,
    ArrayFileVariable,
    ArrayNumberVariable,
    ArrayObjectVariable,
    ArrayStringVariable,
)

from .node_data import VariableAssignerData, WriteMode


class VariableAssignerNode(Node[VariableAssignerData]):
    node_type = BuiltinNodeTypes.VARIABLE_ASSIGNER

    @override
    def __init__(
        self,
        node_id: str,
        data: VariableAssignerData,
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
            `True` when the assigned selector is among the requested selectors.

        """
        assigned_selector = tuple(self.node_data.assigned_variable_selector)
        return assigned_selector in variable_selectors

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: VariableAssignerData,
    ) -> Mapping[str, Sequence[str]]:
        _ = graph_config
        mapping = {}
        selector_key = ".".join(node_data.assigned_variable_selector)
        key = f"{node_id}.#{selector_key}#"
        mapping[key] = node_data.assigned_variable_selector

        selector_key = ".".join(node_data.input_variable_selector)
        key = f"{node_id}.#{selector_key}#"
        mapping[key] = node_data.input_variable_selector
        return mapping

    @override
    def _run(self) -> Generator[NodeEventPayload, None, None]:
        assigned_variable_selector = self.node_data.assigned_variable_selector
        # Should be String, Number, Object, ArrayString, ArrayNumber, ArrayObject
        original_variable = self.runtime_state.variable_pool.get_variable(
            assigned_variable_selector,
        )
        if original_variable is None:
            msg = "assigned variable not found"
            raise VariableOperatorNodeError(msg)

        write_mode = self.node_data.write_mode
        match write_mode:
            case WriteMode.OVER_WRITE:
                income_value = self.runtime_state.variable_pool.get(
                    self.node_data.input_variable_selector,
                )
                if not income_value:
                    msg = "input value not found"
                    raise VariableOperatorNodeError(msg)
                updated_variable = original_variable.model_copy(
                    update={"value": income_value.value},
                )

            case WriteMode.APPEND:
                income_value = self.runtime_state.variable_pool.get(
                    self.node_data.input_variable_selector,
                )
                if not income_value:
                    msg = "input value not found"
                    raise VariableOperatorNodeError(msg)
                match original_variable:
                    case (
                        ArrayAnyVariable()
                        | ArrayBooleanVariable()
                        | ArrayFileVariable()
                        | ArrayNumberVariable()
                        | ArrayObjectVariable()
                        | ArrayStringVariable()
                    ):
                        updated_value = [*original_variable.value, income_value.value]
                    case _:
                        msg = "append mode requires an array variable"
                        raise VariableOperatorNodeError(msg)
                updated_variable = original_variable.model_copy(
                    update={"value": updated_value},
                )

            case WriteMode.CLEAR:
                income_value = SegmentType.get_zero_value(original_variable.value_type)
                updated_variable = original_variable.model_copy(
                    update={"value": income_value.to_object()},
                )
            case _:
                assert_never(write_mode)

        updated_variables = [
            common_helpers.variable_to_processed_data(
                assigned_variable_selector,
                updated_variable,
            ),
        ]
        yield VariableUpdatedEvent(variable=updated_variable)
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={
                    "value": income_value.to_object(),
                },
                # NOTE(QuantumGhost): although only one variable is updated in
                # `v1.VariableAssignerNode`, we still set `output_variables` as a
                # list to keep the output schema compatible with
                # `v2.VariableAssignerNode`.
                process_data=common_helpers.set_updated_variables(
                    {},
                    updated_variables,
                ),
                outputs={},
            ),
        )
