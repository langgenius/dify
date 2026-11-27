"""Unit tests for the Agent App runner — verifies the agent-backend event
stream is republished as chat queue events and the conversation snapshot is
saved, using the deterministic fake backend client (no live stack)."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Generator, Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, override
from unittest.mock import MagicMock

import pytest
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
from dify_agent.protocol.snapshot import SessionSnapshot
from dify_agent.protocol.tool_call_limits import (
    TOOL_CALL_LIMIT_METADATA_KEY,
    TOOL_EXECUTION_FAILED_METADATA_KEY,
    TOOL_VALIDATION_FAILED_METADATA_KEY,
    AgentToolActivity,
    ToolCallLimitMetadata,
    ToolCallLimitSnapshot,
    agent_tool_activity_from_metadata,
)
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    PartStartEvent,
    RetryPromptPart,
    TextPartDelta,
    ThinkingPartDelta,
    ToolCallPart,
    ToolCallPartDelta,
    ToolReturnPart,
)
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from clients.agent_backend import (
    AgentBackendError,
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunEventAdapter,
    AgentBackendRunFailedError,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunSucceededInternalEvent,
    AgentBackendStreamInternalEvent,
    FakeAgentBackendRunClient,
    FakeAgentBackendScenario,
)
from core.app.apps.agent_app import app_runner as app_runner_module
from core.app.apps.agent_app.app_runner import AgentAppRunner
from core.app.apps.agent_app.runtime_request_builder import (
    AgentAppRuntimeBuildContext,
    AgentAppRuntimeRequest,
    AgentAppRuntimeRequestBuilder,
)
from core.app.apps.agent_app.session_store import (
    AgentAppSessionScope,
    AgentAppWorkspaceStore,
    StoredAgentAppSession,
)
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.app.entities.queue_entities import (
    AppQueueEvent,
    QueueAgentMessageEvent,
    QueueAgentThoughtEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
    QueueRetrieverResourcesEvent,
)
from core.app.llm.model_access import ModelRuntimeProfile
from core.tools.entities.common_entities import I18nObject, I18nObjectDict
from core.workflow.nodes.agent_v2.dify_tools_builder import WorkflowAgentToolLayers
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.errors.invoke import InvokeRateLimitError
from models.agent_config_entities import (
    AgentKnowledgeSpaceConfig,
    AgentSoulConfig,
    AgentSoulToolsConfig,
)
from models.enums import ConversationFromSource
from models.enums import InvokeFrom as ModelInvokeFrom
from models.model import AppMode, Message, MessageAgentThought


@pytest.fixture(autouse=True)
def bind_agent_dependencies(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    """Reuse the test SQLite session for Agent App writes."""

    @contextmanager
    def reuse_session():
        try:
            yield sqlite_session
        except Exception:
            sqlite_session.rollback()
            raise

    monkeypatch.setattr(app_runner_module, "create_session", reuse_session)
    monkeypatch.setattr(
        "core.app.llm.model_access.resolve_model_runtime_profile",
        lambda **_kwargs: ModelRuntimeProfile(None, []),
    )


def _thought_rows(session: Session) -> list[MessageAgentThought]:
    session.expire_all()
    return list(session.scalars(select(MessageAgentThought).order_by(MessageAgentThought.position)).all())


class _NoToolsBuilder:
    def __init__(self, tool_labels: Mapping[str, I18nObjectDict] | None = None) -> None:
        self.tool_labels = tool_labels or {}

    def build_layers(
        self,
        *,
        tenant_id: str,
        app_id: str,
        user_id: str | None,
        tools: AgentSoulToolsConfig,
        invoke_from: InvokeFrom,
        knowledge_fs_spaces: tuple[AgentKnowledgeSpaceConfig, ...] = (),
    ) -> WorkflowAgentToolLayers:
        del tenant_id, app_id, user_id, tools, invoke_from, knowledge_fs_spaces
        return WorkflowAgentToolLayers(tool_labels=self.tool_labels)


class _FakeQueueManager(AppQueueManager):
    def __init__(self, *, reject_when_stopped: bool = False) -> None:
        super().__init__(task_id="task-1", user_id="user-1", invoke_from=InvokeFrom.WEB_APP)
        self.events: list[Any] = []
        self._stop_requested = False
        self._reject_when_stopped = reject_when_stopped

    @override
    def publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        del pub_from
        if self._reject_when_stopped and self.is_stopped():
            raise GenerateTaskStoppedError()
        self.events.append(event)

    @override
    def is_stopped(self) -> bool:
        return self._stop_requested

    @override
    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        del event, pub_from

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
                session_snapshot=SessionSnapshot(layers={}),
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
                session_snapshot=SessionSnapshot(layers={}),
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
                session_snapshot=SessionSnapshot(layers={}),
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
                session_snapshot=SessionSnapshot(layers={}),
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
                session_snapshot=SessionSnapshot(layers={}),
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
                session_snapshot=SessionSnapshot(layers={}),
            ),
        )


class _FakeSessionStore(AgentAppWorkspaceStore):
    def __init__(
        self,
        loaded: SessionSnapshot | None = None,
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
        self.saved: list[tuple[AgentAppSessionScope, str, SessionSnapshot | None]] = []

    @override
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

    @override
    def save_active_snapshot(
        self,
        *,
        scope: AgentAppSessionScope,
        binding_id: str,
        snapshot: SessionSnapshot | None,
    ) -> None:
        self.saved.append((scope, binding_id, snapshot))


class _ExplodingSessionStore(_FakeSessionStore):
    def __init__(self, loaded: SessionSnapshot | None = None) -> None:
        super().__init__(loaded=loaded)
        self.save_attempts: list[SessionSnapshot | None] = []

    @override
    def save_active_snapshot(
        self,
        *,
        scope: AgentAppSessionScope,
        binding_id: str,
        snapshot: SessionSnapshot | None,
    ) -> None:
        del scope, binding_id
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


def _compatible_session_snapshot() -> SessionSnapshot:
    request = (
        AgentAppRuntimeRequestBuilder(
            dify_tools_builder=_NoToolsBuilder(),
        )
        .build(
            AgentAppRuntimeBuildContext(
                dify_context=_dify_ctx(),
                agent_id="agent-1",
                agent_config_snapshot_id="snap-1",
                agent_soul=_soul(),
                conversation_id="conv-1",
                user_query="hello",
                idempotency_key="msg-1",
                binding_id="binding-1",
                backend_binding_ref="backend-binding-1",
            )
        )
        .request
    )
    return SessionSnapshot(layers={layer.name: {} for layer in request.composition.layers})


def _runner(
    client: FakeAgentBackendRunClient,
    store: _FakeSessionStore,
    *,
    text_delta_debounce_seconds: float = 0,
    tool_labels: Mapping[str, I18nObjectDict] | None = None,
) -> AgentAppRunner:
    return AgentAppRunner(
        request_builder=AgentAppRuntimeRequestBuilder(
            dify_tools_builder=_NoToolsBuilder(tool_labels),
        ),
        agent_backend_client=client,
        event_adapter=AgentBackendRunEventAdapter(),
        session_store=store,
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
        queue_manager=qm,
    )


def _message_record() -> Message:
    message = Message(
        app_id="app-1",
        conversation_id="conv-1",
        _inputs={},
        query="hello",
        message={},
        message_tokens=0,
        message_unit_price=Decimal(0),
        message_price_unit=Decimal(0),
        answer="",
        answer_tokens=0,
        answer_unit_price=Decimal(0),
        answer_price_unit=Decimal(0),
        provider_response_latency=0,
        total_price=Decimal(0),
        currency="USD",
        invoke_from=ModelInvokeFrom.WEB_APP,
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
    saved_scope, saved_binding_id, saved_snapshot = store.saved[0]
    assert saved_scope.conversation_id == "conv-1"
    assert saved_scope.agent_config_snapshot_id == "snap-1"
    assert saved_binding_id == "binding-1"
    assert saved_snapshot is not None


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

    _run(
        _runner(client, store, tool_labels={"bash": I18nObject(en_US="Run Command", zh_Hans="运行命令").to_dict()}),
        qm,
    )

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
    assert rows[1].tool_labels["bash"]["en_US"] == "Run Command"
    assert rows[1].tool_labels["bash"]["zh_Hans"] == "运行命令"
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
        queue_manager=qm,
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
    assert rows[0].tool_labels == {"shell_run": {"en_US": "shell_run", "zh_Hans": "shell_run"}}
    assert rows[0].tool_input == '{"script": "npx skills find browser"}'
    assert rows[0].observation == ""
    assert rows[1].tool == ""
    assert rows[1].tool_input == ""
    assert rows[1].observation == "Knowledge base search results: browser skill"


def test_trusted_knowledge_receipts_reach_chat_sources_once(sqlite_session: Session) -> None:
    qm = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(),
        message_id="msg-1",
        queue_manager=qm,
    )
    receipt = {
        "id": "kfs_" + "a" * 32,
        "control_space_id": "00000000-0000-4000-8000-000000000001",
        "space_name": "Docs",
        "node_id": "node",
        "document_asset_id": "doc",
        "artifact_hash": "hash",
        "document_title": "manual.pdf",
        "document_version": 2,
    }
    part = ToolReturnPart(
        tool_name="shell_run",
        tool_call_id="shell-call-1",
        content={"knowledge_results": [{"data": {"receipt_id": receipt["id"], "text": "evidence"}}]},
        metadata={"knowledge_fs_citations": [receipt]},
    )
    event = PydanticAIStreamRunEvent(run_id="run-1", data=FunctionToolResultEvent(part=part))
    internal = AgentBackendStreamInternalEvent(run_id="run-1", data=event.model_dump(mode="json")["data"])
    recorder.handle_stream_event(internal)
    recorder.handle_stream_event(internal)
    sources = [event for event in qm.events if isinstance(event, QueueRetrieverResourcesEvent)]
    assert len(sources) == 1
    assert sources[0].retriever_resources[0].document_name == "manual.pdf"
    citation = sources[0].retriever_resources[0].knowledge_fs_citation
    assert citation is not None
    assert citation.id == receipt["id"]
    assert sources[0].retriever_resources[0].content == "evidence"
    assert _thought_rows(sqlite_session)[0].tool == "shell_run"


def test_answer_suffix_trim_keeps_non_terminal_prefix(sqlite_session: Session) -> None:
    qm = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(),
        message_id="msg-1",
        queue_manager=qm,
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
        queue_manager=qm,
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
        queue_manager=qm,
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
        queue_manager=qm,
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
        queue_manager=qm,
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
        queue_manager=qm,
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
    prior = _compatible_session_snapshot()
    client = FakeAgentBackendRunClient()
    store = _FakeSessionStore(loaded=prior)
    qm = _FakeQueueManager()

    _run(_runner(client, store), qm)

    assert client.request is not None
    assert client.request.session_snapshot is prior


def test_snapshot_with_removed_optional_prompt_is_forwarded_to_runtime() -> None:
    compatible = _compatible_session_snapshot()
    snapshot = SessionSnapshot(
        layers={name: state for name, state in compatible.layers.items() if name != "agent_soul_prompt"}
    )
    client = FakeAgentBackendRunClient()
    store = _FakeSessionStore(loaded=snapshot)
    _run(_runner(client, store), _FakeQueueManager())
    assert client.request is not None
    assert client.request.session_snapshot is snapshot
    assert len(store.saved) == 1


def test_debug_session_scope_can_reuse_conversation_across_config_snapshots() -> None:
    prior = _compatible_session_snapshot()
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
        queue_manager=qm,
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
    assert store.saved[0][2] == SessionSnapshot(layers={})


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


class _RecordingSession:
    """Session double for commit/rollback assertions without a MagicMock assignment."""

    def __init__(
        self,
        *,
        get_result: Any = None,
        get_error: Exception | None = None,
        commit_error: Exception | None = None,
    ) -> None:
        self._get_result = get_result
        self._get_error = get_error
        self._commit_error = commit_error
        self.commit_calls = 0
        self.rollback_calls = 0

    def get(self, *args: Any, **kwargs: Any) -> Any:
        del args, kwargs
        if self._get_error is not None:
            raise self._get_error
        return self._get_result

    def commit(self) -> None:
        self.commit_calls += 1
        if self._commit_error is not None:
            raise self._commit_error

    def rollback(self) -> None:
        self.rollback_calls += 1


@contextmanager
def _recording_session_context(recording: _RecordingSession) -> Generator[_RecordingSession]:
    # Mirror SQLAlchemy Session.__exit__: roll back then re-raise.
    try:
        yield recording
    except Exception:
        recording.rollback()
        raise


def test_partial_usage_persistence_rolls_back_database_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Session-context exit must roll back when usage persistence hits a DB error."""
    recording = _RecordingSession(get_error=RuntimeError("database unavailable"))
    monkeypatch.setattr(app_runner_module, "create_session", lambda: _recording_session_context(recording))

    AgentAppRunner._persist_message_usage(
        message_id="msg-1",
        usage=LLMUsage.from_metadata({"prompt_tokens": 2, "completion_tokens": 1}),
    )

    assert recording.rollback_calls == 1
    assert recording.commit_calls == 0


