from collections.abc import Mapping, Sequence
from typing import Any

from configs import dify_config
from core.helper.code_executor.code_executor import CodeExecutionError, CodeExecutor, CodeLanguage
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.template_transform.entities import TemplateTransformNodeData

MAX_TEMPLATE_TRANSFORM_OUTPUT_LENGTH = dify_config.TEMPLATE_TRANSFORM_MAX_LENGTH


class TemplateTransformNode(Node[TemplateTransformNodeData]):
    node_type = NodeType.TEMPLATE_TRANSFORM

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
        """
        Get default config of node.
        :param filters: filter by node config parameters.
        :return:
        """
        return {
            "type": "template-transform",
            "config": {"variables": [{"variable": "arg1", "value_selector": []}], "template": "{{ arg1 }}"},
        }

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        # Get variables
        variables: dict[str, Any] = {}
        for variable_selector in self.node_data.variables:
            variable_name = variable_selector.variable
            value = self.graph_runtime_state.variable_pool.get(variable_selector.value_selector)
            variables[variable_name] = value.to_object() if value else None
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
        cls, *, graph_config: Mapping[str, Any], node_id: str, node_data: Mapping[str, Any]
    ) -> Mapping[str, Sequence[str]]:
        # Create typed NodeData from dict
        typed_node_data = TemplateTransformNodeData.model_validate(node_data)

        return {
            node_id + "." + variable_selector.variable: variable_selector.value_selector
            for variable_selector in typed_node_data.variables
        }
