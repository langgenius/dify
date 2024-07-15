import os
from typing import Optional, cast

from core.helper.code_executor.code_executor import CodeExecutionException, CodeExecutor, CodeLanguage
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.template_transform.entities import TemplateTransformNodeData
from models.workflow import WorkflowNodeExecutionStatus

MAX_TEMPLATE_TRANSFORM_OUTPUT_LENGTH = int(os.environ.get('TEMPLATE_TRANSFORM_MAX_LENGTH', '80000'))

class TemplateTransformNode(BaseNode):
    _node_data_cls = TemplateTransformNodeData
    _node_type = NodeType.TEMPLATE_TRANSFORM

    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        """
        Get default config of node.
        :param filters: filter by node config parameters.
        :return:
        """
        return {
            "type": "template-transform",
            "config": {
                "variables": [
                    {
                        "variable": "arg1",
                        "value_selector": []
                    }
                ],
                "template": "{{ arg1 }}"
            }
        }

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        """
        Run node
        """
        node_data = self.node_data
        node_data: TemplateTransformNodeData = cast(self._node_data_cls, node_data)

        # Get variables
        variables = {}
        for variable_selector in node_data.variables:
            variable_name = variable_selector.variable
            value = variable_pool.get_any(variable_selector.value_selector)
            variables[variable_name] = value
        # Run code
        try:
            result = CodeExecutor.execute_workflow_code_template(
                language=CodeLanguage.JINJA2,
                code=node_data.template,
                inputs=variables
            )
        except CodeExecutionException as e:
            return NodeRunResult(
                inputs=variables,
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e)
            )
        
        if len(result['result']) > MAX_TEMPLATE_TRANSFORM_OUTPUT_LENGTH:
            return NodeRunResult(
                inputs=variables,
                status=WorkflowNodeExecutionStatus.FAILED,
                error=f"Output length exceeds {MAX_TEMPLATE_TRANSFORM_OUTPUT_LENGTH} characters"
            )

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=variables,
            outputs={
                'output': result['result']
            }
        )
    
    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: TemplateTransformNodeData) -> dict[str, list[str]]:
        """
        Extract variable selector to variable mapping
        :param node_data: node data
        :return:
        """
        return {
            variable_selector.variable: variable_selector.value_selector for variable_selector in node_data.variables
        }