def test_trim_answer_suffix_skips_when_thought_row_missing() -> None:
    qm = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(),
        message_id="msg-1",
        queue_manager=qm,  # type: ignore[arg-type]
    )
    recorder._answer_thought_id = "00000000-0000-4000-8000-000000000099"

    recorder.trim_answer_suffix("final answer")

    assert recorder._answer_thought_id == "00000000-0000-4000-8000-000000000099"
    assert not [e for e in qm.events if isinstance(e, QueueAgentThoughtEvent)]


def test_trim_answer_suffix_skips_when_overlap_is_zero(sqlite_session: Session) -> None:
    qm = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(),
        message_id="msg-1",
        queue_manager=qm,  # type: ignore[arg-type]
    )
    recorder.append_answer_text("prefix only")
    before = _thought_rows(sqlite_session)[0].answer
    qm.events.clear()

    recorder.trim_answer_suffix("unrelated suffix")

    rows = _thought_rows(sqlite_session)
    assert len(rows) == 1
    assert rows[0].answer == before
    # No publish when overlap is zero (early return inside the session block).
    assert not [e for e in qm.events if isinstance(e, QueueAgentThoughtEvent)]


def test_trim_answer_suffix_deletes_empty_answer_only_thought(sqlite_session: Session) -> None:
    qm = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(),
        message_id="msg-1",
        queue_manager=qm,  # type: ignore[arg-type]
    )
    # Entire answer is the terminal suffix → trim leaves an empty answer-only row → delete.
    recorder.append_answer_text("final answer")
    qm.events.clear()
    recorder.trim_answer_suffix("final answer")

    assert recorder._answer_thought_id is None
    assert _thought_rows(sqlite_session) == []
    # Delete path commits inside the session and returns before publish.
    assert not [e for e in qm.events if isinstance(e, QueueAgentThoughtEvent)]


