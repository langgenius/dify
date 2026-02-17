from __future__ import annotations

from typing import Any
from unittest.mock import Mock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.helper.code_executor.code_executor import CodeExecutionError
from core.workflow.entities import GraphInitParams
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.nodes.template_transform.template_renderer import (
    CodeExecutorJinja2TemplateRenderer,
    TemplateRenderError,
)
from core.workflow.nodes.template_transform.template_transform_node import (
    DEFAULT_TEMPLATE_TRANSFORM_MAX_OUTPUT_LENGTH,
    TemplateTransformNode,
)
from models.enums import UserFrom


class _StaticRenderer:
    def __init__(self, rendered: str) -> None:
        self.rendered = rendered
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def render_template(self, template: str, variables: dict[str, Any]) -> str:
        self.calls.append((template, variables))
        return self.rendered


class _FailingRenderer:
    def __init__(self, message: str) -> None:
        self.message = message

    def render_template(self, template: str, variables: dict[str, Any]) -> str:
        raise TemplateRenderError(self.message)


class _StubExecutor:
    @staticmethod
    def execute_workflow_code_template(*, language, code, inputs):
        return {"result": "rendered"}


class _NonStringExecutor:
    @staticmethod
    def execute_workflow_code_template(*, language, code, inputs):
        return {"result": 123}


class _ErrorExecutor:
    @staticmethod
    def execute_workflow_code_template(*, language, code, inputs):
        raise CodeExecutionError("boom")


@pytest.fixture
def graph_init_params() -> GraphInitParams:
    return GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config={},
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )


def _make_runtime_state(value: Any | None) -> Mock:
    variable_pool = Mock()
    if value is None:
        variable_pool.get.return_value = None
    else:
        variable = Mock()
        variable.to_object.return_value = value
        variable_pool.get.return_value = variable
    graph_runtime_state = Mock()
    graph_runtime_state.variable_pool = variable_pool
    return graph_runtime_state


def _make_node(*, graph_init_params: GraphInitParams, graph_runtime_state: Mock, renderer, max_len: int | None = None):
    node_config = {
        "id": "node-1",
        "data": {
            "title": "Template",
            "variables": [{"variable": "name", "value_selector": ["start", "name"]}],
            "template": "Hello {{ name }}",
        },
    }
    return TemplateTransformNode(
        id="node-1",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
        template_renderer=renderer,
        max_output_length=max_len,
    )


def test_run_success(graph_init_params: GraphInitParams) -> None:
    renderer = _StaticRenderer("Hello Alice")
    runtime_state = _make_runtime_state("Alice")
    node = _make_node(graph_init_params=graph_init_params, graph_runtime_state=runtime_state, renderer=renderer)

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs == {"output": "Hello Alice"}
    assert renderer.calls == [("Hello {{ name }}", {"name": "Alice"})]


def test_run_renderer_error(graph_init_params: GraphInitParams) -> None:
    renderer = _FailingRenderer("bad template")
    runtime_state = _make_runtime_state("Alice")
    node = _make_node(graph_init_params=graph_init_params, graph_runtime_state=runtime_state, renderer=renderer)

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error == "bad template"


def test_run_output_length_exceeded(graph_init_params: GraphInitParams) -> None:
    renderer = _StaticRenderer("x" * 6)
    runtime_state = _make_runtime_state("Alice")
    node = _make_node(
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
        renderer=renderer,
        max_len=5,
    )

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error == "Output length exceeds 5 characters"


def test_init_rejects_invalid_max_length(graph_init_params: GraphInitParams) -> None:
    runtime_state = _make_runtime_state("Alice")
    with pytest.raises(ValueError, match="max_output_length must be a positive integer"):
        _make_node(
            graph_init_params=graph_init_params,
            graph_runtime_state=runtime_state,
            renderer=_StaticRenderer("ok"),
            max_len=0,
        )


def test_extract_variable_selector_mapping() -> None:
    mapping = TemplateTransformNode._extract_variable_selector_to_variable_mapping(
        graph_config={},
        node_id="node-1",
        node_data={
            "title": "Template",
            "variables": [
                {"variable": "name", "value_selector": ["start", "name"]},
                {"variable": "age", "value_selector": ["start", "age"]},
            ],
            "template": "Hello {{ name }}",
        },
    )

    assert mapping == {
        "node-1.name": ["start", "name"],
        "node-1.age": ["start", "age"],
    }


def test_code_executor_renderer_success() -> None:
    renderer = CodeExecutorJinja2TemplateRenderer(code_executor=_StubExecutor)

    assert renderer.render_template("{{ name }}", {"name": "Dify"}) == "rendered"


def test_code_executor_renderer_non_string_result() -> None:
    renderer = CodeExecutorJinja2TemplateRenderer(code_executor=_NonStringExecutor)

    with pytest.raises(TemplateRenderError, match="must be a string"):
        renderer.render_template("{{ name }}", {"name": "Dify"})


def test_code_executor_renderer_execution_error() -> None:
    renderer = CodeExecutorJinja2TemplateRenderer(code_executor=_ErrorExecutor)

    with pytest.raises(TemplateRenderError, match="boom"):
        renderer.render_template("{{ name }}", {"name": "Dify"})


def test_default_output_length_constant() -> None:
    assert DEFAULT_TEMPLATE_TRANSFORM_MAX_OUTPUT_LENGTH > 0
