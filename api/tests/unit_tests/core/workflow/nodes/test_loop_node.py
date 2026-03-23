from dify_graph.entities.graph_config import NodeConfigDictAdapter
from dify_graph.nodes.loop.entities import LoopNodeData
from dify_graph.nodes.loop.loop_node import LoopNode


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
