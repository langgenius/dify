from collections.abc import Mapping, Sequence
from typing import Any, Literal

from typing_extensions import deprecated

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.if_else.entities import IfElseNodeData
from core.workflow.utils.condition.entities import Condition
from core.workflow.utils.condition.processor import ConditionProcessor


class IfElseNode(BaseNode[IfElseNodeData]):
    _node_data_cls = IfElseNodeData
    _node_type = NodeType.IF_ELSE

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        """
        Run node
        :return:
        """
        node_inputs: dict[str, list] = {"conditions": []}

        process_data: dict[str, list] = {"condition_results": []}

        input_conditions = []
        final_result = False
        selected_case_id = None
        condition_processor = ConditionProcessor()
        try:
            # Check if the new cases structure is used
            if self.node_data.cases:
                for case in self.node_data.cases:
                    input_conditions, group_result, final_result = condition_processor.process_conditions(
                        variable_pool=self.graph_runtime_state.variable_pool,
                        conditions=case.conditions,
                        operator=case.logical_operator,
                    )

                    process_data["condition_results"].append(
                        {
                            "group": case.model_dump(),
                            "results": group_result,
                            "final_result": final_result,
                        }
                    )

                    # Break if a case passes (logical short-circuit)
                    if final_result:
                        selected_case_id = case.case_id  # Capture the ID of the passing case
                        break

            else:
                # TODO: Update database then remove this
                # Fallback to old structure if cases are not defined
                input_conditions, group_result, final_result = _should_not_use_old_function(
                    condition_processor=condition_processor,
                    variable_pool=self.graph_runtime_state.variable_pool,
                    conditions=self.node_data.conditions or [],
                    operator=self.node_data.logical_operator or "and",
                )

                selected_case_id = "true" if final_result else "false"

                process_data["condition_results"].append(
                    {"group": "default", "results": group_result, "final_result": final_result}
                )

            node_inputs["conditions"] = input_conditions

        except Exception as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED, inputs=node_inputs, process_data=process_data, error=str(e)
            )

        outputs = {"result": final_result, "selected_case_id": selected_case_id}

        data = NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=node_inputs,
            process_data=process_data,
            edge_source_handle=selected_case_id or "false",  # Use case ID or 'default'
            outputs=outputs,
        )

        return data

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: IfElseNodeData,
    ) -> Mapping[str, Sequence[str]]:
        var_mapping: dict[str, list[str]] = {}
        for case in node_data.cases or []:
            for condition in case.conditions:
                key = "{}.#{}#".format(node_id, ".".join(condition.variable_selector))
                var_mapping[key] = condition.variable_selector

        return var_mapping


@deprecated("This function is deprecated. You should use the new cases structure.")
def _should_not_use_old_function(
    *,
    condition_processor: ConditionProcessor,
    variable_pool: VariablePool,
    conditions: list[Condition],
    operator: Literal["and", "or"],
):
    return condition_processor.process_conditions(
        variable_pool=variable_pool,
        conditions=conditions,
        operator=operator,
    )
