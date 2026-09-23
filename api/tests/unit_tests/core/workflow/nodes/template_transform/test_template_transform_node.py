from graphon.nodes.base.entities import VariableSelector
from graphon.nodes.template_transform.template_transform_node import (
    TemplateTransformNode,
)

from .template_transform_node_spec import TestTemplateTransformNode  # noqa: F401


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