def test_update_thought_skips_missing_row(sqlite_session: Session) -> None:
    qm = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(),
        message_id="msg-1",
        queue_manager=qm,  # type: ignore[arg-type]
    )

    recorder._update_thought("00000000-0000-4000-8000-000000000099", answer_delta="x")

    assert _thought_rows(sqlite_session) == []
    # Missing row returns before commit/publish.
    assert not [e for e in qm.events if isinstance(e, QueueAgentThoughtEvent)]


def test_persist_message_usage_commit_failure_rolls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    """Commit errors inside the session block must roll back via context exit."""
    message = MagicMock()
    message.message_metadata = "{}"
    recording = _RecordingSession(get_result=message, commit_error=RuntimeError("commit failed"))
    monkeypatch.setattr(app_runner_module, "create_session", lambda: _recording_session_context(recording))

    AgentAppRunner._persist_message_usage(
        message_id="msg-1",
        usage=LLMUsage.from_metadata({"prompt_tokens": 2, "completion_tokens": 1}),
    )

    assert recording.commit_calls == 1
    assert recording.rollback_calls == 1


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

    assert store.save_attempts == [SessionSnapshot(layers={})]


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
    assert store.saved[0][2] == SessionSnapshot(layers={})


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


def test_run_forwards_inputs_to_runtime_context(monkeypatch: pytest.MonkeyPatch) -> None:
    contexts: list[AgentAppRuntimeBuildContext] = []
    build = AgentAppRuntimeRequestBuilder.build

    def record_build(
        self: AgentAppRuntimeRequestBuilder,
        context: AgentAppRuntimeBuildContext,
    ) -> AgentAppRuntimeRequest:
        contexts.append(context)
        return build(self, context)

    monkeypatch.setattr(AgentAppRuntimeRequestBuilder, "build", record_build)
    runner = _runner(FakeAgentBackendRunClient(), _FakeSessionStore())
    inputs = {"name": "世界", "count": 0}
    runner.run(
        dify_context=_dify_ctx(),
        agent_id="agent-1",
        agent_config_snapshot_id="snap-1",
        agent_soul=_soul(),
        home_snapshot_id="home-1",
        conversation_id="conv-1",
        query="hello",
        inputs=inputs,
        message_id="msg-1",
        model_name="gpt-4o-mini",
        queue_manager=_FakeQueueManager(),
    )
    assert len(contexts) == 1
    assert contexts[0].inputs == inputs
    assert contexts[0].user_query == "hello"


