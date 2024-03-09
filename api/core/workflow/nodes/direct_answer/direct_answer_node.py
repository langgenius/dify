import time
from typing import cast

from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import ValueType, VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.direct_answer.entities import DirectAnswerNodeData
from models.workflow import WorkflowNodeExecutionStatus


class DirectAnswerNode(BaseNode):
    _node_data_cls = DirectAnswerNodeData
    node_type = NodeType.DIRECT_ANSWER

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        """
        Run node
        :param variable_pool: variable pool
        :return:
        """
        node_data = self.node_data
        node_data = cast(self._node_data_cls, node_data)

        variable_values = {}
        for variable_selector in node_data.variables:
            value = variable_pool.get_variable_value(
                variable_selector=variable_selector.value_selector,
                target_value_type=ValueType.STRING
            )

            variable_values[variable_selector.variable] = value

        # format answer template
        template_parser = PromptTemplateParser(node_data.answer)
        answer = template_parser.format(variable_values)

        # publish answer as stream
        for word in answer:
            self.publish_text_chunk(word)
            time.sleep(0.01)

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=variable_values,
            outputs={
                "answer": answer
            }
        )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: BaseNodeData) -> dict[list[str], str]:
        """
        Extract variable selector to variable mapping
        :param node_data: node data
        :return:
        """
        return {}
