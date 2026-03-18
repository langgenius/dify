import pytest

from dify_graph.entities.graph_config import NodeConfigDictAdapter
from dify_graph.nodes.loop.entities import LoopNodeData, LoopValue
from dify_graph.nodes.loop.loop_node import LoopNode
from dify_graph.variables.types import SegmentType


def test_extract_variable_selector_to_variable_mapping_validates_child_node_configs(monkeypatch) -> None:
    seen_configs: list[object] = []
    original_validate_python = NodeConfigDictAdapter.validate_python

    def record_validate_python(value: object):
        seen_configs.append(value)
        return original_validate_python(value)

    monkeypatch.setattr(NodeConfigDictAdapter, "validate_python", record_validate_python)

    child_node_config = {
        "id": "answer-node",
        "data": {
            "type": "answer",
            "title": "Answer",
            "answer": "",
            "loop_id": "loop-node",
        },
    }

    LoopNode._extract_variable_selector_to_variable_mapping(
        graph_config={
            "nodes": [
                {
                    "id": "loop-node",
                    "data": {
                        "type": "loop",
                        "title": "Loop",
                        "loop_count": 1,
                        "break_conditions": [],
                        "logical_operator": "and",
                    },
                },
                child_node_config,
            ],
            "edges": [],
        },
        node_id="loop-node",
        node_data=LoopNodeData(
            title="Loop",
            loop_count=1,
            break_conditions=[],
            logical_operator="and",
        ),
    )

    assert seen_configs == [child_node_config]


@pytest.mark.parametrize(
    ("var_type", "original_value", "expected_value"),
    [
        (SegmentType.ARRAY_STRING, ["alpha", "beta"], ["alpha", "beta"]),
        (SegmentType.ARRAY_NUMBER, [1, 2.5], [1, 2.5]),
        (SegmentType.ARRAY_OBJECT, [{"name": "item"}], [{"name": "item"}]),
        (SegmentType.ARRAY_STRING, '["legacy", "json"]', ["legacy", "json"]),
    ],
)
def test_get_segment_for_constant_accepts_native_array_values(
    var_type: SegmentType, original_value: LoopValue, expected_value: LoopValue
) -> None:
    segment = LoopNode._get_segment_for_constant(var_type, original_value)

    assert segment.value_type == var_type
    assert segment.value == expected_value