@pytest.fixture
def activity_message(sqlite_session: Session) -> None:
    """Persist the real owning message before recording or replaying its tool calls."""
    sqlite_session.add(_message_record())
    sqlite_session.commit()


_ACTIVITY_RUN_ID = "activity-run"
_ACTIVITY_TOOL_IDENTITY = '["plugin","langgenius/github/github","search"]'


def _activity_call(call_id: str, *, index: int | None = None) -> PydanticAIStreamRunEvent:
    part = ToolCallPart(tool_name="search", args={"query": call_id}, tool_call_id=call_id)
    data = FunctionToolCallEvent(part=part) if index is None else PartStartEvent(index=index, part=part)
    return PydanticAIStreamRunEvent(run_id=_ACTIVITY_RUN_ID, data=data)


def _activity_result(
    call_id: str,
    *,
    call_limit: ToolCallLimitMetadata | None = None,
    execution_failed: bool = False,
    validation_failed: bool = False,
    observation: str = "found repositories",
) -> PydanticAIStreamRunEvent:
    metadata: dict[str, object] = {}
    if call_limit is not None:
        metadata[TOOL_CALL_LIMIT_METADATA_KEY] = call_limit.model_dump(mode="json")
    if execution_failed:
        metadata[TOOL_EXECUTION_FAILED_METADATA_KEY] = True
    if validation_failed:
        metadata[TOOL_VALIDATION_FAILED_METADATA_KEY] = True
    return PydanticAIStreamRunEvent(
        run_id=_ACTIVITY_RUN_ID,
        data=FunctionToolResultEvent(
            part=ToolReturnPart(tool_name="search", tool_call_id=call_id, content=observation, metadata=metadata)
        ),
    )


def _deliver_activity_event(recorder: app_runner_module._AgentProcessRecorder, event: RunEvent) -> None:
    internal = [
        item for item in AgentBackendRunEventAdapter().adapt(event) if isinstance(item, AgentBackendStreamInternalEvent)
    ]
    assert len(internal) == 1
    recorder.handle_stream_event(internal[0])


def _activity_terminal(status: str, *reserved_ids: str) -> RunSucceededEvent | RunFailedEvent | RunCancelledEvent:
    summaries: dict[str, ToolCallLimitSnapshot] = {}
    if reserved_ids:
        summaries[hashlib.sha256(_ACTIVITY_TOOL_IDENTITY.encode()).hexdigest()] = ToolCallLimitSnapshot(
            tool_identity=_ACTIVITY_TOOL_IDENTITY,
            limit=3,
            used=len(reserved_ids),
            call_ids={
                hashlib.sha256(call_id.encode()).hexdigest(): index for index, call_id in enumerate(reserved_ids, 1)
            },
        )
    if status == "succeeded":
        return RunSucceededEvent(
            run_id=_ACTIVITY_RUN_ID,
            data=RunSucceededEventData(output={"text": "done"}, session_snapshot=SessionSnapshot()),
            tool_call_limits=summaries,
        )
    if status == "failed":
        return RunFailedEvent(
            run_id=_ACTIVITY_RUN_ID,
            data=RunFailedEventData(error="run failed", session_snapshot=SessionSnapshot()),
            tool_call_limits=summaries,
        )
    assert status == "cancelled"
    return RunCancelledEvent(
        run_id=_ACTIVITY_RUN_ID,
        data=RunCancelledEventData(reason="stopped", session_snapshot=SessionSnapshot()),
        tool_call_limits=summaries,
    )


def _finish_activity(recorder: app_runner_module._AgentProcessRecorder, event: RunEvent) -> None:
    terminals = [
        item
        for item in AgentBackendRunEventAdapter().adapt(event)
        if isinstance(
            item,
            AgentBackendRunSucceededInternalEvent
            | AgentBackendRunFailedInternalEvent
            | AgentBackendRunCancelledInternalEvent,
        )
    ]
    assert len(terminals) == 1
    recorder.finish(terminals[0])


def _stored_activity(row: MessageAgentThought) -> AgentToolActivity:
    activity = agent_tool_activity_from_metadata(row.tool_meta)
    assert activity is not None
    return activity


