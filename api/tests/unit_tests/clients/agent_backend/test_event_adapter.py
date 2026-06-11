import pytest
from agenton.compositor import CompositorSessionSnapshot
from dify_agent.protocol import (
    DeferredToolCallPayload,
    PydanticAIStreamRunEvent,
    RunCancelledEvent,
    RunCancelledEventData,
    RunFailedEvent,
    RunFailedEventData,
    RunStartedEvent,
    RunSucceededEvent,
    RunSucceededEventData,
)
from pydantic_ai.messages import FinalResultEvent

from clients.agent_backend import (
    AgentBackendDeferredToolCallInternalEvent,
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


def test_event_adapter_maps_run_succeeded_to_final_output():
    snapshot = CompositorSessionSnapshot(layers=[])
    adapted = AgentBackendRunEventAdapter().adapt(
        RunSucceededEvent(
            id="3-0",
            run_id="run-1",
            data=RunSucceededEventData(output={"summary": "done"}, session_snapshot=snapshot),
        )
    )

    assert adapted == [
        AgentBackendRunSucceededInternalEvent(
            run_id="run-1",
            source_event_id="3-0",
            output={"summary": "done"},
            session_snapshot=snapshot,
        )
    ]


def test_event_adapter_maps_run_failed_to_failed_result():
    adapted = AgentBackendRunEventAdapter().adapt(
        RunFailedEvent(
            id="4-0",
            run_id="run-1",
            data=RunFailedEventData(error="boom", reason="runtime"),
        )
    )

    assert adapted == [
        AgentBackendRunFailedInternalEvent(
            run_id="run-1",
            source_event_id="4-0",
            error="boom",
            reason="runtime",
        )
    ]


def test_event_adapter_maps_deferred_tool_call_success_to_internal_event():
    snapshot = CompositorSessionSnapshot(layers=[])
    deferred_tool_call = DeferredToolCallPayload(
        tool_call_id="tool-call-1",
        tool_name="ask_human",
        args={"question": "Need review"},
        metadata={"layer_type": "dify.ask_human", "schema_version": 1},
    )
    adapted = AgentBackendRunEventAdapter().adapt(
        RunSucceededEvent(
            id="5-0",
            run_id="run-1",
            data=RunSucceededEventData(deferred_tool_call=deferred_tool_call, session_snapshot=snapshot),
        )
    )

    assert adapted == [
        AgentBackendDeferredToolCallInternalEvent(
            run_id="run-1",
            source_event_id="5-0",
            deferred_tool_call=deferred_tool_call,
            message="Need review",
            session_snapshot=snapshot,
        )
    ]


def test_event_adapter_rejects_deferred_tool_call_success_without_payload():
    snapshot = CompositorSessionSnapshot(layers=[])

    with pytest.raises(TypeError, match="deferred_tool_call branch is missing payload"):
        _ = AgentBackendRunEventAdapter().adapt(
            RunSucceededEvent(
                id="5-1",
                run_id="run-1",
                data=RunSucceededEventData(deferred_tool_call=None, session_snapshot=snapshot),
            )
        )


def test_event_adapter_uses_deferred_tool_call_title_as_pause_message_fallback():
    snapshot = CompositorSessionSnapshot(layers=[])
    deferred_tool_call = DeferredToolCallPayload(
        tool_call_id="tool-call-1",
        tool_name="ask_human",
        args={"title": "Review required"},
        metadata={},
    )

    adapted = AgentBackendRunEventAdapter().adapt(
        RunSucceededEvent(
            id="5-2",
            run_id="run-1",
            data=RunSucceededEventData(deferred_tool_call=deferred_tool_call, session_snapshot=snapshot),
        )
    )

    assert adapted == [
        AgentBackendDeferredToolCallInternalEvent(
            run_id="run-1",
            source_event_id="5-2",
            deferred_tool_call=deferred_tool_call,
            message="Review required",
            session_snapshot=snapshot,
        )
    ]


def test_event_adapter_uses_generic_deferred_tool_call_pause_message_when_args_have_no_label():
    snapshot = CompositorSessionSnapshot(layers=[])
    deferred_tool_call = DeferredToolCallPayload(
        tool_call_id="tool-call-1",
        tool_name="ask_human",
        args={"question": "   ", "title": "   "},
        metadata={},
    )

    adapted = AgentBackendRunEventAdapter().adapt(
        RunSucceededEvent(
            id="5-3",
            run_id="run-1",
            data=RunSucceededEventData(deferred_tool_call=deferred_tool_call, session_snapshot=snapshot),
        )
    )

    assert adapted == [
        AgentBackendDeferredToolCallInternalEvent(
            run_id="run-1",
            source_event_id="5-3",
            deferred_tool_call=deferred_tool_call,
            message="Agent backend requested external input via deferred tool 'ask_human'.",
            session_snapshot=snapshot,
        )
    ]


def test_event_adapter_maps_run_cancelled_to_terminal_cancelled():
    adapted = AgentBackendRunEventAdapter().adapt(
        RunCancelledEvent(
            id="6-0",
            run_id="run-1",
            data=RunCancelledEventData(reason="user_cancelled", message="Stopped by user"),
        )
    )

    assert adapted == [
        AgentBackendRunCancelledInternalEvent(
            run_id="run-1",
            source_event_id="6-0",
            reason="user_cancelled",
            message="Stopped by user",
        )
    ]
