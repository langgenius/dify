from pydantic_ai.messages import FinalResultEvent

from dify_agent.server.schemas import (
    RUN_EVENT_ADAPTER,
    AgentOutputRunEvent,
    AgentOutputRunEventData,
    PydanticAIStreamRunEvent,
    RunFailedEvent,
    RunFailedEventData,
    RunStartedEvent,
)


def test_run_event_adapter_round_trips_typed_variants() -> None:
    events = [
        RunStartedEvent(run_id="run-1"),
        PydanticAIStreamRunEvent(run_id="run-1", data=FinalResultEvent(tool_name=None, tool_call_id=None)),
        AgentOutputRunEvent(run_id="run-1", data=AgentOutputRunEventData(output="done")),
        RunFailedEvent(run_id="run-1", data=RunFailedEventData(error="boom", reason="shutdown")),
    ]

    for event in events:
        payload = RUN_EVENT_ADAPTER.dump_json(event)
        decoded = RUN_EVENT_ADAPTER.validate_json(payload)

        assert decoded.type == event.type
        assert decoded.run_id == event.run_id


def test_pydantic_ai_event_data_uses_agent_stream_event_model() -> None:
    event = RUN_EVENT_ADAPTER.validate_python(
        {
            "run_id": "run-1",
            "type": "pydantic_ai_event",
            "data": {"event_kind": "final_result", "tool_name": None, "tool_call_id": None},
        }
    )

    assert isinstance(event, PydanticAIStreamRunEvent)
    assert isinstance(event.data, FinalResultEvent)