@pytest.mark.usefixtures("activity_message")
def test_tool_activity_persists_parallel_same_name_calls_without_reusing_an_active_index(
    sqlite_session: Session,
) -> None:
    queue = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(), message_id="msg-1", queue_manager=queue
    )
    # Native part indexes can be reused across calls; stable ids remain distinct.
    _deliver_activity_event(recorder, _activity_call("first", index=0))
    _deliver_activity_event(recorder, _activity_call("second", index=0))
    _deliver_activity_event(recorder, _activity_call("first"))
    _deliver_activity_event(recorder, _activity_call("second"))
    successful = ToolCallLimitMetadata(
        tool_identity=_ACTIVITY_TOOL_IDENTITY, limit=3, used=1, execution_status="executed"
    )
    failed = ToolCallLimitMetadata(tool_identity=_ACTIVITY_TOOL_IDENTITY, limit=3, used=2, execution_status="executed")
    _deliver_activity_event(
        recorder, _activity_result("second", call_limit=failed, execution_failed=True, observation="timeout")
    )
    _deliver_activity_event(recorder, _activity_result("first", call_limit=successful))
    rows = _thought_rows(sqlite_session)
    assert len(rows) == 2
    by_call = {_stored_activity(row).tool_call_id: row for row in rows}
    assert by_call["first"].tool_input == '{"query": "first"}'
    assert by_call["second"].tool_input == '{"query": "second"}'
    assert _stored_activity(by_call["first"]).status == "succeeded"
    assert _stored_activity(by_call["second"]).status == "failed"
    assert _stored_activity(by_call["second"]).call_limit == failed
    assert by_call["second"].observation == "timeout"


@pytest.mark.usefixtures("activity_message")
def test_tool_activity_replay_is_idempotent_in_one_recorder_and_after_reconstruction(sqlite_session: Session) -> None:
    queue = _FakeQueueManager()
    labels = {"search": I18nObject(en_US="Search", zh_Hans="搜索").to_dict()}
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(), message_id="msg-1", queue_manager=queue, tool_labels=labels
    )
    labels["search"]["en_US"] = "Renamed"
    call = _activity_call("first")
    result = _activity_result("first")
    _deliver_activity_event(recorder, call)
    _deliver_activity_event(recorder, result)
    original = _thought_rows(sqlite_session)[0]
    assert original.tool_labels["search"]["en_US"] == "Search"
    assert original.tool_labels["search"]["zh_Hans"] == "搜索"
    event_count = len(queue.events)
    for replay_event in (call, result):
        _deliver_activity_event(recorder, replay_event)
    assert len(_thought_rows(sqlite_session)) == 1
    assert len(queue.events) == event_count
    reconstructed = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(), message_id="msg-1", queue_manager=queue, tool_labels=labels
    )
    for replay_event in (call, result):
        _deliver_activity_event(reconstructed, replay_event)
    assert len(_thought_rows(sqlite_session)) == 1
    assert len(queue.events) == event_count
    _deliver_activity_event(reconstructed, _activity_call("new-call"))
    _deliver_activity_event(reconstructed, _activity_result("new-call"))
    rows = _thought_rows(sqlite_session)
    assert [row.position for row in rows] == [1, 2]
    assert rows[0].id == original.id
    assert rows[0].tool_labels["search"]["en_US"] == "Search"
    assert rows[1].tool_labels["search"]["en_US"] == "Renamed"
    assert [_stored_activity(row).tool_call_id for row in rows] == ["first", "new-call"]


@pytest.mark.parametrize("failure", ["denied", "execution", "validation"])
@pytest.mark.usefixtures("activity_message")
def test_tool_activity_records_runtime_failure_dispositions_independently_of_observation_text(
    sqlite_session: Session, failure: str
) -> None:
    queue = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(), message_id="msg-1", queue_manager=queue
    )
    _deliver_activity_event(recorder, _activity_call("call"))
    if failure == "denied":
        metadata = ToolCallLimitMetadata(
            tool_identity=_ACTIVITY_TOOL_IDENTITY,
            limit=3,
            used=3,
            execution_status="not_executed",
            reason="call_limit_reached",
        )
        observation = "untrusted success-looking text"
        result = _activity_result("call", call_limit=metadata, observation=observation)
        expected_status = "not_executed"
    elif failure == "execution":
        metadata = ToolCallLimitMetadata(
            tool_identity=_ACTIVITY_TOOL_IDENTITY, limit=3, used=1, execution_status="executed"
        )
        observation = "provider unavailable"
        result = _activity_result("call", call_limit=metadata, execution_failed=True, observation=observation)
        expected_status = "failed"
    else:
        metadata = None
        observation = "invalid tool input"
        result = _activity_result("call", validation_failed=True, observation=observation)
        expected_status = "failed"
    _deliver_activity_event(recorder, result)
    rows = _thought_rows(sqlite_session)
    assert len(rows) == 1
    activity = _stored_activity(rows[0])
    assert activity.id == f"{_ACTIVITY_RUN_ID}:call"
    assert activity.status == expected_status
    assert activity.call_limit == metadata
    assert rows[0].observation == observation


@pytest.mark.parametrize("terminal_status", ["succeeded", "failed", "cancelled"])
@pytest.mark.usefixtures("activity_message")
def test_tool_activity_terminal_summary_marks_pending_reservations_without_regressing_completed_calls(
    sqlite_session: Session, terminal_status: str
) -> None:
    queue = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(), message_id="msg-1", queue_manager=queue
    )
    for call_id in ("complete", "pending", "not-reserved"):
        _deliver_activity_event(recorder, _activity_call(call_id))
    confirmed = ToolCallLimitMetadata(
        tool_identity=_ACTIVITY_TOOL_IDENTITY, limit=3, used=1, execution_status="executed"
    )
    _deliver_activity_event(recorder, _activity_result("complete", call_limit=confirmed))
    terminal = _activity_terminal(terminal_status, "complete", "pending")
    _finish_activity(recorder, terminal)
    rows = _thought_rows(sqlite_session)
    assert len(rows) == 3
    activities = {_stored_activity(row).tool_call_id: _stored_activity(row) for row in rows}
    assert activities["complete"].status == "succeeded"
    assert activities["complete"].call_limit == confirmed
    pending = activities["pending"]
    assert pending.status == ("cancelled" if terminal_status == "cancelled" else "failed")
    assert pending.call_limit is not None
    assert pending.call_limit.execution_status == "unconfirmed"
    assert pending.call_limit.limit == 3
    assert pending.call_limit.used == 2
    assert activities["not-reserved"].call_limit is None
    event_count = len(queue.events)
    _finish_activity(recorder, terminal)
    assert len(queue.events) == event_count
    assert len(_thought_rows(sqlite_session)) == 3


