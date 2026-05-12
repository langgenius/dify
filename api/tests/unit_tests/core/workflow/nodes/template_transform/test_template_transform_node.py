from unittest.mock import MagicMock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from graphon.nodes.base.entities import VariableSelector
from graphon.nodes.template_transform.entities import TemplateTransformNodeData
from graphon.nodes.template_transform.template_transform_node import (
    DEFAULT_TEMPLATE_TRANSFORM_MAX_OUTPUT_LENGTH,
    TemplateTransformNode,
)
from graphon.runtime import GraphRuntimeState
from tests.workflow_test_utils import build_test_graph_init_params

from .template_transform_node_spec import TestTemplateTransformNode  # noqa: F401


@pytest.fixture
def graph_init_params():
    return build_test_graph_init_params(
        workflow_id="test_workflow",
        graph_config={},
        tenant_id="test_tenant",
        app_id="test_app",
        user_id="test_user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )


@pytest.fixture
def mock_graph_runtime_state():
    mock_state = MagicMock(spec=GraphRuntimeState)
    mock_state.variable_pool = MagicMock()
    return mock_state


def test_node_uses_default_max_output_length_when_not_overridden(graph_init_params, mock_graph_runtime_state):
    node = TemplateTransformNode(
        node_id="test_node",
        data=TemplateTransformNodeData(
            title="Template Transform",
            type="template-transform",
            variables=[],
            template="hello",
        ),
        graph_init_params=graph_init_params,
        graph_runtime_state=mock_graph_runtime_state,
        jinja2_template_renderer=MagicMock(),
    )

    assert node._max_output_length == DEFAULT_TEMPLATE_TRANSFORM_MAX_OUTPUT_LENGTH


def test_extract_variable_selector_to_variable_mapping_accepts_mixed_valid_entries():
    mapping = TemplateTransformNode._extract_variable_selector_to_variable_mapping(
        graph_config={"ignored": True},
        node_id="node_123",
        node_data={
            "variables": [
                VariableSelector(variable="validated", value_selector=["sys", "input1"]),
                {"variable": "raw", "value_selector": ("sys", "input2")},
                {"variable": "invalid_selector", "value_selector": ["sys", 3]},
                ["not", "a", "mapping"],
            ]
        },
    )

    assert mapping == {
        "node_123.validated": ["sys", "input1"],
        "node_123.raw": ("sys", "input2"),
    }
