import pytest
from pydantic import ValidationError
from pydantic_ai.messages import FinalResultEvent

from agenton.layers import ExitIntent
from agenton.compositor import CompositorSessionSnapshot
import dify_agent.protocol as protocol_exports
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID
from dify_agent.protocol.schemas import (
    RUN_EVENT_ADAPTER,
    CreateRunRequest,
    LayerExitSignals,
    PydanticAIStreamRunEvent,
    RunFailedEvent,
    RunFailedEventData,
    RunStartedEvent,
    RunSucceededEvent,
    RunSucceededEventData,
)


def test_run_event_adapter_round_trips_typed_variants() -> None:
    events = [
        RunStartedEvent(run_id="run-1"),
        PydanticAIStreamRunEvent(run_id="run-1", data=FinalResultEvent(tool_name=None, tool_call_id=None)),
        RunSucceededEvent(
            run_id="run-1",
            data=RunSucceededEventData(
                output={"answer": ["done"]},
                session_snapshot=CompositorSessionSnapshot(layers=[]),
            ),
        ),
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


def test_create_run_request_rejects_agent_profile_and_model_layer_id_is_public() -> None:
    assert DIFY_AGENT_MODEL_LAYER_ID == "llm"
    with pytest.raises(ValidationError):
        _ = CreateRunRequest.model_validate(
            {
                "compositor": {"layers": []},
                "agent_profile": {"provider": "test", "output_text": "done"},
            }
        )


def test_layer_exit_signals_default_to_suspend_and_are_public() -> None:
    assert protocol_exports.LayerExitSignals is LayerExitSignals
    request = CreateRunRequest.model_validate({"compositor": {"layers": []}})

    assert request.layer_exit_signals.default is ExitIntent.SUSPEND
    assert request.layer_exit_signals.layers == {}


def test_layer_exit_signals_accept_layer_overrides() -> None:
    request = CreateRunRequest.model_validate(
        {
            "compositor": {"layers": []},
            "layer_exit_signals": {
                "default": "delete",
                "layers": {"prompt": "suspend", "llm": "delete"},
            },
        }
    )

    assert request.layer_exit_signals.default is ExitIntent.DELETE
    assert request.layer_exit_signals.layers == {"prompt": ExitIntent.SUSPEND, "llm": ExitIntent.DELETE}


def test_layer_exit_signals_reject_extra_fields() -> None:
    with pytest.raises(ValidationError):
        _ = LayerExitSignals.model_validate({"default": "suspend", "unknown": "value"})


@pytest.mark.parametrize("event_type", ["agent_output", "session_snapshot"])
def test_removed_non_terminal_payload_events_are_rejected(event_type: str) -> None:
    with pytest.raises(ValidationError):
        _ = RUN_EVENT_ADAPTER.validate_python({"run_id": "run-1", "type": event_type, "data": {}})