@pytest.mark.usefixtures("activity_message")
def test_stopped_queue_does_not_prevent_all_pending_tool_summaries_from_being_committed(
    sqlite_session: Session,
) -> None:
    queue = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(), message_id="msg-1", queue_manager=queue
    )
    for call_id in ("first", "second"):
        _deliver_activity_event(recorder, _activity_call(call_id))
    before_stop_events = len(queue.events)
    queue.request_stop()
    _finish_activity(recorder, _activity_terminal("cancelled", "first", "second"))
    rows = _thought_rows(sqlite_session)
    assert len(rows) == 2
    activities = [_stored_activity(row) for row in rows]
    assert all(activity.status == "cancelled" and activity.call_limit is not None for activity in activities)
    assert [activity.call_limit.used for activity in activities if activity.call_limit is not None] == [1, 2]
    assert len(queue.events) == before_stop_events


class _ActivityEventClient(_RecordingFakeAgentBackendRunClient):
    """In-memory Agent run port using the real public event and cancellation DTOs."""

    def __init__(
        self,
        *,
        terminal_status: str,
        stop_queue: _FakeQueueManager | None = None,
        cleanup_only: bool = False,
        pending_text: bool = False,
    ) -> None:
        super().__init__(run_id=_ACTIVITY_RUN_ID)
        self._terminal_status = terminal_status
        self._stop_queue = stop_queue
        self._cleanup_only = cleanup_only
        self._pending_text = pending_text

    @override
    def stream_events(
        self, run_id: str, *, after: str | None = None, should_stop: Callable[[], bool] | None = None
    ) -> Iterator[RunEvent]:
        del after, should_stop
        assert run_id == _ACTIVITY_RUN_ID
        yield _activity_call("pending")
        if self._pending_text:
            yield PydanticAIStreamRunEvent(
                run_id=run_id,
                data=PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="pending answer")),
                agent_message_delta="pending answer",
            )
        if self._stop_queue is not None:
            self._stop_queue.request_stop()
        if self._cleanup_only:
            yield PydanticAIStreamRunEvent(
                run_id=run_id, data=PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="late delta"))
            )
        else:
            yield _activity_terminal(self._terminal_status, "pending")

    @override
    def cancel_run_and_wait(
        self, run_id: str, request: CancelRunRequest | None = None, *, after: str | None = None
    ) -> RunCancelledEvent:
        self.cancel_after.append(after)
        self.cancel_run(run_id, request)
        terminal = _activity_terminal("cancelled", "pending")
        assert isinstance(terminal, RunCancelledEvent)
        return terminal


@pytest.mark.parametrize("terminal_status", ["succeeded", "failed", "cancelled"])
@pytest.mark.usefixtures("activity_message")
def test_agent_app_consume_stream_persists_terminal_tool_summary_before_finishing_or_raising(
    sqlite_session: Session, terminal_status: str
) -> None:
    queue = _FakeQueueManager()
    client = _ActivityEventClient(terminal_status=terminal_status)
    runner = _runner(client, _FakeSessionStore())
    if terminal_status == "succeeded":
        _run(runner, queue)
    else:
        with pytest.raises(AgentBackendError):
            _run(runner, queue)
    rows = [row for row in _thought_rows(sqlite_session) if row.tool]
    assert len(rows) == 1
    activity = _stored_activity(rows[0])
    assert activity.status == ("cancelled" if terminal_status == "cancelled" else "failed")
    assert activity.call_limit is not None
    assert activity.call_limit.execution_status == "unconfirmed"
    assert activity.call_limit.used == 1
    assert activity.call_limit.limit == 3


@pytest.mark.parametrize("cleanup_only", [False, True])
@pytest.mark.usefixtures("activity_message")
def test_agent_app_cancel_paths_persist_tool_summary_when_stop_arrives_after_call(
    sqlite_session: Session, cleanup_only: bool
) -> None:
    queue = _FakeQueueManager()
    client = _ActivityEventClient(terminal_status="cancelled", stop_queue=queue, cleanup_only=cleanup_only)
    with pytest.raises(GenerateTaskStoppedError):
        _run(_runner(client, _FakeSessionStore()), queue)
    rows = _thought_rows(sqlite_session)
    assert len(rows) == 1
    activity = _stored_activity(rows[0])
    assert activity.status == "cancelled"
    assert activity.call_limit is not None
    assert activity.call_limit.execution_status == "unconfirmed"

    assert client.cancelled_run_ids == ([_ACTIVITY_RUN_ID] if cleanup_only else [])


