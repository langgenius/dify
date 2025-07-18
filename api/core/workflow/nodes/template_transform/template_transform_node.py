import os
from collections.abc import Mapping, Sequence
from typing import Any, Optional

from core.helper.code_executor.code_executor import CodeExecutionError, CodeExecutor, CodeLanguage
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.enums import ErrorStrategy, NodeType
from core.workflow.nodes.template_transform.entities import TemplateTransformNodeData

MAX_TEMPLATE_TRANSFORM_OUTPUT_LENGTH = int(os.environ.get("TEMPLATE_TRANSFORM_MAX_LENGTH", "80000"))


class TemplateTransformNode(BaseNode):
    _node_type = NodeType.TEMPLATE_TRANSFORM

    _node_data: TemplateTransformNodeData

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self._node_data = TemplateTransformNodeData.model_validate(data)

    def _get_error_strategy(self) -> Optional[ErrorStrategy]:
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._node_data.retry_config

    def _get_title(self) -> str:
        return self._node_data.title

    def _get_description(self) -> Optional[str]:
        return self._node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        return self._node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        return self._node_data

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

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        # Get variables
        variables = {}
        for variable_selector in self._node_data.variables:
            variable_name = variable_selector.variable
            value = self.graph_runtime_state.variable_pool.get(variable_selector.value_selector)
            variables[variable_name] = value.to_object() if value else None
        # Run code
        try:
            result = CodeExecutor.execute_workflow_code_template(
                language=CodeLanguage.JINJA2, code=self._node_data.template, inputs=variables
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
