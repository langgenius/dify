from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, override

from graphon.enums import (
    BuiltinNodeTypes,
    NodeExecutionType,
    WorkflowNodeExecutionStatus,
)
from graphon.node_events.base import NodeRunResult
from graphon.nodes.base.node import Node
from graphon.nodes.if_else.entities import IfElseNodeData
from graphon.utils.condition.processor import ConditionProcessor


@dataclass(slots=True)
class _IfElseEvaluation:
    node_inputs: dict[str, Sequence[Mapping[str, Any]]] = field(
        default_factory=lambda: {"conditions": []},
    )
    process_data: dict[str, list[dict[str, Any]]] = field(
        default_factory=lambda: {"condition_results": []},
    )
    final_result: bool = False
    selected_case_id: str = "false"


class IfElseNode(Node[IfElseNodeData]):
    node_type = BuiltinNodeTypes.IF_ELSE
    execution_type = NodeExecutionType.BRANCH

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(self) -> NodeRunResult:
        """Evaluate the configured cases and return the matching branch result."""
        evaluation = _IfElseEvaluation()
        condition_processor = ConditionProcessor()
        try:
            self._evaluate_cases(condition_processor, evaluation)
        except (TypeError, ValueError) as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=evaluation.node_inputs,
                process_data=evaluation.process_data,
                error=str(e),
            )

        outputs = {
            "result": evaluation.final_result,
            "selected_case_id": evaluation.selected_case_id,
        }

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=evaluation.node_inputs,
            process_data=evaluation.process_data,
            edge_source_handle=evaluation.selected_case_id or "false",
            outputs=outputs,
        )

    def _evaluate_cases(
        self,
        condition_processor: ConditionProcessor,
        evaluation: _IfElseEvaluation,
    ) -> None:
        input_conditions: Sequence[Mapping[str, Any]] = []
        uses_legacy_shape = self.node_data.cases is None
        for case in self.node_data.iter_cases():
            input_conditions, group_result, final_result = (
                condition_processor.process_conditions(
                    variable_pool=self.runtime_state.variable_pool,
                    conditions=case.conditions,
                    operator=case.logical_operator,
                )
            )

            evaluation.process_data["condition_results"].append({
                "group": "default" if uses_legacy_shape else case.model_dump(),
                "results": group_result,
                "final_result": final_result,
            })

            if final_result:
                evaluation.final_result = final_result
                evaluation.selected_case_id = (
                    "true" if uses_legacy_shape else case.case_id
                )
                break

        evaluation.node_inputs["conditions"] = input_conditions

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: IfElseNodeData,
    ) -> Mapping[str, Sequence[str]]:
        var_mapping: dict[str, list[str]] = {}
        _ = graph_config  # Explicitly mark as unused
        for case in node_data.iter_cases():
            for condition in case.conditions:
                key = f"{node_id}.#{'.'.join(condition.variable_selector)}#"
                var_mapping[key] = condition.variable_selector

        return var_mapping
