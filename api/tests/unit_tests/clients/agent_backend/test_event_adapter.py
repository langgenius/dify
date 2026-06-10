from agenton.compositor import CompositorSessionSnapshot
from dify_agent.protocol import (
    PydanticAIStreamRunEvent,
    RunCancelledEvent,
    RunCancelledEventData,
    RunFailedEvent,
    RunFailedEventData,
    RunPausedEvent,
    RunPausedEventData,
    RunStartedEvent,
    RunSucceededEvent,
    RunSucceededEventData,
)
from pydantic_ai.messages import FinalResultEvent

from clients.agent_backend import (
    AgentBackendInternalEventType,
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunEventAdapter,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunPausedInternalEvent,
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


def test_event_adapter_maps_run_paused_to_resumable_pause():
    snapshot = CompositorSessionSnapshot(layers=[])
    adapted = AgentBackendRunEventAdapter().adapt(
        RunPausedEvent(
            id="5-0",
            run_id="run-1",
            data=RunPausedEventData(reason="human_handoff", message="Need review", session_snapshot=snapshot),
        )
    )

    assert adapted == [
        AgentBackendRunPausedInternalEvent(
            run_id="run-1",
            source_event_id="5-0",
            reason="human_handoff",
            message="Need review",
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
