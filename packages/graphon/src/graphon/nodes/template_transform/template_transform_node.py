from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, override

from typing_extensions import TypeIs

from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.node_events.base import NodeRunResult
from graphon.nodes.base.entities import VariableSelector
from graphon.nodes.base.node import Node
from graphon.nodes.template_transform.entities import TemplateTransformNodeData
from graphon.runtime.init_params import InitParams
from graphon.runtime.runtime_state import RuntimeState
from graphon.template_rendering import (
    Jinja2TemplateRenderer,
    TemplateRenderError,
)

DEFAULT_TEMPLATE_TRANSFORM_MAX_OUTPUT_LENGTH = 400_000


def _is_string_sequence(value: object) -> TypeIs[Sequence[str]]:
    return (
        isinstance(value, Sequence)
        and not isinstance(value, str)
        and all(isinstance(selector_part, str) for selector_part in value)
    )


class TemplateTransformNode(Node[TemplateTransformNodeData]):
    node_type = BuiltinNodeTypes.TEMPLATE_TRANSFORM
    _jinja2_template_renderer: Jinja2TemplateRenderer
    _max_output_length: int

    @override
    def __init__(
        self,
        node_id: str,
        data: TemplateTransformNodeData,
        *,
        init_params: InitParams,
        runtime_state: RuntimeState,
        jinja2_template_renderer: Jinja2TemplateRenderer,
        max_output_length: int | None = None,
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            init_params=init_params,
            runtime_state=runtime_state,
        )
        self._jinja2_template_renderer = jinja2_template_renderer

        if max_output_length is not None and max_output_length <= 0:
            msg = "max_output_length must be a positive integer"
            raise ValueError(msg)
        self._max_output_length = (
            max_output_length or DEFAULT_TEMPLATE_TRANSFORM_MAX_OUTPUT_LENGTH
        )

    @classmethod
    @override
    def get_default_config(
        cls,
        filters: Mapping[str, object] | None = None,
    ) -> Mapping[str, object]:
        """Build the default template-transform node config."""
        _ = filters
        return {
            "type": "template-transform",
            "config": {
                "variables": [{"variable": "arg1", "value_selector": []}],
                "template": "{{ arg1 }}",
            },
        }

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(self) -> NodeRunResult:
        # Get variables
        variables: dict[str, Any] = {}
        for variable_selector in self.node_data.variables:
            variable_name = variable_selector.variable
            value = self.runtime_state.variable_pool.get(
                variable_selector.value_selector,
            )
            variables[variable_name] = value.to_object() if value else None
        # Run code
        try:
            rendered = self._jinja2_template_renderer.render_template(
                self.node_data.template,
                variables,
            )
        except TemplateRenderError as e:
            return NodeRunResult(
                inputs=variables,
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
            )

        if len(rendered) > self._max_output_length:
            return NodeRunResult(
                inputs=variables,
                status=WorkflowNodeExecutionStatus.FAILED,
                error=f"Output length exceeds {self._max_output_length} characters",
            )

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=variables,
            outputs={"output": rendered},
        )

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: TemplateTransformNodeData | Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        _ = graph_config
        raw_variables = (
            node_data.variables
            if isinstance(node_data, TemplateTransformNodeData)
            else node_data.get("variables", [])
        )
        variable_mapping: dict[str, Sequence[str]] = {}
        for variable_selector in raw_variables:
            if isinstance(variable_selector, VariableSelector):
                variable_mapping[node_id + "." + variable_selector.variable] = (
                    variable_selector.value_selector
                )
                continue

            if not isinstance(variable_selector, Mapping):
                continue

            variable = variable_selector.get("variable")
            value_selector = variable_selector.get("value_selector")
            if isinstance(variable, str) and _is_string_sequence(value_selector):
                variable_mapping[node_id + "." + variable] = value_selector

        return variable_mapping
