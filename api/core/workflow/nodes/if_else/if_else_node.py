from collections.abc import Mapping, Sequence
from typing import Any, cast

from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.if_else.entities import IfElseNodeData
from core.workflow.utils.condition.processor import ConditionProcessor
from models.workflow import WorkflowNodeExecutionStatus


class IfElseNode(BaseNode):
    _node_data_cls = IfElseNodeData
    _node_type = NodeType.IF_ELSE

    def _run(self) -> NodeRunResult:
        """
        Run node
        :return:
        """
        node_data = self.node_data
        node_data = cast(IfElseNodeData, node_data)

        node_inputs: dict[str, list] = {"conditions": []}

        process_datas: dict[str, list] = {"condition_results": []}

        input_conditions = []
        final_result = False
        selected_case_id = None
        condition_processor = ConditionProcessor()
        try:
            # Check if the new cases structure is used
            if node_data.cases:
                for case in node_data.cases:
                    input_conditions, group_result = condition_processor.process_conditions(
                        variable_pool=self.graph_runtime_state.variable_pool, conditions=case.conditions
                    )

                    # Apply the logical operator for the current case
                    final_result = all(group_result) if case.logical_operator == "and" else any(group_result)

                    process_datas["condition_results"].append(
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
                # Fallback to old structure if cases are not defined
                input_conditions, group_result = condition_processor.process_conditions(
                    variable_pool=self.graph_runtime_state.variable_pool, conditions=node_data.conditions
                )

                final_result = all(group_result) if node_data.logical_operator == "and" else any(group_result)

                selected_case_id = "true" if final_result else "false"

                process_datas["condition_results"].append(
                    {"group": "default", "results": group_result, "final_result": final_result}
                )

            node_inputs["conditions"] = input_conditions

        except Exception as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED, inputs=node_inputs, process_data=process_datas, error=str(e)
            )

        outputs = {"result": final_result, "selected_case_id": selected_case_id}

        data = NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=node_inputs,
            process_data=process_datas,
            edge_source_handle=selected_case_id or "false",  # Use case ID or 'default'
            outputs=outputs,
        )

        return data

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls, graph_config: Mapping[str, Any], node_id: str, node_data: IfElseNodeData
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        return {}
