from typing import cast

from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.if_else.entities import IfElseNodeData
from core.workflow.utils.condition.processor import ConditionAssertionError, ConditionProcessor
from models.workflow import WorkflowNodeExecutionStatus


class IfElseNode(BaseNode):
    _node_data_cls = IfElseNodeData
    node_type = NodeType.IF_ELSE

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        """
        Run node
        :param variable_pool: variable pool
        :return:
        """
        node_data = self.node_data
        node_data = cast(IfElseNodeData, node_data)

        node_inputs: dict[str, list] = {
            "conditions": []
        }

        process_datas: dict[str, list] = {
            "condition_results": []
        }

        try:
            processor = ConditionProcessor()
            compare_result, sub_condition_compare_results = processor.process(
                variable_pool=variable_pool,
                logical_operator=node_data.logical_operator,
                conditions=node_data.conditions,
            )

            node_inputs["conditions"] = [{
                "actual_value": result['actual_value'],
                "expected_value": result['expected_value'],
                "comparison_operator": result['comparison_operator'],
            } for result in sub_condition_compare_results]

            process_datas["condition_results"] = sub_condition_compare_results
        except ConditionAssertionError as e:
            node_inputs["conditions"] = e.conditions
            process_datas["condition_results"] = e.sub_condition_compare_results
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=node_inputs,
                process_data=process_datas,
                error=str(e)
            )
        except Exception as e:
            raise e

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=node_inputs,
            process_data=process_datas,
            edge_source_handle="false" if not compare_result else "true",
            outputs={
                "result": compare_result
            }
        )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: BaseNodeData) -> dict[str, list[str]]:
        """
        Extract variable selector to variable mapping
        :param node_data: node data
        :return:
        """
        return {}
