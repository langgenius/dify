from core.workflow.graph_engine.entities.event import (
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunSucceededEvent,
    NodeRunRetryEvent,
)
from tests.unit_tests.core.workflow.nodes.test_continue_on_error import ContinueOnErrorTestHelper

DEFAULT_VALUE_EDGE = [
    {
        "id": "start-source-node-target",
        "source": "start",
        "target": "node",
        "sourceHandle": "source",
    },
    {
        "id": "node-source-answer-target",
        "source": "node",
        "target": "answer",
        "sourceHandle": "source",
    },
]


def test_retry_default_value_partial_success():
    """retry default value node with partial success status"""
    error_code = """
    def main() -> dict:
        return {
            "result": 1 / 0,
        }
    """

    graph_config = {
        "edges": DEFAULT_VALUE_EDGE,
        "nodes": [
            {"data": {"title": "start", "type": "start", "variables": []}, "id": "start"},
            {"data": {"title": "answer", "type": "answer", "answer": "{{#node.result#}}"}, "id": "answer"},
            ContinueOnErrorTestHelper.get_code_node(
                error_code,
                "default-value",
                [{"key": "result", "type": "number", "value": 132123}],
                {"retry_config": {"max_retries": 2, "retry_interval": 1, "retry_enabled": True}},
            ),
        ],
    }

    graph_engine = ContinueOnErrorTestHelper.create_test_graph_engine(graph_config)
    events = list(graph_engine.run())
    assert sum(1 for e in events if isinstance(e, NodeRunRetryEvent)) == 2
    assert events[-1].outputs == {"answer": "132123"}
    assert any(isinstance(e, GraphRunPartialSucceededEvent) for e in events)
    assert len(events) == 11


def test_retry_success():
    """retry node with success status"""
    success_code = """
    count = 0
    def main():
        global count
        count += 1
        if count == 1:
            raise Exception("First attempt fails")
        if count == 2:
            return {"result": "success"}
    """
    graph_config = {
        "edges": DEFAULT_VALUE_EDGE,
        "nodes": [
            {"data": {"title": "start", "type": "start", "variables": []}, "id": "start"},
            {"data": {"title": "answer", "type": "answer", "answer": "{{#node.result#}}"}, "id": "answer"},
            ContinueOnErrorTestHelper.get_code_node(
                success_code,
                None,
                None,
                {"retry_config": {"max_retries": 2, "retry_interval": 1000, "retry_enabled": True}},
            ),
        ],
    }
    graph_engine = ContinueOnErrorTestHelper.create_test_graph_engine(graph_config)
    events = list(graph_engine.run())
    assert sum(1 for e in events if isinstance(e, NodeRunRetryEvent)) == 2
    assert any(isinstance(e, GraphRunSucceededEvent) for e in events)
    assert len(events) == 9


def test_retry_failed():
    """retry failed with success status"""
    error_code = """
    def main() -> dict:
        return {
            "result": 1 / 0,
        }
    """

    graph_config = {
        "edges": DEFAULT_VALUE_EDGE,
        "nodes": [
            {"data": {"title": "start", "type": "start", "variables": []}, "id": "start"},
            {"data": {"title": "answer", "type": "answer", "answer": "{{#node.result#}}"}, "id": "answer"},
            ContinueOnErrorTestHelper.get_code_node(
                error_code,
                None,
                None,
                {"retry_config": {"max_retries": 2, "retry_interval": 1, "retry_enabled": True}},
            ),
        ],
    }
    graph_engine = ContinueOnErrorTestHelper.create_test_graph_engine(graph_config)
    events = list(graph_engine.run())
    assert sum(1 for e in events if isinstance(e, NodeRunRetryEvent)) == 2
    assert any(isinstance(e, GraphRunFailedEvent) for e in events)
    assert len(events) == 8
