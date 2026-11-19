"""Reference serialization contracts shared by evaluation runs and result exports."""

import json

from core.evaluation.entities.evaluation_entity import AgentToolCall, EvaluationDatasetInput


def test_dataset_references_keep_global_and_node_scoped_agent_fields() -> None:
    global_call = AgentToolCall(name="search", arguments={"query": "Dify"})
    node_call = AgentToolCall(name="weather", arguments={"city": "Paris"})
    item = EvaluationDatasetInput(
        index=1,
        inputs={"task": "Research the weather"},
        expected_output="Sunny",
        expected_outputs={"Answer": "It is sunny"},
        expected_tool_calls=[global_call],
        expected_tool_calls_by_node={"Agent": [node_call]},
        success_criteria=["Return the weather"],
        success_criteria_by_node={"Agent": ["Call the weather tool"]},
    )

    assert item.get_expected_tool_calls_for_node("other", "Agent") == [node_call]
    assert item.get_expected_tool_calls_for_node("other") == [global_call]
    serialized = item.serialize_expected_output()
    assert serialized is not None
    payload = json.loads(serialized)
    assert payload["expected_output"] == "Sunny"
    assert payload["Answer"] == "It is sunny"
    assert payload["expected_tool_calls"][0]["name"] == "search"
    assert payload["Agent : expected_tool_calls"][0]["name"] == "weather"
    assert payload["success_criteria"] == ["Return the weather"]
    assert payload["Agent : success_criteria"] == ["Call the weather tool"]
    assert item.iter_expected_output_columns() == [
        ("expected_output", "Sunny"),
        ("Answer : expected_output", "It is sunny"),
        ("expected_tool_calls", json.dumps([global_call.model_dump(mode="json", exclude_none=True)], sort_keys=True)),
        (
            "Agent : expected_tool_calls",
            json.dumps([node_call.model_dump(mode="json", exclude_none=True)], sort_keys=True),
        ),
        ("success_criteria", "Return the weather"),
        ("Agent : success_criteria", "Call the weather tool"),
    ]