@pytest.mark.usefixtures("activity_message")
def test_stopped_debounced_message_flush_cannot_bypass_cancel_or_drop_reserved_tool_summary(
    sqlite_session: Session,
) -> None:
    queue = _FakeQueueManager(reject_when_stopped=True)
    client = _ActivityEventClient(terminal_status="cancelled", stop_queue=queue, cleanup_only=True, pending_text=True)
    store = _FakeSessionStore()
    runner = _runner(client, store, text_delta_debounce_seconds=60)
    with pytest.raises(GenerateTaskStoppedError):
        _run(runner, queue)
    assert client.cancelled_run_ids == [_ACTIVITY_RUN_ID]
    assert len(client.cancel_after) == 1
    rows = _thought_rows(sqlite_session)
    tool_rows = [row for row in rows if row.tool]
    assert len(tool_rows) == 1
    activity = _stored_activity(tool_rows[0])
    assert activity.status == "cancelled"
    assert activity.call_limit is not None
    assert activity.call_limit.execution_status == "unconfirmed"
    assert activity.call_limit.used == 1
    assert activity.call_limit.limit == 3
    assert [row.answer for row in rows if row.answer] == ["pending answer"]
    assert len(store.saved) == 1


@pytest.mark.parametrize("opaque_id", [" call ", "call:null", "工具调用-🔎"])
@pytest.mark.usefixtures("activity_message")
def test_native_opaque_call_ids_remain_distinct_and_match_raw_terminal_reservation_hashes(
    sqlite_session: Session, opaque_id: str
) -> None:
    queue = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(), message_id="msg-1", queue_manager=queue
    )
    for call_id in (opaque_id, "call"):
        _deliver_activity_event(recorder, _activity_call(call_id))
    _finish_activity(recorder, _activity_terminal("cancelled", opaque_id, "call"))
    rows = _thought_rows(sqlite_session)
    assert len(rows) == 2
    by_call = {_stored_activity(row).tool_call_id: _stored_activity(row) for row in rows}
    assert set(by_call) == {opaque_id, "call"}
    for ordinal, call_id in enumerate((opaque_id, "call"), 1):
        activity = by_call[call_id]
        assert activity.id == f"{_ACTIVITY_RUN_ID}:{call_id}"
        assert activity.status == "cancelled"
        assert activity.call_limit is not None
        assert activity.call_limit.execution_status == "unconfirmed"
        assert activity.call_limit.used == ordinal
        assert activity.call_limit.limit == 3


@pytest.mark.usefixtures("activity_message")
def test_orphan_rejected_tool_result_persists_authoritative_metadata_and_ignores_late_replay(
    sqlite_session: Session,
) -> None:
    queue = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(), message_id="msg-1", queue_manager=queue
    )
    quota = ToolCallLimitMetadata(
        tool_identity=_ACTIVITY_TOOL_IDENTITY,
        limit=3,
        used=3,
        execution_status="not_executed",
        reason="call_limit_reached",
    )
    result = _activity_result("orphan", call_limit=quota, observation="success-looking provider response")
    _deliver_activity_event(recorder, result)
    rows = _thought_rows(sqlite_session)
    assert len(rows) == 1
    row = rows[0]
    activity = _stored_activity(row)
    assert activity.id == f"{_ACTIVITY_RUN_ID}:orphan"
    assert activity.tool_name == "search"
    assert activity.status == "not_executed"
    assert activity.call_limit == quota
    assert row.tool_input == ""
    assert row.observation == "success-looking provider response"
    event_count = len(queue.events)
    _deliver_activity_event(recorder, result)
    _deliver_activity_event(recorder, _activity_call("orphan"))
    replayed = _thought_rows(sqlite_session)
    assert len(replayed) == 1
    assert replayed[0].id == row.id
    assert _stored_activity(replayed[0]) == activity
    assert replayed[0].tool_input == ""
    assert len(queue.events) == event_count


@pytest.mark.usefixtures("activity_message")
def test_retry_prompt_without_tool_name_uses_stable_call_identity_and_records_failure_without_quota(
    sqlite_session: Session,
) -> None:
    queue = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(), message_id="msg-1", queue_manager=queue
    )
    _deliver_activity_event(recorder, _activity_call("retry"))
    retry_part = RetryPromptPart(content="query must not be empty", tool_call_id="retry")
    assert retry_part.tool_name is None
    _deliver_activity_event(
        recorder,
        PydanticAIStreamRunEvent(run_id=_ACTIVITY_RUN_ID, data=FunctionToolResultEvent(part=retry_part)),
    )
    rows = _thought_rows(sqlite_session)
    assert len(rows) == 1
    activity = _stored_activity(rows[0])
    assert activity.id == f"{_ACTIVITY_RUN_ID}:retry"
    assert activity.tool_name == "search"
    assert activity.status == "failed"
    assert activity.error == "query must not be empty"
    assert activity.call_limit is None
    assert rows[0].tool == "search"
    assert rows[0].observation == "query must not be empty"


@pytest.mark.usefixtures("activity_message")
def test_recorder_restores_a_running_identity_and_continues_positions_past_legacy_thoughts(
    sqlite_session: Session,
) -> None:
    queue = _FakeQueueManager()
    original_recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(), message_id="msg-1", queue_manager=queue
    )
    _deliver_activity_event(original_recorder, _activity_call("pending"))
    original = _thought_rows(sqlite_session)[0]
    legacy = MessageAgentThought(
        message_id="msg-1",
        position=7,
        created_by_role=original.created_by_role,
        created_by=original.created_by,
        tool="legacy_search",
        observation="old response",
        tool_meta_str='{"provider":{"status":"succeeded"}}',
    )
    sqlite_session.add(legacy)
    sqlite_session.commit()
    restored = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(), message_id="msg-1", queue_manager=queue
    )
    quota = ToolCallLimitMetadata(tool_identity=_ACTIVITY_TOOL_IDENTITY, limit=3, used=1, execution_status="executed")
    _deliver_activity_event(restored, _activity_result("pending", call_limit=quota))
    _deliver_activity_event(restored, _activity_call("next"))
    rows = _thought_rows(sqlite_session)
    assert [row.position for row in rows] == [1, 7, 8]
    assert rows[0].id == original.id
    assert _stored_activity(rows[0]).status == "succeeded"
    assert _stored_activity(rows[0]).call_limit == quota
    assert rows[1].id == legacy.id
    assert rows[1].observation == "old response"
    assert agent_tool_activity_from_metadata(rows[1].tool_meta) is None
    assert _stored_activity(rows[2]).tool_call_id == "next"
    assert _stored_activity(rows[2]).status == "running"


