from types import SimpleNamespace

import pytest
from pydantic import ValidationError

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


def test_loop_variable_data_validates_variable_selector_and_constant_value() -> None:
    variable_input = LoopNodeData(
        title="Loop",
        loop_count=1,
        break_conditions=[],
        logical_operator="and",
        loop_variables=[
            {
                "label": "question",
                "var_type": SegmentType.STRING,
                "value_type": "variable",
                "value": ["start", "question"],
            },
            {
                "label": "payload",
                "var_type": SegmentType.OBJECT,
                "value_type": "constant",
                "value": {"count": 1, "items": ["a", 2]},
            },
        ],
    )

    assert variable_input.loop_variables[0].require_variable_selector() == ["start", "question"]
    assert variable_input.loop_variables[1].require_constant_value() == {"count": 1, "items": ["a", 2]}


def test_loop_variable_data_rejects_missing_variable_selector() -> None:
    with pytest.raises(ValidationError, match="Variable loop inputs require a selector"):
        LoopNodeData(
            title="Loop",
            loop_count=1,
            break_conditions=[],
            logical_operator="and",
            loop_variables=[
                {
                    "label": "question",
                    "var_type": SegmentType.STRING,
                    "value_type": "variable",
                    "value": None,
                }
            ],
        )


def test_loop_node_data_outputs_default_to_empty_mapping_for_none() -> None:
    node_data = LoopNodeData(
        title="Loop",
        loop_count=1,
        break_conditions=[],
        logical_operator="and",
        outputs=None,
    )

    assert node_data.outputs == {}


def test_append_loop_info_to_event_preserves_existing_loop_metadata() -> None:
    node = object.__new__(LoopNode)
    node._node_id = "loop-node"

    event = SimpleNamespace(
        node_run_result=SimpleNamespace(metadata={"loop_id": "existing-loop", "other": "value"}),
        in_loop_id=None,
    )

    node._append_loop_info_to_event(event=event, loop_run_index=2)

    assert event.in_loop_id == "loop-node"
    assert event.node_run_result.metadata == {"loop_id": "existing-loop", "other": "value"}


def test_clear_loop_subgraph_variables_removes_each_loop_node() -> None:
    node = object.__new__(LoopNode)
    remove_calls: list[list[str]] = []
    node.graph_runtime_state = SimpleNamespace(
        variable_pool=SimpleNamespace(remove=lambda selector: remove_calls.append(selector))
    )

    node._clear_loop_subgraph_variables({"child-a", "child-b"})

    assert sorted(remove_calls) == [["child-a"], ["child-b"]]
