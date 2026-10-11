from decimal import Decimal

from dify_agent.protocol import (
    AgentRunUsage,
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
from dify_agent.protocol.snapshot import SessionSnapshot
from pydantic_ai.messages import FinalResultEvent

from clients.agent_backend import (
    AgentBackendAgentMessageDeltaInternalEvent,
    AgentBackendInternalEventType,
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunEventAdapter,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunStartedInternalEvent,
    AgentBackendRunSucceededInternalEvent,
    AgentBackendStreamInternalEvent,
)


def test_event_adapter_maps_run_started():
    adapted = AgentBackendRunEventAdapter().adapt(RunStartedEvent(id="1-0", run_id="run-1"))

    assert adapted == [
        AgentBackendRunStartedInternalEvent(
            run_id="run-1",
            source_event_id="1-0",
        )
    ]


def test_event_adapter_maps_pydantic_ai_stream_event():
    adapted = AgentBackendRunEventAdapter().adapt(
        PydanticAIStreamRunEvent(
            id="2-0",
            run_id="run-1",
            data=FinalResultEvent(tool_name=None, tool_call_id=None),
        )
    )

    assert len(adapted) == 1
    event = adapted[0]
    assert isinstance(event, AgentBackendStreamInternalEvent)
    assert event.type == AgentBackendInternalEventType.STREAM_EVENT
    assert event.event_kind == "final_result"
    assert event.data["event_kind"] == "final_result"


def test_event_adapter_maps_pydantic_ai_stream_event_agent_message_delta_annotation():
    adapted = AgentBackendRunEventAdapter().adapt(
        PydanticAIStreamRunEvent(
            id="2-0",
            run_id="run-1",
            data=FinalResultEvent(tool_name=None, tool_call_id=None),
            agent_message_delta="hello",
        )
    )

    assert adapted == [
        AgentBackendAgentMessageDeltaInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            delta="hello",
        )
    ]


def test_event_adapter_maps_run_succeeded_to_final_output():
    snapshot = SessionSnapshot(layers={})
    adapted = AgentBackendRunEventAdapter().adapt(
        RunSucceededEvent(
            id="3-0",
            run_id="run-1",
            data=RunSucceededEventData(
                output={"summary": "done"},
                session_snapshot=snapshot,
                usage=AgentRunUsage(
                    prompt_tokens=2,
                    prompt_unit_price=Decimal(5),
                    prompt_price_unit=Decimal("0.000001"),
                    prompt_price=Decimal("0.000010"),
                    completion_tokens=3,
                    completion_unit_price=Decimal(30),
                    completion_price_unit=Decimal("0.000001"),
                    completion_price=Decimal("0.000090"),
                    total_price=Decimal("0.000100"),
                    currency="USD",
                    latency=0.4,
                ),
            ),
        )
    )

    assert adapted == [
        AgentBackendRunSucceededInternalEvent(
            run_id="run-1",
            source_event_id="3-0",
            output={"summary": "done"},
            session_snapshot=snapshot,
            usage={
                "prompt_tokens": 2,
                "prompt_unit_price": "5",
                "prompt_price_unit": "0.000001",
                "prompt_price": "0.000010",
                "completion_tokens": 3,
                "completion_unit_price": "30",
                "completion_price_unit": "0.000001",
                "completion_price": "0.000090",
                "total_tokens": 5,
                "total_price": "0.000100",
                "currency": "USD",
                "latency": 0.4,
                "time_to_first_token": None,
                "time_to_generate": None,
            },
        )
    ]


def test_event_adapter_maps_run_failed_to_failed_result():
    adapted = AgentBackendRunEventAdapter().adapt(
        RunFailedEvent(
            id="4-0",
            run_id="run-1",
            data=RunFailedEventData(
                error="boom",
                error_type=RunFailureType.AGENT_RUN_LIMIT_EXCEEDED,
                reason="runtime",
                usage=AgentRunUsage(prompt_tokens=13, completion_tokens=8),
            ),
        )
    )

    assert adapted == [
        AgentBackendRunFailedInternalEvent(
            run_id="run-1",
            source_event_id="4-0",
            error="boom",
            error_type=RunFailureType.AGENT_RUN_LIMIT_EXCEEDED,
            reason="runtime",
            usage={
                "prompt_tokens": 13,
                "completion_tokens": 8,
                "total_tokens": 21,
                "prompt_unit_price": "0",
                "prompt_price_unit": "0",
                "prompt_price": "0",
                "completion_unit_price": "0",
                "completion_price_unit": "0",
                "completion_price": "0",
                "total_price": "0",
                "currency": "USD",
                "latency": 0.0,
                "time_to_first_token": None,
                "time_to_generate": None,
            },
        )
    ]


def test_event_adapter_maps_run_cancelled_to_terminal_cancelled():
    adapted = AgentBackendRunEventAdapter().adapt(
        RunCancelledEvent(
            id="6-0",
            run_id="run-1",
            data=RunCancelledEventData(
                reason="user_cancelled",
                message="Stopped by user",
                usage=AgentRunUsage(prompt_tokens=5, completion_tokens=3),
            ),
        )
    )

    assert adapted == [
        AgentBackendRunCancelledInternalEvent(
            run_id="run-1",
            source_event_id="6-0",
            reason="user_cancelled",
            message="Stopped by user",
            usage={
                "prompt_tokens": 5,
                "completion_tokens": 3,
                "total_tokens": 8,
                "prompt_unit_price": "0",
                "prompt_price_unit": "0",
                "prompt_price": "0",
                "completion_unit_price": "0",
                "completion_price_unit": "0",
                "completion_price": "0",
                "total_price": "0",
                "currency": "USD",
                "latency": 0.0,
                "time_to_first_token": None,
                "time_to_generate": None,
            },
        )
    ]
