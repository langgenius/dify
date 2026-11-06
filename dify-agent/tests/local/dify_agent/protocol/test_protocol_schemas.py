from decimal import Decimal

import pytest
from pydantic import ValidationError
from pydantic_ai.messages import FinalResultEvent

from dify_agent.protocol.snapshot import SessionSnapshot
import dify_agent.protocol as protocol_exports
from dify_agent.protocol import DIFY_AGENT_HISTORY_LAYER_ID, DIFY_AGENT_MODEL_LAYER_ID, DIFY_AGENT_OUTPUT_LAYER_ID
from dify_agent.protocol.schemas import (
    AgentRunUsage,
    RUN_EVENT_ADAPTER,
    CreateRunRequest,
    PydanticAIStreamRunEvent,
    RunCancelledEvent,
    RunCancelledEventData,
    RunFailedEvent,
    RunFailedEventData,
    RunFailureType,
    RunStartedEvent,
    RunSucceededEvent,
    RunSucceededEventData,
)


def test_run_event_adapter_round_trips_typed_variants() -> None:
    events = [
        RunStartedEvent(run_id="run-1"),
        PydanticAIStreamRunEvent(
            run_id="run-1",
            data=FinalResultEvent(tool_name=None, tool_call_id=None),
            agent_message_delta="hello",
        ),
        RunSucceededEvent(
            run_id="run-1",
            data=RunSucceededEventData(
                output={"answer": ["done"]},
                session_snapshot=SessionSnapshot(layers={}),
            ),
        ),
        RunFailedEvent(
            run_id="run-1",
            data=RunFailedEventData(
                error="boom",
                error_type=RunFailureType.AGENT_RUN_LIMIT_EXCEEDED,
                reason="shutdown",
            ),
        ),
        RunCancelledEvent(
            run_id="run-1",
            data=RunCancelledEventData(
                reason="user_cancelled",
            ),
        ),
    ]

    for event in events:
        payload = RUN_EVENT_ADAPTER.dump_json(event)
        decoded = RUN_EVENT_ADAPTER.validate_json(payload)

        assert decoded.type == event.type
        assert decoded.run_id == event.run_id


def test_run_failed_event_error_type_is_optional_and_round_trips() -> None:
    legacy = RUN_EVENT_ADAPTER.validate_python(
        {
            "run_id": "legacy-run",
            "type": "run_failed",
            "data": {"error": "legacy failure", "reason": None},
        }
    )
    classified = RunFailedEvent(
        run_id="classified-run",
        data=RunFailedEventData(
            error="run limit reached",
            error_type=RunFailureType.AGENT_RUN_LIMIT_EXCEEDED,
        ),
    )

    decoded = RUN_EVENT_ADAPTER.validate_json(RUN_EVENT_ADAPTER.dump_json(classified))

    assert isinstance(legacy, RunFailedEvent)
    assert legacy.data.error_type is None
    assert isinstance(decoded, RunFailedEvent)
    assert decoded.data.error_type is RunFailureType.AGENT_RUN_LIMIT_EXCEEDED
    assert protocol_exports.RunFailureType is RunFailureType


@pytest.mark.parametrize("event_type", ["run_failed", "run_cancelled"])
def test_non_success_terminal_event_round_trips_optional_snapshot(event_type: str) -> None:
    snapshot = SessionSnapshot(layers={})
    event: RunFailedEvent | RunCancelledEvent
    if event_type == "run_failed":
        event = RunFailedEvent(
            run_id="run-1",
            data=RunFailedEventData(error="boom", session_snapshot=snapshot),
        )
    else:
        event = RunCancelledEvent(
            run_id="run-1",
            data=RunCancelledEventData(reason="stopped", session_snapshot=snapshot),
        )

    decoded = RUN_EVENT_ADAPTER.validate_json(RUN_EVENT_ADAPTER.dump_json(event))

    assert isinstance(decoded, RunFailedEvent | RunCancelledEvent)
    assert decoded.data.session_snapshot == snapshot


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


def test_create_run_request_rejects_old_compositor_payload_and_model_layer_id_is_public() -> None:
    assert DIFY_AGENT_MODEL_LAYER_ID == "llm"
    assert DIFY_AGENT_HISTORY_LAYER_ID == "history"
    assert DIFY_AGENT_OUTPUT_LAYER_ID == "output"
    with pytest.raises(ValidationError):
        _ = CreateRunRequest.model_validate(
            {
                "compositor": {"layers": []},
            }
        )


def test_protocol_package_no_longer_exports_execution_context_dto() -> None:
    assert not hasattr(protocol_exports, "ExecutionContext")
    assert not hasattr(protocol_exports, "RunPurpose")


def test_run_succeeded_event_data_requires_output() -> None:
    with pytest.raises(ValidationError, match="output"):
        RunSucceededEventData(session_snapshot=SessionSnapshot())


