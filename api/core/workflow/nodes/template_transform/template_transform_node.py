from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.template_transform.entities import TemplateTransformNodeData
from core.workflow.nodes.template_transform.template_renderer import (
    CodeExecutorJinja2TemplateRenderer,
    Jinja2TemplateRenderer,
    TemplateRenderError,
)

if TYPE_CHECKING:
    from core.workflow.entities import GraphInitParams
    from core.workflow.runtime import GraphRuntimeState

DEFAULT_TEMPLATE_TRANSFORM_MAX_OUTPUT_LENGTH = 400_000


class TemplateTransformNode(Node[TemplateTransformNodeData]):
    node_type = NodeType.TEMPLATE_TRANSFORM
    _template_renderer: Jinja2TemplateRenderer
    _max_output_length: int

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
        *,
        template_renderer: Jinja2TemplateRenderer | None = None,
        max_output_length: int | None = None,
    ) -> None:
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        self._template_renderer = template_renderer or CodeExecutorJinja2TemplateRenderer()

        if max_output_length is not None and max_output_length <= 0:
            raise ValueError("max_output_length must be a positive integer")
        self._max_output_length = max_output_length or DEFAULT_TEMPLATE_TRANSFORM_MAX_OUTPUT_LENGTH

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
            rendered = self._template_renderer.render_template(self.node_data.template, variables)
        except TemplateRenderError as e:
            return NodeRunResult(inputs=variables, status=WorkflowNodeExecutionStatus.FAILED, error=str(e))

        if len(rendered) > self._max_output_length:
            return NodeRunResult(
                inputs=variables,
                status=WorkflowNodeExecutionStatus.FAILED,
                error=f"Output length exceeds {self._max_output_length} characters",
            )

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=variables, outputs={"output": rendered}
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
