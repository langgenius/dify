"""Unit tests for the Agent App runner — verifies the agent-backend event
stream is republished as chat queue events and the conversation snapshot is
saved, using the deterministic fake backend client (no live stack)."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, override
from unittest.mock import MagicMock

import pytest
from agenton.compositor import CompositorSessionSnapshot
from dify_agent.layers.ask_human import AskHumanToolResult
from dify_agent.protocol import (
    AgentRunUsage,
    CancelRunRequest,
    CancelRunResponse,
    PydanticAIStreamRunEvent,
    RunCancelledEvent,
    RunCancelledEventData,
    RunEvent,
    RunFailedEvent,
    RunFailedEventData,
    RunFailureType,
    RunStartedEvent,
    RunSucceededEvent,
    RunSucceededEventData,
)
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    TextPartDelta,
    ThinkingPartDelta,
    ToolCallPart,
    ToolReturnPart,
)
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from clients.agent_backend import (
    AgentBackendError,
    AgentBackendRunEventAdapter,
    AgentBackendRunFailedError,
    AgentBackendRunFailedInternalEvent,
    AgentBackendStreamInternalEvent,
    FakeAgentBackendRunClient,
    FakeAgentBackendScenario,
)
from core.app.apps.agent_app import app_runner as app_runner_module
from core.app.apps.agent_app.app_runner import AgentAppRunner
from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeRequestBuilder
from core.app.apps.agent_app.session_store import AgentAppSessionScope, StoredAgentAppSession
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.app.entities.queue_entities import (
    QueueAgentMessageEvent,
    QueueAgentThoughtEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
)
from core.workflow.nodes.agent_v2.ask_human_resume import AskHumanResumeOutcome
from core.workflow.nodes.agent_v2.dify_tools_builder import WorkflowAgentToolLayers
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.errors.invoke import InvokeRateLimitError
from models.agent_config_entities import AgentSoulConfig
from models.enums import ConversationFromSource
from models.model import AppMode, Message, MessageAgentThought


@pytest.fixture(autouse=True)
def bind_agent_dependencies(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    """Bind local runner dependencies without reaching external services."""
    monkeypatch.setattr(app_runner_module.db, "session", sqlite_session)
    monkeypatch.setattr(
        "core.app.apps.agent_app.runtime_request_builder.resolve_model_context_window",
        lambda **_kwargs: None,
    )


def _thought_rows(session: Session) -> list[MessageAgentThought]:
    session.expire_all()
    return list(session.scalars(select(MessageAgentThought).order_by(MessageAgentThought.position)).all())


class _NoToolsBuilder:
    def build_layers(self, **kwargs: Any) -> WorkflowAgentToolLayers:
        del kwargs
        return WorkflowAgentToolLayers()


class _FakeQueueManager:
    def __init__(self) -> None:
        self.events: list[Any] = []
        self._stop_requested = False

    def publish(self, event: Any, _from: Any) -> None:
        self.events.append(event)

    def is_stopped(self) -> bool:
        return self._stop_requested

    def request_stop(self) -> None:
        self._stop_requested = True


class _StoppedQueueManager(_FakeQueueManager):
    @override
    def is_stopped(self) -> bool:
        return True


class _RecordingFakeAgentBackendRunClient(FakeAgentBackendRunClient):
    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.cancelled_run_ids: list[str] = []
        self.cancel_after: list[str | None] = []

    @override
    def cancel_run(self, run_id: str, request: CancelRunRequest | None = None) -> CancelRunResponse:
        self.cancelled_run_ids.append(run_id)
        return super().cancel_run(run_id, request=request)

    @override
    def cancel_run_and_wait(
        self,
        run_id: str,
        request: CancelRunRequest | None = None,
        *,
        after: str | None = None,
    ) -> RunCancelledEvent:
        self.cancel_after.append(after)
        return super().cancel_run_and_wait(run_id, request=request, after=after)


class _CancelAndWaitFailingClient(_RecordingFakeAgentBackendRunClient):
    @override
    def cancel_run_and_wait(
        self,
        run_id: str,
        request: CancelRunRequest | None = None,
        *,
        after: str | None = None,
    ) -> RunCancelledEvent:
        del request
        self.cancel_after.append(after)
        raise RuntimeError(f"failed to finish cancelling {run_id}")


class _UsageCancellationClient(_RecordingFakeAgentBackendRunClient):
    @override
    def cancel_run_and_wait(
        self,
        run_id: str,
        request: CancelRunRequest | None = None,
        *,
        after: str | None = None,
    ) -> RunCancelledEvent:
        event = super().cancel_run_and_wait(run_id, request=request, after=after)
        return event.model_copy(
            update={
                "data": event.data.model_copy(
                    update={"usage": AgentRunUsage(prompt_tokens=13, completion_tokens=8, total_price=Decimal("0.21"))}
                )
            }
        )


class _UsageFailedClient(FakeAgentBackendRunClient):
    @override
    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, should_stop
        yield RunStartedEvent(id="1-0", run_id=run_id)
        yield RunFailedEvent(
            id="2-0",
            run_id=run_id,
            data=RunFailedEventData(
                error="failed after model calls",
                usage=AgentRunUsage(
                    prompt_tokens=7,
                    completion_tokens=5,
                    total_price=Decimal("0.12"),
                    latency=0.4,
                ),
            ),
        )


class _UsagePausedClient(FakeAgentBackendRunClient):
    def __init__(self) -> None:
        super().__init__(scenario=FakeAgentBackendScenario.PAUSED)

    @override
    def _events(self, run_id: str) -> tuple[RunEvent, ...]:
        events = super()._events(run_id)
        terminal = events[-1]
        assert isinstance(terminal, RunSucceededEvent)
        return (
            *events[:-1],
            terminal.model_copy(
                update={
                    "data": terminal.data.model_copy(
                        update={"usage": AgentRunUsage(prompt_tokens=5, completion_tokens=3)}
                    )
                }
            ),
        )


class _RunLimitBindingLostFakeAgentBackendRunClient(FakeAgentBackendRunClient):
    @override
    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, should_stop
        created_at = datetime(2026, 1, 1, tzinfo=UTC)
        yield RunStartedEvent(id="1-0", run_id=run_id, created_at=created_at)
        yield RunFailedEvent(
            id="2-0",
            run_id=run_id,
            created_at=created_at,
            data=RunFailedEventData(
                error="run limit reached",
                error_type=RunFailureType.AGENT_RUN_LIMIT_EXCEEDED,
                reason="binding_lost",
            ),
        )


class _TerminalWithoutSnapshotFakeAgentBackendRunClient(FakeAgentBackendRunClient):
    def __init__(self, *, terminal_type: str) -> None:
        super().__init__()
        self.terminal_type = terminal_type

    @override
    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, should_stop
        created_at = datetime(2026, 1, 1, tzinfo=UTC)
        yield RunStartedEvent(id="1-0", run_id=run_id, created_at=created_at)
        if self.terminal_type == "failed":
            yield RunFailedEvent(
                id="2-0",
                run_id=run_id,
                created_at=created_at,
                data=RunFailedEventData(error="failed without snapshot"),
            )
        else:
            yield RunCancelledEvent(
                id="2-0",
                run_id=run_id,
                created_at=created_at,
                data=RunCancelledEventData(reason="cancelled without snapshot"),
            )


class _StreamingFakeAgentBackendRunClient(FakeAgentBackendRunClient):
    @override
    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, should_stop
        created_at = datetime(2026, 1, 1, tzinfo=UTC)
        yield RunStartedEvent(id="1-0", run_id=run_id, created_at=created_at)
        yield PydanticAIStreamRunEvent(
            id="2-0",
            run_id=run_id,
            created_at=created_at,
            data=PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="hello ")),
            agent_message_delta="hello ",
        )
        yield PydanticAIStreamRunEvent(
            id="3-0",
            run_id=run_id,
            created_at=created_at,
            data=PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="agent")),
            agent_message_delta="agent",
        )
        yield RunSucceededEvent(
            id="4-0",
            run_id=run_id,
            created_at=created_at,
            data=RunSucceededEventData(
                output={"text": "hello agent"},
                session_snapshot=CompositorSessionSnapshot(layers=[]),
                usage=AgentRunUsage(
                    prompt_tokens=3,
                    prompt_unit_price=Decimal(5),
                    prompt_price_unit=Decimal("0.000001"),
                    prompt_price=Decimal("0.000015"),
                    completion_tokens=5,
                    completion_unit_price=Decimal(30),
                    completion_price_unit=Decimal("0.000001"),
                    completion_price=Decimal("0.000150"),
                    total_price=Decimal("0.000165"),
                    currency="USD",
                    latency=0.5,
                ),
            ),
        )


class _StreamingStopAfterFirstDeltaFakeAgentBackendRunClient(_RecordingFakeAgentBackendRunClient):
    def __init__(self, *, queue_manager: _FakeQueueManager, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._queue_manager = queue_manager

    @override
    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, should_stop
        created_at = datetime(2026, 1, 1, tzinfo=UTC)
        yield RunStartedEvent(id="1-0", run_id=run_id, created_at=created_at)
        yield PydanticAIStreamRunEvent(
            id="2-0",
            run_id=run_id,
            created_at=created_at,
            data=PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="hello ")),
            agent_message_delta="hello ",
        )
        self._queue_manager.request_stop()
        yield PydanticAIStreamRunEvent(
            id="3-0",
            run_id=run_id,
            created_at=created_at,
            data=PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="agent")),
            agent_message_delta="agent",
        )


class _StreamingSingleAgentMessageDeltaFakeAgentBackendRunClient(FakeAgentBackendRunClient):
    @override
    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, should_stop
        created_at = datetime(2026, 1, 1, tzinfo=UTC)
        yield RunStartedEvent(id="1-0", run_id=run_id, created_at=created_at)
        yield PydanticAIStreamRunEvent(
            id="2-0",
            run_id=run_id,
            created_at=created_at,
            data=PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="hello")),
            agent_message_delta="hello",
        )
        yield RunSucceededEvent(
            id="3-0",
            run_id=run_id,
            created_at=created_at,
            data=RunSucceededEventData(
                output={"text": "hello agent"},
                session_snapshot=CompositorSessionSnapshot(layers=[]),
            ),
        )


class _NullOutputFakeAgentBackendRunClient(FakeAgentBackendRunClient):
    @override
    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, should_stop
        created_at = datetime(2026, 1, 1, tzinfo=UTC)
        yield RunStartedEvent(id="1-0", run_id=run_id, created_at=created_at)
        yield RunSucceededEvent(
            id="2-0",
            run_id=run_id,
            created_at=created_at,
            data=RunSucceededEventData(
                output=None,
                session_snapshot=CompositorSessionSnapshot(layers=[]),
            ),
        )


class _StreamingTextNullOutputFakeAgentBackendRunClient(FakeAgentBackendRunClient):
    @override
    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, should_stop
        created_at = datetime(2026, 1, 1, tzinfo=UTC)
        yield RunStartedEvent(id="1-0", run_id=run_id, created_at=created_at)
        yield PydanticAIStreamRunEvent(
            id="2-0",
            run_id=run_id,
            created_at=created_at,
            data=PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="streamed answer")),
            agent_message_delta="streamed answer",
        )
        yield RunSucceededEvent(
            id="3-0",
            run_id=run_id,
            created_at=created_at,
            data=RunSucceededEventData(
                output=None,
                session_snapshot=CompositorSessionSnapshot(layers=[]),
            ),
        )


class _AgentAnswerStreamingFakeAgentBackendRunClient(FakeAgentBackendRunClient):
    @override
    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, should_stop
        created_at = datetime(2026, 1, 1, tzinfo=UTC)
        yield RunStartedEvent(id="1-0", run_id=run_id, created_at=created_at)
        yield PydanticAIStreamRunEvent(
            id="2-0",
            run_id=run_id,
            created_at=created_at,
            data=PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="hello ")),
            agent_message_delta="hello ",
        )
        yield PydanticAIStreamRunEvent(
            id="3-0",
            run_id=run_id,
            created_at=created_at,
            data=PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="agent")),
            agent_message_delta="agent",
        )
        yield RunSucceededEvent(
            id="4-0",
            run_id=run_id,
            created_at=created_at,
            data=RunSucceededEventData(
                output={"text": "final answer"},
                session_snapshot=CompositorSessionSnapshot(layers=[]),
            ),
        )


class _ProcessStreamingFakeAgentBackendRunClient(FakeAgentBackendRunClient):
    @override
    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, should_stop
        created_at = datetime(2026, 1, 1, tzinfo=UTC)
        yield RunStartedEvent(id="1-0", run_id=run_id, created_at=created_at)
        yield PydanticAIStreamRunEvent(
            id="2-0",
            run_id=run_id,
            created_at=created_at,
            data=PartDeltaEvent(index=0, delta=ThinkingPartDelta(content_delta="I need to inspect the file.")),
        )
        yield PydanticAIStreamRunEvent(
            id="3-0",
            run_id=run_id,
            created_at=created_at,
            data=FunctionToolCallEvent(part=ToolCallPart(tool_name="bash", args={"cmd": "ls"}, tool_call_id="tool-1")),
        )
        yield PydanticAIStreamRunEvent(
            id="4-0",
            run_id=run_id,
            created_at=created_at,
            data=FunctionToolResultEvent(part=ToolReturnPart(tool_name="bash", content="ok", tool_call_id="tool-1")),
        )
        yield PydanticAIStreamRunEvent(
            id="5-0",
            run_id=run_id,
            created_at=created_at,
            data=PartDeltaEvent(index=1, delta=TextPartDelta(content_delta="final answer")),
            agent_message_delta="final answer",
        )
        yield RunSucceededEvent(
            id="6-0",
            run_id=run_id,
            created_at=created_at,
            data=RunSucceededEventData(
                output={"text": "final answer"},
                session_snapshot=CompositorSessionSnapshot(layers=[]),
            ),
        )


class _FakeSessionStore:
    def __init__(
        self,
        loaded: CompositorSessionSnapshot | None = None,
        loaded_session: StoredAgentAppSession | None = None,
        binding_id: str = "binding-1",
        workspace_id: str = "workspace-1",
        backend_binding_ref: str = "backend-binding-1",
    ) -> None:
        self.loaded = loaded
        self._loaded_session = loaded_session
        self.binding_id = binding_id
        self.workspace_id = workspace_id
        self.backend_binding_ref = backend_binding_ref
        self.resolved_scopes: list[AgentAppSessionScope] = []
        self.saved: list[
            tuple[
                AgentAppSessionScope,
                str,
                CompositorSessionSnapshot | None,
                str | None,
                str | None,
            ]
        ] = []

    def load_or_create(self, scope: AgentAppSessionScope) -> StoredAgentAppSession:
        self.resolved_scopes.append(scope)
        if self._loaded_session is not None:
            return self._loaded_session
        return StoredAgentAppSession(
            scope=scope,
            binding_id=self.binding_id,
            workspace_id=self.workspace_id,
            backend_binding_ref=self.backend_binding_ref,
            session_snapshot=self.loaded,
        )

    def save_active_snapshot(
        self,
        *,
        scope: AgentAppSessionScope,
        binding_id: str,
        snapshot: CompositorSessionSnapshot | None,
        pending_form_id: str | None = None,
        pending_tool_call_id: str | None = None,
    ) -> None:
        self.saved.append((scope, binding_id, snapshot, pending_form_id, pending_tool_call_id))


class _ExplodingSessionStore(_FakeSessionStore):
    def __init__(self, loaded: CompositorSessionSnapshot | None = None) -> None:
        super().__init__(loaded=loaded)
        self.save_attempts: list[CompositorSessionSnapshot | None] = []

    @override
    def save_active_snapshot(
        self,
        *,
        scope: AgentAppSessionScope,
        binding_id: str,
        snapshot: CompositorSessionSnapshot | None,
        pending_form_id: str | None = None,
        pending_tool_call_id: str | None = None,
    ) -> None:
        del scope, binding_id, pending_form_id, pending_tool_call_id
        self.save_attempts.append(snapshot)
        raise RuntimeError("session save failed")


class _MonotonicClock:
    def __init__(self, *values: float) -> None:
        self._values = list(values)
        self._index = 0

    def __call__(self) -> float:
        if self._index >= len(self._values):
            return self._values[-1]
        value = self._values[self._index]
        self._index += 1
        return value


def _soul() -> AgentSoulConfig:
    return AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "langgenius/openai/openai",
                "model": "gpt-4o-mini",
            },
            "prompt": {"system_prompt": "You are Iris."},
        }
    )


def _dify_ctx() -> DifyRunContext:
    return DifyRunContext(
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="user-1",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )


def _runner(
    client: FakeAgentBackendRunClient,
    store: _FakeSessionStore,
    *,
    text_delta_debounce_seconds: float = 0,
) -> AgentAppRunner:
    return AgentAppRunner(
        request_builder=AgentAppRuntimeRequestBuilder(
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        ),
        agent_backend_client=client,
        event_adapter=AgentBackendRunEventAdapter(),
        session_store=store,  # type: ignore[arg-type]
        text_delta_debounce_seconds=text_delta_debounce_seconds,
    )


def _run(runner: AgentAppRunner, qm: _FakeQueueManager) -> None:
    runner.run(
        dify_context=_dify_ctx(),
        agent_id="agent-1",
        agent_config_snapshot_id="snap-1",
        agent_soul=_soul(),
        home_snapshot_id="home-1",
        conversation_id="conv-1",
        query="hello",
        message_id="msg-1",
        model_name="gpt-4o-mini",
        queue_manager=qm,  # type: ignore[arg-type]
    )


def _message_record() -> Message:
    message = Message(
        app_id="app-1",
        conversation_id="conv-1",
        inputs={},
        query="hello",
        message={},
        message_tokens=0,
        message_unit_price=0,
        message_price_unit=0,
        answer="",
        answer_tokens=0,
        answer_unit_price=0,
        answer_price_unit=0,
        provider_response_latency=0,
        total_price=0,
        currency="USD",
        invoke_from=InvokeFrom.WEB_APP,
        from_source=ConversationFromSource.API,
        from_end_user_id="user-1",
        from_account_id=None,
        app_mode=AppMode.AGENT,
    )
    message.id = "msg-1"
    return message


def _message_end(qm: _FakeQueueManager) -> QueueMessageEndEvent:
    return next(e for e in qm.events if isinstance(e, QueueMessageEndEvent))


def _llm_result(qm: _FakeQueueManager) -> LLMResult:
    llm_result = _message_end(qm).llm_result
    assert llm_result is not None
    return llm_result


def _saved_user_query(qm: _FakeQueueManager) -> str:
    llm_result = _llm_result(qm)
    prompt_messages = llm_result.prompt_messages
    assert len(prompt_messages) == 1
    content = prompt_messages[0].content
    assert isinstance(content, str)
    return content


def test_successful_turn_publishes_chunk_and_message_end_and_saves_session() -> None:
    client = FakeAgentBackendRunClient()  # SUCCESS: output {"text": "hello agent"}
    store = _FakeSessionStore()
    qm = _FakeQueueManager()

    _run(_runner(client, store), qm)

    assert client.request is not None
    assert client.request.on_exit.default.value == "suspend"
    # One LLM chunk + one message-end, carrying the backend's answer text.
    chunk_events = [e for e in qm.events if isinstance(e, QueueLLMChunkEvent)]
    end_events = [e for e in qm.events if isinstance(e, QueueMessageEndEvent)]
    assert len(chunk_events) == 1
    assert len(end_events) == 1
    assert chunk_events[0].chunk.delta.message.content == "hello agent"
    assert _llm_result(qm).message.content == "hello agent"
    assert _llm_result(qm).model == "gpt-4o-mini"
    assert _saved_user_query(qm) == "hello"
    # The conversation session snapshot is persisted for multi-turn continuity.
    assert store.saved
    saved_scope, saved_binding_id, saved_snapshot, pending_form_id, pending_tool_call_id = store.saved[0]
    assert saved_scope.conversation_id == "conv-1"
    assert saved_scope.agent_config_snapshot_id == "snap-1"
    assert saved_binding_id == "binding-1"
    assert saved_snapshot is not None
    # A successful turn carries no ask_human pause correlation.
    assert pending_form_id is None
    assert pending_tool_call_id is None


def test_turn_uses_resolved_backend_binding_before_backend_invocation() -> None:
    client = FakeAgentBackendRunClient()
    store = _FakeSessionStore(binding_id="binding-2", backend_binding_ref="backend-binding-2")

    _run(_runner(client, store), _FakeQueueManager())

    assert client.request is not None
    layers = {layer["name"]: layer for layer in client.request.model_dump(mode="json")["composition"]["layers"]}
    assert layers["runtime"]["config"]["backend_binding_ref"] == "backend-binding-2"
    assert store.saved[0][1] == "binding-2"
    assert len(store.resolved_scopes) == 1


def test_successful_turn_routes_stream_text_to_agent_message_and_uses_terminal_output(
    sqlite_session: Session,
) -> None:
    client = _StreamingFakeAgentBackendRunClient()
    store = _FakeSessionStore()
    qm = _FakeQueueManager()

    _run(_runner(client, store), qm)

    chunk_events = [e for e in qm.events if isinstance(e, QueueLLMChunkEvent)]
    agent_message_events = [e for e in qm.events if isinstance(e, QueueAgentMessageEvent)]
    end_events = [e for e in qm.events if isinstance(e, QueueMessageEndEvent)]
    assert [event.chunk.delta.message.content for event in chunk_events] == ["hello agent"]
    assert [event.chunk.delta.message.content for event in agent_message_events] == ["hello ", "agent"]
    assert len(end_events) == 1
    llm_result = _llm_result(qm)
    assert llm_result.message.content == "hello agent"
    assert llm_result.usage.prompt_tokens == 3
    assert llm_result.usage.completion_tokens == 5
    assert llm_result.usage.total_tokens == 8
    assert llm_result.usage.prompt_price == Decimal("0.000015")
    assert llm_result.usage.completion_price == Decimal("0.000150")
    assert llm_result.usage.total_price == Decimal("0.000165")
    assert llm_result.usage.currency == "USD"
    rows = _thought_rows(sqlite_session)
    assert rows == []
    assert store.saved


def test_successful_turn_persists_usage_without_a_queue_consumer(sqlite_session: Session) -> None:
    sqlite_session.add(_message_record())
    sqlite_session.flush()

    _run(
        _runner(_StreamingFakeAgentBackendRunClient(), _FakeSessionStore()),
        _FakeQueueManager(),
    )

    sqlite_session.expire_all()
    message = sqlite_session.get(Message, "msg-1")
    assert message is not None
    assert message.message_tokens == 3
    assert message.answer_tokens == 5
    assert message.total_price == Decimal("0.000165")
    assert message.message_metadata is not None
    assert json.loads(message.message_metadata)["usage"]["total_tokens"] == 8


def test_successful_turn_routes_single_agent_message_delta(sqlite_session: Session) -> None:
    client = _StreamingSingleAgentMessageDeltaFakeAgentBackendRunClient()
    store = _FakeSessionStore()
    qm = _FakeQueueManager()

    _run(_runner(client, store), qm)

    chunk_events = [e for e in qm.events if isinstance(e, QueueLLMChunkEvent)]
    agent_message_events = [e for e in qm.events if isinstance(e, QueueAgentMessageEvent)]
    end_events = [e for e in qm.events if isinstance(e, QueueMessageEndEvent)]
    assert [event.chunk.delta.message.content for event in chunk_events] == ["hello agent"]
    assert [event.chunk.delta.message.content for event in agent_message_events] == ["hello"]
    assert len(end_events) == 1
    assert _llm_result(qm).message.content == "hello agent"
    rows = _thought_rows(sqlite_session)
    assert rows == []


def test_thought_commit_failure_rolls_back_and_turn_continues(sqlite_session: Session) -> None:
    rollback_events: list[Session] = []
    should_fail = True

    def fail_first_commit(_session: Session) -> None:
        nonlocal should_fail
        if should_fail:
            should_fail = False
            raise RuntimeError("forced thought commit failure")

    def record_rollback(session: Session) -> None:
        rollback_events.append(session)

    event.listen(sqlite_session, "before_commit", fail_first_commit)
    event.listen(sqlite_session, "after_rollback", record_rollback)
    try:
        client = _StreamingSingleAgentMessageDeltaFakeAgentBackendRunClient()
        store = _FakeSessionStore()
        qm = _FakeQueueManager()

        _run(_runner(client, store), qm)
    finally:
        event.remove(sqlite_session, "before_commit", fail_first_commit)
        event.remove(sqlite_session, "after_rollback", record_rollback)

    assert rollback_events == [sqlite_session]
    assert _thought_rows(sqlite_session) == []
    assert _llm_result(qm).message.content == "hello agent"


def test_successful_turn_with_null_terminal_output_publishes_empty_answer_not_literal_null() -> None:
    client = _NullOutputFakeAgentBackendRunClient()
    store = _FakeSessionStore()
    qm = _FakeQueueManager()

    _run(_runner(client, store), qm)

    chunk_events = [e for e in qm.events if isinstance(e, QueueLLMChunkEvent)]
    agent_message_events = [e for e in qm.events if isinstance(e, QueueAgentMessageEvent)]
    end_events = [e for e in qm.events if isinstance(e, QueueMessageEndEvent)]
    assert chunk_events == []
    assert agent_message_events == []
    assert len(end_events) == 1
    assert _llm_result(qm).message.content == ""


def test_successful_turn_with_stream_text_and_null_terminal_output_keeps_empty_message(
    sqlite_session: Session,
) -> None:
    client = _StreamingTextNullOutputFakeAgentBackendRunClient()
    store = _FakeSessionStore()
    qm = _FakeQueueManager()

    _run(_runner(client, store), qm)

    chunk_events = [e for e in qm.events if isinstance(e, QueueLLMChunkEvent)]
    agent_message_events = [e for e in qm.events if isinstance(e, QueueAgentMessageEvent)]
    end_events = [e for e in qm.events if isinstance(e, QueueMessageEndEvent)]
    assert chunk_events == []
    assert [event.chunk.delta.message.content for event in agent_message_events] == ["streamed answer"]
    assert len(end_events) == 1
    assert _llm_result(qm).message.content == ""
    rows = _thought_rows(sqlite_session)
    assert len(rows) == 1
    assert rows[0].answer == "streamed answer"


def test_successful_turn_routes_agent_answer_to_agent_message(sqlite_session: Session) -> None:
    client = _AgentAnswerStreamingFakeAgentBackendRunClient()
    store = _FakeSessionStore()
    qm = _FakeQueueManager()

    _run(_runner(client, store), qm)

    chunk_events = [e for e in qm.events if isinstance(e, QueueLLMChunkEvent)]
    agent_message_events = [e for e in qm.events if isinstance(e, QueueAgentMessageEvent)]
    assert [event.chunk.delta.message.content for event in chunk_events] == ["final answer"]
    assert [event.chunk.delta.message.content for event in agent_message_events] == ["hello ", "agent"]
    end_events = [e for e in qm.events if isinstance(e, QueueMessageEndEvent)]
    assert len(end_events) == 1
    assert _llm_result(qm).message.content == "final answer"
    thought_events = [e for e in qm.events if isinstance(e, QueueAgentThoughtEvent)]
    assert len(thought_events) == 2

    rows = _thought_rows(sqlite_session)
    assert len(rows) == 1
    assert rows[0].answer == "hello agent"
    assert rows[0].thought == ""
    assert rows[0].tool == ""


def test_agent_message_deltas_are_debounced_to_agent_message(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr(app_runner_module.time, "monotonic", _MonotonicClock(0.0, 0.2))
    client = _StreamingFakeAgentBackendRunClient()
    store = _FakeSessionStore()
    qm = _FakeQueueManager()

    _run(_runner(client, store, text_delta_debounce_seconds=0.5), qm)

    chunk_events = [e for e in qm.events if isinstance(e, QueueLLMChunkEvent)]
    agent_message_events = [e for e in qm.events if isinstance(e, QueueAgentMessageEvent)]
    assert [event.chunk.delta.message.content for event in chunk_events] == ["hello agent"]
    assert [event.chunk.delta.message.content for event in agent_message_events] == ["hello agent"]
    rows = _thought_rows(sqlite_session)
    assert rows == []


def test_successful_turn_persists_thinking_and_tool_process_events(
    sqlite_session: Session,
) -> None:
    client = _ProcessStreamingFakeAgentBackendRunClient()
    store = _FakeSessionStore()
    qm = _FakeQueueManager()

    _run(_runner(client, store), qm)

    chunk_events = [e for e in qm.events if isinstance(e, QueueLLMChunkEvent)]
    agent_message_events = [e for e in qm.events if isinstance(e, QueueAgentMessageEvent)]
    assert [event.chunk.delta.message.content for event in chunk_events] == ["final answer"]
    assert [event.chunk.delta.message.content for event in agent_message_events] == ["final answer"]
    thought_events = [e for e in qm.events if isinstance(e, QueueAgentThoughtEvent)]
    assert len(thought_events) >= 3

    rows = _thought_rows(sqlite_session)
    assert rows[0].thought == "I need to inspect the file."
    assert rows[0].tool == ""
    assert rows[1].tool == "bash"
    assert rows[1].tool_input == '{"cmd": "ls"}'
    assert rows[1].observation == "ok"
    assert len(rows) == 2


def test_streaming_turn_cancels_after_persisting_seen_agent_answer(
    sqlite_session: Session,
) -> None:
    store = _FakeSessionStore()
    qm = _FakeQueueManager()
    client = _StreamingStopAfterFirstDeltaFakeAgentBackendRunClient(queue_manager=qm)

    with pytest.raises(GenerateTaskStoppedError):
        _run(_runner(client, store), qm)

    chunk_events = [e for e in qm.events if isinstance(e, QueueLLMChunkEvent)]
    agent_message_events = [e for e in qm.events if isinstance(e, QueueAgentMessageEvent)]
    assert chunk_events == []
    assert [event.chunk.delta.message.content for event in agent_message_events] == ["hello "]
    rows = _thought_rows(sqlite_session)
    assert len(rows) == 1
    assert rows[0].answer == "hello "
    assert client.cancelled_run_ids == ["fake-run-1"]
    assert client.cancel_after == ["3-0"]


def test_tool_result_without_identity_does_not_attach_to_previous_tool(
    sqlite_session: Session,
) -> None:
    qm = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(),
        message_id="msg-1",
        queue_manager=qm,  # type: ignore[arg-type]
    )

    recorder.handle_stream_event(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "function_tool_call",
                "part": {
                    "part_kind": "tool-call",
                    "tool_name": "shell_run",
                    "args": {"script": "npx skills find browser"},
                    "tool_call_id": "shell-call-1",
                },
            },
        )
    )
    recorder.handle_stream_event(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "function_tool_result",
                "content": "Knowledge base search results: browser skill",
            },
        )
    )

    rows = _thought_rows(sqlite_session)
    assert len(rows) == 2
    assert rows[0].tool == "shell_run"
    assert rows[0].tool_input == '{"script": "npx skills find browser"}'
    assert rows[0].observation == ""
    assert rows[1].tool == ""
    assert rows[1].tool_input == ""
    assert rows[1].observation == "Knowledge base search results: browser skill"


def test_answer_suffix_trim_keeps_non_terminal_prefix(sqlite_session: Session) -> None:
    qm = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(),
        message_id="msg-1",
        queue_manager=qm,  # type: ignore[arg-type]
    )

    recorder.append_answer_text("intermediate final answer")
    recorder.trim_answer_suffix("final answer")

    rows = _thought_rows(sqlite_session)
    assert len(rows) == 1
    assert rows[0].answer == "intermediate "


def test_tool_call_part_binds_late_call_id_to_delta_row(sqlite_session: Session) -> None:
    qm = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(),
        message_id="msg-1",
        queue_manager=qm,  # type: ignore[arg-type]
    )

    recorder.handle_stream_event(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "part_delta",
                "index": 0,
                "delta": {
                    "part_delta_kind": "tool_call",
                    "tool_name_delta": "knowledge_base_search",
                    "args_delta": {"query": "browser"},
                },
            },
        )
    )
    recorder.handle_stream_event(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "part_start",
                "index": 0,
                "part": {
                    "part_kind": "tool-call",
                    "tool_name": "knowledge_base_search",
                    "args": {"query": "browser"},
                    "tool_call_id": "tool-call-1",
                },
            },
        )
    )
    recorder.handle_stream_event(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "function_tool_result",
                "part": {
                    "part_kind": "tool-return",
                    "tool_name": "knowledge_base_search",
                    "content": "Knowledge base search results: browser skill",
                    "tool_call_id": "tool-call-1",
                },
            },
        )
    )

    rows = _thought_rows(sqlite_session)
    assert len(rows) == 1
    assert rows[0].tool == "knowledge_base_search"
    assert rows[0].tool_input == '{"query": "browser"}'
    assert rows[0].observation == "Knowledge base search results: browser skill"


def test_thinking_after_tool_starts_new_snapshot_row(sqlite_session: Session) -> None:
    qm = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(),
        message_id="msg-1",
        queue_manager=qm,  # type: ignore[arg-type]
    )

    recorder.handle_stream_event(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "part_delta",
                "index": 0,
                "delta": {
                    "part_delta_kind": "thinking",
                    "content_delta": "The first thought.",
                },
            },
        )
    )
    recorder.handle_stream_event(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "function_tool_call",
                "part": {
                    "part_kind": "tool-call",
                    "tool_name": "shell_run",
                    "args": {"cmd": "date"},
                    "tool_call_id": "tool-call-1",
                },
            },
        )
    )
    recorder.handle_stream_event(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "part_delta",
                "index": 0,
                "delta": {
                    "part_delta_kind": "thinking",
                    "content_delta": "The next thought.",
                },
            },
        )
    )

    rows = _thought_rows(sqlite_session)
    assert [row.thought for row in rows] == ["The first thought.", "", "The next thought."]
    assert rows[0].id != rows[2].id
    assert rows[1].tool == "shell_run"
    assert rows[1].tool_input == '{"cmd": "date"}'


def test_tool_result_without_call_id_matches_unique_open_tool_name(
    sqlite_session: Session,
) -> None:
    qm = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(),
        message_id="msg-1",
        queue_manager=qm,  # type: ignore[arg-type]
    )

    recorder.handle_stream_event(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "function_tool_call",
                "part": {
                    "part_kind": "tool-call",
                    "tool_name": "knowledge_base_search",
                    "args": {"query": "browser"},
                },
            },
        )
    )
    recorder.handle_stream_event(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "function_tool_result",
                "part": {
                    "part_kind": "tool-return",
                    "tool_name": "knowledge_base_search",
                    "content": "Knowledge base search results: browser skill",
                },
            },
        )
    )

    rows = _thought_rows(sqlite_session)
    assert len(rows) == 1
    assert rows[0].tool == "knowledge_base_search"
    assert rows[0].tool_input == '{"query": "browser"}'
    assert rows[0].observation == "Knowledge base search results: browser skill"


def test_repeated_tool_calls_without_call_id_or_index_create_distinct_rows(
    sqlite_session: Session,
) -> None:
    qm = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(),
        message_id="msg-1",
        queue_manager=qm,  # type: ignore[arg-type]
    )

    recorder.handle_stream_event(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "function_tool_call",
                "part": {
                    "part_kind": "tool-call",
                    "tool_name": "shell_run",
                    "args": {"script": "lookup find"},
                },
            },
        )
    )
    recorder.handle_stream_event(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "function_tool_result",
                "part": {
                    "part_kind": "tool-return",
                    "tool_name": "shell_run",
                    "content": "find output",
                },
            },
        )
    )
    recorder.handle_stream_event(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "function_tool_call",
                "part": {
                    "part_kind": "tool-call",
                    "tool_name": "shell_run",
                    "args": {"script": "lookup out"},
                },
            },
        )
    )
    recorder.handle_stream_event(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "function_tool_result",
                "part": {
                    "part_kind": "tool-return",
                    "tool_name": "shell_run",
                    "content": "out output",
                },
            },
        )
    )

    rows = _thought_rows(sqlite_session)
    assert len(rows) == 2
    assert rows[0].tool == "shell_run"
    assert rows[0].tool_input == '{"script": "lookup find"}'
    assert rows[0].observation == "find output"
    assert rows[1].tool == "shell_run"
    assert rows[1].tool_input == '{"script": "lookup out"}'
    assert rows[1].observation == "out output"


def test_repeated_tool_calls_with_placeholder_call_id_and_reused_index_create_distinct_rows(
    sqlite_session: Session,
) -> None:
    qm = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(),
        message_id="msg-1",
        queue_manager=qm,  # type: ignore[arg-type]
    )

    for script, output in (("lookup find", "find output"), ("lookup out", "out output")):
        recorder.handle_stream_event(
            AgentBackendStreamInternalEvent(
                run_id="run-1",
                data={
                    "event_kind": "function_tool_call",
                    "index": 0,
                    "part": {
                        "part_kind": "tool-call",
                        "tool_name": "shell_run",
                        "tool_call_id": "None",
                        "args": {"script": script},
                    },
                },
            )
        )
        recorder.handle_stream_event(
            AgentBackendStreamInternalEvent(
                run_id="run-1",
                data={
                    "event_kind": "function_tool_result",
                    "part": {
                        "part_kind": "tool-return",
                        "tool_name": "shell_run",
                        "tool_call_id": "None",
                        "content": output,
                    },
                },
            )
        )

    rows = _thought_rows(sqlite_session)
    assert len(rows) == 2
    assert rows[0].tool == "shell_run"
    assert rows[0].tool_input == '{"script": "lookup find"}'
    assert rows[0].observation == "find output"
    assert rows[1].tool == "shell_run"
    assert rows[1].tool_input == '{"script": "lookup out"}'
    assert rows[1].observation == "out output"


def test_prior_session_snapshot_is_threaded_into_request() -> None:
    prior = CompositorSessionSnapshot(layers=[])
    client = FakeAgentBackendRunClient()
    store = _FakeSessionStore(loaded=prior)
    qm = _FakeQueueManager()

    _run(_runner(client, store), qm)

    assert client.request is not None
    assert client.request.session_snapshot is prior


def test_debug_session_scope_can_reuse_conversation_across_config_snapshots() -> None:
    prior = CompositorSessionSnapshot(layers=[])
    client = FakeAgentBackendRunClient()
    store = _FakeSessionStore(loaded=prior)
    qm = _FakeQueueManager()

    _runner(client, store).run(
        dify_context=_dify_ctx(),
        agent_id="agent-1",
        agent_config_snapshot_id="snap-new",
        agent_soul=_soul(),
        home_snapshot_id="home-1",
        conversation_id="conv-1",
        query="hello",
        message_id="msg-1",
        model_name="gpt-4o-mini",
        queue_manager=qm,  # type: ignore[arg-type]
        session_scope_snapshot_id=None,
    )

    assert client.request is not None
    assert client.request.session_snapshot is prior
    assert store.resolved_scopes[0].agent_config_snapshot_id == "snap-new"
    assert store.saved[0][0].agent_config_snapshot_id == "snap-new"


def test_failed_run_raises_agent_backend_error() -> None:
    client = FakeAgentBackendRunClient(scenario=FakeAgentBackendScenario.FAILED)
    store = _FakeSessionStore()
    qm = _FakeQueueManager()

    with pytest.raises(AgentBackendRunFailedError, match="fake failure .*agent_run_id=fake-run-1"):
        _run(_runner(client, store), qm)
    # No message-end on failure; post-exit session state is still saved.
    assert not [e for e in qm.events if isinstance(e, QueueMessageEndEvent)]
    assert store.saved[0][2] == CompositorSessionSnapshot(layers=[])


def test_failed_run_persists_partial_usage(sqlite_session: Session) -> None:
    sqlite_session.add(_message_record())
    sqlite_session.flush()

    with pytest.raises(AgentBackendRunFailedError, match="failed after model calls"):
        _run(_runner(_UsageFailedClient(), _FakeSessionStore()), _FakeQueueManager())

    sqlite_session.expire_all()
    message = sqlite_session.get(Message, "msg-1")
    assert message is not None
    assert message.message_tokens == 7
    assert message.answer_tokens == 5
    assert message.total_price == Decimal("0.12")
    assert message.provider_response_latency == 0.4
    assert message.message_metadata is not None
    assert json.loads(message.message_metadata)["usage"]["total_tokens"] == 12


def test_partial_usage_persistence_ignores_missing_message() -> None:
    AgentAppRunner._persist_message_usage(
        message_id="missing",
        usage=LLMUsage.from_metadata({"prompt_tokens": 2, "completion_tokens": 1}),
    )


@pytest.mark.parametrize("metadata", ["{", "[]"])
def test_partial_usage_persistence_recovers_invalid_metadata(metadata: str, sqlite_session: Session) -> None:
    message = _message_record()
    message.message_metadata = metadata
    sqlite_session.add(message)
    sqlite_session.flush()

    AgentAppRunner._persist_message_usage(
        message_id=message.id,
        usage=LLMUsage.from_metadata({"prompt_tokens": 2, "completion_tokens": 1}),
    )

    sqlite_session.expire_all()
    persisted = sqlite_session.get(Message, message.id)
    assert persisted is not None
    assert persisted.message_metadata is not None
    assert json.loads(persisted.message_metadata)["usage"]["total_tokens"] == 3


def test_partial_usage_persistence_rolls_back_database_error(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.get.side_effect = RuntimeError("database unavailable")
    monkeypatch.setattr(app_runner_module.db, "session", session)

    AgentAppRunner._persist_message_usage(
        message_id="msg-1",
        usage=LLMUsage.from_metadata({"prompt_tokens": 2, "completion_tokens": 1}),
    )

    session.rollback.assert_called_once()


@pytest.mark.parametrize("outcome", ["failed", "stopped"])
def test_snapshot_save_failure_preserves_original_app_outcome(outcome: str) -> None:
    store = _ExplodingSessionStore()
    queue_manager: _FakeQueueManager = _FakeQueueManager() if outcome == "failed" else _StoppedQueueManager()
    client = FakeAgentBackendRunClient(
        scenario=FakeAgentBackendScenario.FAILED if outcome == "failed" else FakeAgentBackendScenario.SUCCESS
    )
    expected_error = AgentBackendRunFailedError if outcome == "failed" else GenerateTaskStoppedError

    with pytest.raises(expected_error, match="fake failure" if outcome == "failed" else None):
        _run(_runner(client, store), queue_manager)

    assert store.save_attempts == [CompositorSessionSnapshot(layers=[])]


@pytest.mark.parametrize(
    ("terminal_type", "expected_error"),
    [("failed", AgentBackendRunFailedError), ("cancelled", AgentBackendError)],
)
def test_terminal_without_snapshot_preserves_prior_app_session_without_write(
    terminal_type: str,
    expected_error: type[Exception],
) -> None:
    store = _FakeSessionStore()
    client = _TerminalWithoutSnapshotFakeAgentBackendRunClient(terminal_type=terminal_type)

    with pytest.raises(expected_error):
        _run(_runner(client, store), _FakeQueueManager())

    assert store.saved == []


def test_failed_run_prefers_run_failure_type_over_binding_lost_reason() -> None:
    client = _RunLimitBindingLostFakeAgentBackendRunClient()
    store = _FakeSessionStore()

    with pytest.raises(AgentBackendRunFailedError) as raised:
        _run(_runner(client, store), _FakeQueueManager())

    assert raised.value.error_type is RunFailureType.AGENT_RUN_LIMIT_EXCEEDED
    assert raised.value.reason == "binding_lost"


def test_agent_backend_failure_to_exception_maps_rate_limit_reason() -> None:
    err = app_runner_module._agent_backend_failure_to_exception(
        AgentBackendRunFailedInternalEvent(
            run_id="run-1",
            error="quota exceeded",
            reason="InvokeRateLimitError",
        )
    )

    assert isinstance(err, InvokeRateLimitError)
    assert str(err) == "quota exceeded"


def test_agent_backend_failure_to_exception_preserves_unknown_reason_context() -> None:
    err = app_runner_module._agent_backend_failure_to_exception(
        AgentBackendRunFailedInternalEvent(
            run_id="run-1",
            source_event_id="event-1",
            error="Knowledge retrieval failed",
            reason="knowledge_retrieve_failed",
        )
    )

    assert isinstance(err, AgentBackendRunFailedError)
    assert err.run_id == "run-1"
    assert err.reason == "knowledge_retrieve_failed"
    assert err.source_event_id == "event-1"
    assert err.detail == {
        "error": "Knowledge retrieval failed",
        "reason": "knowledge_retrieve_failed",
        "source_event_id": "event-1",
    }
    assert str(err) == "Knowledge retrieval failed (agent_run_id=run-1)"


def test_agent_backend_failure_to_exception_prefers_run_failure_type_over_known_reason() -> None:
    err = app_runner_module._agent_backend_failure_to_exception(
        AgentBackendRunFailedInternalEvent(
            run_id="run-1",
            error="run limit reached",
            error_type=RunFailureType.AGENT_RUN_LIMIT_EXCEEDED,
            reason="InvokeRateLimitError",
        )
    )

    assert isinstance(err, AgentBackendRunFailedError)
    assert err.error_type is RunFailureType.AGENT_RUN_LIMIT_EXCEEDED
    assert err.reason == "InvokeRateLimitError"
    assert err.detail == {
        "error": "run limit reached",
        "reason": "InvokeRateLimitError",
        "source_event_id": None,
    }


def test_stopped_task_waits_for_cancelled_snapshot_and_saves_session() -> None:
    client = _RecordingFakeAgentBackendRunClient()
    store = _FakeSessionStore()
    qm = _StoppedQueueManager()

    with pytest.raises(GenerateTaskStoppedError):
        _run(_runner(client, store), qm)

    assert client.cancelled_run_ids == ["fake-run-1"]
    assert len(store.saved) == 1
    assert store.saved[0][2] == CompositorSessionSnapshot(layers=[])


def test_stopped_task_persists_partial_usage(sqlite_session: Session) -> None:
    sqlite_session.add(_message_record())
    sqlite_session.flush()
    client = _UsageCancellationClient()

    with pytest.raises(GenerateTaskStoppedError):
        _run(_runner(client, _FakeSessionStore()), _StoppedQueueManager())

    sqlite_session.expire_all()
    message = sqlite_session.get(Message, "msg-1")
    assert message is not None
    assert message.message_tokens == 13
    assert message.answer_tokens == 8
    assert message.total_price == Decimal("0.21")
    assert message.message_metadata is not None
    assert json.loads(message.message_metadata)["usage"]["total_tokens"] == 21


def test_cancel_and_wait_failure_preserves_stopped_app_outcome() -> None:
    client = _CancelAndWaitFailingClient()
    store = _FakeSessionStore()

    with pytest.raises(GenerateTaskStoppedError):
        _run(_runner(client, store), _StoppedQueueManager())

    assert client.cancel_after == [None]
    assert store.saved == []


def test_terminal_output_to_answer_handles_plain_string_and_dict() -> None:
    assert AgentAppRunner._terminal_output_to_answer(None) == ""
    assert AgentAppRunner._terminal_output_to_answer("plain text") == "plain text"
    assert AgentAppRunner._terminal_output_to_answer({"text": "hi"}) == "hi"
    assert AgentAppRunner._terminal_output_to_answer({"a": 1}) == '{"a": 1}'


def test_ask_human_pauses_turn_creates_form_and_persists_correlation() -> None:
    # ENG-635/637: the PAUSED scenario emits a dify.ask_human deferred call, so
    # the chat turn ends by creating a conversation-owned HITL form + saving the
    # pause correlation, instead of crashing. Stub the form repo (DB-free).
    client = _UsagePausedClient()
    store = _FakeSessionStore()
    qm = _FakeQueueManager()
    runner = _runner(client, store)

    fake_repo = MagicMock()
    fake_repo.create_form.return_value = MagicMock(id="form-1")
    runner._build_form_repository = lambda dify_context: fake_repo  # type: ignore[assignment]

    _run(runner, qm)

    # The conversation-owned form was created and the agent's question surfaced.
    fake_repo.create_form.assert_called_once()
    created_params = fake_repo.create_form.call_args.args[0]
    assert created_params.conversation_id == "conv-1"
    assert created_params.workflow_execution_id is None
    assert [e for e in qm.events if isinstance(e, QueueMessageEndEvent)]
    assert _saved_user_query(qm) == "hello"
    assert _llm_result(qm).usage.total_tokens == 8
    # The pause correlation is persisted so a form submission can resume the run.
    assert store.saved
    assert store.saved[0][3] == "form-1"
    assert store.saved[0][4] == "fake-ask-human-1"


def test_submitted_form_resumes_turn_with_deferred_tool_results(monkeypatch: pytest.MonkeyPatch) -> None:
    # ENG-638: a turn that runs while a pending form is answered threads the
    # human's reply into the request as deferred_tool_results.
    snapshot = CompositorSessionSnapshot(layers=[])
    stored = StoredAgentAppSession(
        scope=AgentAppSessionScope(
            tenant_id="tenant-1",
            app_id="app-1",
            conversation_id="conv-1",
            agent_id="agent-1",
            agent_config_snapshot_id="snap-1",
            home_snapshot_id="home-1",
        ),
        binding_id="binding-1",
        workspace_id="workspace-1",
        backend_binding_ref="backend-binding-1",
        session_snapshot=snapshot,
        pending_form_id="form-1",
        pending_tool_call_id="call-1",
    )
    store = _FakeSessionStore(loaded_session=stored)
    submitted = AskHumanResumeOutcome(deferred_result=AskHumanToolResult(status="submitted", values={"ok": True}))
    monkeypatch.setattr(
        "core.app.apps.agent_app.app_runner.resolve_ask_human_form",
        lambda **_kwargs: submitted,
    )

    client = FakeAgentBackendRunClient()  # SUCCESS -> the resumed run completes
    qm = _FakeQueueManager()
    _run(_runner(client, store), qm)

    assert client.request is not None
    assert client.request.deferred_tool_results is not None
    assert set(client.request.deferred_tool_results.calls) == {"call-1"}
    # ENG-638: the resume composition must keep the user-prompt layer so it
    # matches the suspended snapshot's layer names (the agent backend rejects a
    # mismatch). A resume therefore re-sends a non-blank query, never blank.
    layer_names = [layer.name for layer in client.request.composition.layers]
    assert "agent_app_user_prompt" in layer_names