def test_run_succeeded_event_round_trips_explicit_json_null_output() -> None:
    event = RunSucceededEvent(
        run_id="run-null-output",
        data=RunSucceededEventData(output=None, session_snapshot=SessionSnapshot(layers={})),
    )

    payload = RUN_EVENT_ADAPTER.dump_json(event)
    decoded = RUN_EVENT_ADAPTER.validate_json(payload)

    assert isinstance(decoded, RunSucceededEvent)
    assert decoded.data.output is None
    assert b'"output":null' in payload
    assert b'"deferred_tool_call"' not in payload


def test_run_succeeded_event_round_trips_usage() -> None:
    event = RunSucceededEvent(
        run_id="run-usage",
        data=RunSucceededEventData(
            output="done",
            session_snapshot=SessionSnapshot(layers={}),
            usage=AgentRunUsage(prompt_tokens=3, completion_tokens=5),
        ),
    )

    payload = RUN_EVENT_ADAPTER.dump_json(event)
    decoded = RUN_EVENT_ADAPTER.validate_json(payload)

    assert isinstance(decoded, RunSucceededEvent)
    assert decoded.data.usage is not None
    assert decoded.data.usage.prompt_tokens == 3
    assert decoded.data.usage.completion_tokens == 5
    assert decoded.data.usage.total_tokens == 8
    assert b'"usage"' in payload


def test_run_failed_event_round_trips_usage() -> None:
    usage = AgentRunUsage(prompt_tokens=13, completion_tokens=8)
    event = RunFailedEvent(run_id="run-partial-usage", data=RunFailedEventData(error="boom", usage=usage))

    payload = RUN_EVENT_ADAPTER.dump_json(event)
    decoded = RUN_EVENT_ADAPTER.validate_json(payload)

    assert isinstance(decoded, RunFailedEvent)
    assert decoded.data.usage is not None
    assert decoded.data.usage.prompt_tokens == 13
    assert decoded.data.usage.completion_tokens == 8
    assert decoded.data.usage.total_tokens == 21


def test_run_cancelled_event_round_trips_usage() -> None:
    usage = AgentRunUsage(prompt_tokens=13, completion_tokens=8)
    event = RunCancelledEvent(
        run_id="run-partial-usage",
        data=RunCancelledEventData(reason="user_cancelled", usage=usage),
    )

    payload = RUN_EVENT_ADAPTER.dump_json(event)
    decoded = RUN_EVENT_ADAPTER.validate_json(payload)

    assert isinstance(decoded, RunCancelledEvent)
    assert decoded.data.usage is not None
    assert decoded.data.usage.prompt_tokens == 13
    assert decoded.data.usage.completion_tokens == 8
    assert decoded.data.usage.total_tokens == 21


def test_run_succeeded_event_round_trips_complete_pricing_usage() -> None:
    event = RunSucceededEvent(
        run_id="run-priced-usage",
        data=RunSucceededEventData(
            output="done",
            session_snapshot=SessionSnapshot(layers={}),
            usage=AgentRunUsage(
                prompt_tokens=10,
                prompt_unit_price=Decimal("5"),
                prompt_price_unit=Decimal("0.000001"),
                prompt_price=Decimal("0.000050"),
                completion_tokens=2,
                completion_unit_price=Decimal("30"),
                completion_price_unit=Decimal("0.000001"),
                completion_price=Decimal("0.000060"),
                total_tokens=12,
                total_price=Decimal("0.000110"),
                currency="USD",
                latency=0.4,
                time_to_first_token=0.1,
                time_to_generate=0.3,
            ),
        ),
    )

    payload = RUN_EVENT_ADAPTER.dump_json(event)
    decoded = RUN_EVENT_ADAPTER.validate_json(payload)

    assert isinstance(decoded, RunSucceededEvent)
    assert decoded.data.usage is not None
    assert decoded.data.usage.prompt_price == Decimal("0.000050")
    assert decoded.data.usage.completion_price == Decimal("0.000060")
    assert decoded.data.usage.total_price == Decimal("0.000110")
    assert decoded.data.usage.currency == "USD"
    assert decoded.data.usage.latency == 0.4
    assert decoded.data.usage.time_to_first_token == 0.1
    assert decoded.data.usage.time_to_generate == 0.3


def test_create_run_request_rejects_removed_top_level_execution_context() -> None:
    with pytest.raises(ValidationError):
        _ = CreateRunRequest.model_validate(
            {
                "composition": {"layers": []},
                "execution_context": {
                    "tenant_id": "tenant-1",
                    "user_from": "account",
                    "agent_mode": "workflow_run",
                    "invoke_from": "service-api",
                },
            }
        )


def test_create_run_request_rejects_removed_top_level_purpose() -> None:
    with pytest.raises(ValidationError):
        _ = CreateRunRequest.model_validate(
            {
                "composition": {"layers": []},
                "purpose": "session_cleanup",
            }
        )


@pytest.mark.parametrize("event_type", ["agent_output", "session_snapshot"])
def test_removed_non_terminal_payload_events_are_rejected(event_type: str) -> None:
    with pytest.raises(ValidationError):
        _ = RUN_EVENT_ADAPTER.validate_python({"run_id": "run-1", "type": event_type, "data": {}})
