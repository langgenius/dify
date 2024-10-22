import os
from collections.abc import Mapping, Sequence
from typing import Any, Optional

from core.helper.code_executor.code_executor import CodeExecutionError, CodeExecutor, CodeLanguage
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.template_transform.entities import TemplateTransformNodeData
from models.workflow import WorkflowNodeExecutionStatus

MAX_TEMPLATE_TRANSFORM_OUTPUT_LENGTH = int(os.environ.get("TEMPLATE_TRANSFORM_MAX_LENGTH", "80000"))


class TemplateTransformNode(BaseNode[TemplateTransformNodeData]):
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
            "config": {"variables": [{"variable": "arg1", "value_selector": []}], "template": "{{ arg1 }}"},
        }

    def _run(self) -> NodeRunResult:
        # Get variables
        variables = {}
        for variable_selector in self.node_data.variables:
            variable_name = variable_selector.variable
            value = self.graph_runtime_state.variable_pool.get(variable_selector.value_selector)
            if value is None:
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=f"Variable {variable_name} not found in variable pool",
                )
            variables[variable_name] = value.to_object()
        # Run code
        try:
            result = CodeExecutor.execute_workflow_code_template(
                language=CodeLanguage.JINJA2, code=self.node_data.template, inputs=variables
            )
        except CodeExecutionError as e:
            return NodeRunResult(inputs=variables, status=WorkflowNodeExecutionStatus.FAILED, error=str(e))

        if len(result["result"]) > MAX_TEMPLATE_TRANSFORM_OUTPUT_LENGTH:
            return NodeRunResult(
                inputs=variables,
                status=WorkflowNodeExecutionStatus.FAILED,
                error=f"Output length exceeds {MAX_TEMPLATE_TRANSFORM_OUTPUT_LENGTH} characters",
            )

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=variables, outputs={"output": result["result"]}
        )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls, *, graph_config: Mapping[str, Any], node_id: str, node_data: TemplateTransformNodeData
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        return {
            node_id + "." + variable_selector.variable: variable_selector.value_selector
            for variable_selector in node_data.variables
        }
