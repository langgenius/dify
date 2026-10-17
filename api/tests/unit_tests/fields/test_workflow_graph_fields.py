import pytest

from fields.workflow_graph_fields import (
    WorkflowFeaturesResponse,
    WorkflowGraphResponse,
    WorkflowNodeExecutionMetadataResponse,
)


def test_graph_round_trips_without_adding_or_dropping_keys() -> None:
    graph = {
        "nodes": [
            {
                "id": "start",
                "type": "custom",
                "position": {"x": 10, "y": 20.5},
                "width": 244,
                "data": {"type": "start", "title": "Start", "variables": [{"variable": "q"}]},
            },
            {"id": "note", "type": "custom-note", "data": {"type": "", "text": "hi"}},
        ],
        "edges": [
            {
                "id": "start-llm",
                "source": "start",
                "target": "llm",
                "sourceHandle": "source",
                "data": {"sourceType": "start", "isInIteration": False},
                "zIndex": 0,
            }
        ],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    }

    dumped = WorkflowGraphResponse.model_validate(graph).model_dump(mode="json")

    assert dumped == graph
    assert "desc" not in dumped["nodes"][0]["data"]
    assert "position" not in dumped["nodes"][1]
    assert "targetHandle" not in dumped["edges"][0]


def test_empty_graph_stays_empty() -> None:
    assert WorkflowGraphResponse.model_validate({}).model_dump(mode="json") == {}


@pytest.mark.parametrize(
    "node",
    [
        {"id": "start", "type": "start"},
        {"id": "start", "data": {"title": "Start", "variables": []}},
        {"id": "start", "data": None},
        {"id": "start", "data": {"type": None}},
    ],
)
def test_sparse_stored_nodes_round_trip_without_inventing_data(node: dict[str, object]) -> None:
    # 1.9.0's workflow service integration test persisted a node with only id/type.
    # Reading stored JSON must not impose the executable graph's required fields.
    graph: dict[str, list[dict[str, object]]] = {"nodes": [node], "edges": []}

    assert WorkflowGraphResponse.model_validate(graph).model_dump(mode="json") == graph


def test_features_keep_unknown_settings_and_camel_case_keys() -> None:
    features = {
        "opening_statement": "",
        "text_to_speech": {"enabled": True, "autoPlay": "enabled"},
        "file_upload": {"enabled": False, "fileUploadConfig": {"limit": 1}},
    }

    assert WorkflowFeaturesResponse.model_validate(features).model_dump(mode="json") == features


def test_execution_metadata_reports_prices_as_numbers() -> None:
    metadata = WorkflowNodeExecutionMetadataResponse.model_validate(
        {"total_tokens": 3, "total_price": "0.0012", "currency": "USD", "trigger_info": {"a": 1}}
    )

    assert metadata.model_dump(mode="json") == {
        "total_tokens": 3,
        "total_price": 0.0012,
        "currency": "USD",
        "trigger_info": {"a": 1},
    }
