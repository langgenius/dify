from typing import Optional, cast

from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import ValueType, VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.end.entities import EndNodeData, EndNodeDataOutputs
from models.workflow import WorkflowNodeExecutionStatus


class EndNode(BaseNode):
    _node_data_cls = EndNodeData
    node_type = NodeType.END

    def _run(self, variable_pool: Optional[VariablePool] = None,
             run_args: Optional[dict] = None) -> NodeRunResult:
        """
        Run node
        :param variable_pool: variable pool
        :param run_args: run args
        :return:
        """
        node_data = self.node_data
        node_data = cast(self._node_data_cls, node_data)
        outputs_config = node_data.outputs

        if variable_pool is not None:
            outputs = None
            if outputs_config:
                if outputs_config.type == EndNodeDataOutputs.OutputType.PLAIN_TEXT:
                    plain_text_selector = outputs_config.plain_text_selector
                    if plain_text_selector:
                        outputs = {
                            'text': variable_pool.get_variable_value(
                                variable_selector=plain_text_selector,
                                target_value_type=ValueType.STRING
                            )
                        }
                    else:
                        outputs = {
                            'text': ''
                        }
                elif outputs_config.type == EndNodeDataOutputs.OutputType.STRUCTURED:
                    structured_variables = outputs_config.structured_variables
                    if structured_variables:
                        outputs = {}
                        for variable_selector in structured_variables:
                            variable_value = variable_pool.get_variable_value(
                                variable_selector=variable_selector.value_selector
                            )
                            outputs[variable_selector.variable] = variable_value
                    else:
                        outputs = {}
        else:
            raise ValueError("Not support single step debug.")

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=outputs,
            outputs=outputs
        )