@pytest.mark.usefixtures("activity_message")
def test_completed_part_start_and_idless_delta_replay_do_not_reopen_a_call_or_block_a_new_id(
    sqlite_session: Session,
) -> None:
    queue = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(), message_id="msg-1", queue_manager=queue
    )
    _deliver_activity_event(recorder, _activity_call("complete"))
    _deliver_activity_event(recorder, _activity_result("complete"))
    original = _thought_rows(sqlite_session)[0]
    before = (original.id, original.position, original.tool_input, original.observation, original.tool_meta_str)
    event_count = len(queue.events)
    _deliver_activity_event(recorder, _activity_call("complete", index=0))
    _deliver_activity_event(
        recorder,
        PydanticAIStreamRunEvent(
            run_id=_ACTIVITY_RUN_ID,
            data=PartDeltaEvent(index=0, delta=ToolCallPartDelta(args_delta='{"query":"replayed fragment"}')),
        ),
    )
    rows = _thought_rows(sqlite_session)
    assert len(rows) == 1
    actual = rows[0]
    assert (actual.id, actual.position, actual.tool_input, actual.observation, actual.tool_meta_str) == before
    assert len(queue.events) == event_count
    _deliver_activity_event(recorder, _activity_call("new-call", index=0))
    _deliver_activity_event(recorder, _activity_result("new-call"))
    rows = _thought_rows(sqlite_session)
    assert len(rows) == 2
    assert [row.position for row in rows] == [1, 2]
    assert rows[0].id == original.id
    assert rows[1].id != original.id
    assert [_stored_activity(row).tool_call_id for row in rows] == ["complete", "new-call"]


@pytest.mark.usefixtures("activity_message")
def test_recorder_rejects_a_different_native_run_before_sql_or_queue_changes(sqlite_session: Session) -> None:
    queue = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(), message_id="msg-1", queue_manager=queue
    )
    _deliver_activity_event(recorder, _activity_call("known"))
    original = _thought_rows(sqlite_session)[0]
    before = (original.id, original.tool_input, original.observation, original.tool_meta_str)
    event_count = len(queue.events)
    statements: list[str] = []

    def record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    foreign = PydanticAIStreamRunEvent(
        run_id="foreign-run",
        data=FunctionToolCallEvent(
            part=ToolCallPart(tool_name="search", args={"query": "foreign"}, tool_call_id="known")
        ),
    )
    engine = sqlite_session.get_bind()
    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with pytest.raises(ValueError, match="different native runs"):
            _deliver_activity_event(recorder, foreign)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    assert statements == []
    assert len(queue.events) == event_count
    rows = _thought_rows(sqlite_session)
    assert len(rows) == 1
    actual = rows[0]
    assert (actual.id, actual.tool_input, actual.observation, actual.tool_meta_str) == before


@pytest.mark.usefixtures("activity_message")
def test_preview_merges_thinking_and_replaces_fragmented_tool_input_on_the_same_thought(
    sqlite_session: Session,
) -> None:
    queue = _FakeQueueManager()
    recorder = app_runner_module._AgentProcessRecorder(
        dify_context=_dify_ctx(), message_id="msg-1", queue_manager=queue
    )
    for delta in ("I will ", "search."):
        _deliver_activity_event(
            recorder,
            PydanticAIStreamRunEvent(
                run_id=_ACTIVITY_RUN_ID,
                data=PartDeltaEvent(index=0, delta=ThinkingPartDelta(content_delta=delta)),
            ),
        )
    for name_delta, args_delta in (("sea", '{"que'), ("rch", 'ry":"rag"}')):
        _deliver_activity_event(
            recorder,
            PydanticAIStreamRunEvent(
                run_id=_ACTIVITY_RUN_ID,
                data=PartDeltaEvent(
                    index=1,
                    delta=ToolCallPartDelta(
                        tool_name_delta=name_delta, args_delta=args_delta, tool_call_id="fragmented"
                    ),
                ),
            ),
        )
    tool_thought_id = _thought_rows(sqlite_session)[1].id
    _deliver_activity_event(
        recorder,
        PydanticAIStreamRunEvent(
            run_id=_ACTIVITY_RUN_ID,
            data=FunctionToolCallEvent(
                part=ToolCallPart(tool_name="search", args={"query": "rag"}, tool_call_id="fragmented")
            ),
        ),
    )
    _deliver_activity_event(recorder, _activity_result("fragmented"))
    rows = _thought_rows(sqlite_session)
    assert len(rows) == 2
    assert rows[0].thought == "I will search."
    assert rows[0].tool == ""
    assert rows[1].id == tool_thought_id
    assert rows[1].tool == "search"
    assert json.loads(rows[1].tool_input or "{}") == {"query": "rag"}
    assert rows[1].observation == "found repositories"
    activity = _stored_activity(rows[1])
    assert activity.id == f"{_ACTIVITY_RUN_ID}:fragmented"
    assert activity.tool_name == "search"
    assert activity.status == "succeeded"
    assert activity.call_limit is None
