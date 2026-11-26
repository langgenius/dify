"""Verify chat event publication and persistence using the deterministic backend.

Ephemeral finalization exercises the real workspace store and preserves chat
records and binding history across successful and unsuccessful backend turns.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from contextlib import nullcontext
from datetime import UTC, datetime
from decimal import Decimal
from math import nextafter
from typing import Any, override
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import httpx
import pytest
from dify_agent.client import Client
from dify_agent.layers.execution_context import ApplicationTracingContext
from dify_agent.layers.user_prompt import DifyUserPromptLayerConfig
from dify_agent.protocol import (
    AgentRunUsage,
    CancelRunRequest,
    CancelRunResponse,
    CreateRunRequest,
    CreateRunResponse,
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
from flask import Flask
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    TextPartDelta,
    ThinkingPartDelta,
    ToolCallPart,
    ToolReturnPart,
)
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from clients.agent_backend import (
    AgentBackendError,
    AgentBackendInternalEvent,
    AgentBackendRunClient,
    AgentBackendRunEventAdapter,
    AgentBackendRunFailedError,
    AgentBackendRunFailedInternalEvent,
    AgentBackendStreamInternalEvent,
    AgentBackendTimeoutError,
    AgentBackendTransportError,
    DifyAgentBackendRunClient,
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
from core.workflow.nodes.agent_v2.dify_tools_builder import WorkflowAgentToolLayers
from extensions.tracing import bind_tracing
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeRateLimitError
from models.agent import (
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigVersionKind,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.agent_config_entities import (
    AgentKnowledgeSpaceConfig,
    AgentSoulConfig,
    AgentSoulToolsConfig,
)
from models.enums import ConversationFromSource
from models.enums import InvokeFrom as ModelInvokeFrom
from models.model import AppMode, Conversation, Message, MessageAgentThought
from repositories.message_repository import MessageRepository
from services.agent.roster_service import AgentRosterService
from services.tracing.adapters import StoredPolicyTraceScopes
from tests.helpers.unit.model_factories import make_account, make_app, make_conversation
from tests.helpers.unit.services.tracing_ports import RecordingTracingHooks, untraced_scopes


@pytest.fixture(autouse=True)
def bind_agent_dependencies(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    """Bind local runner dependencies without reaching external services."""
    monkeypatch.setattr(app_runner_module.db, "session", sqlite_session)
    monkeypatch.setattr(
        "core.app.llm.model_access.resolve_model_runtime_profile",
        lambda **_kwargs: ModelRuntimeProfile(None, []),
    )


def _thought_rows(session: Session) -> list[MessageAgentThought]:
    session.expire_all()
    return list(session.scalars(select(MessageAgentThought).order_by(MessageAgentThought.position)).all())


class _NoToolsBuilder:
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
        return WorkflowAgentToolLayers()


class _FakeQueueManager(AppQueueManager):
    def __init__(self) -> None:
        super().__init__(task_id="task-1", user_id="user-1", invoke_from=InvokeFrom.WEB_APP)
        self.events: list[Any] = []
        self._stop_requested = False

    @override
    def publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        del pub_from
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
        self.cancel_timeouts: list[float | None] = []

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
        timeout_seconds: float | None = None,
    ) -> RunCancelledEvent:
        self.cancel_after.append(after)
        self.cancel_timeouts.append(timeout_seconds)
        return super().cancel_run_and_wait(run_id, request=request, after=after, timeout_seconds=timeout_seconds)


class _CancelAndWaitFailingClient(_RecordingFakeAgentBackendRunClient):
    @override
    def cancel_run_and_wait(
        self,
        run_id: str,
        request: CancelRunRequest | None = None,
        *,
        after: str | None = None,
        timeout_seconds: float | None = None,
    ) -> RunCancelledEvent:
        del request, timeout_seconds
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
        timeout_seconds: float | None = None,
    ) -> RunCancelledEvent:
        event = super().cancel_run_and_wait(run_id, request=request, after=after, timeout_seconds=timeout_seconds)
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
        timeout_seconds: float | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, timeout_seconds, should_stop
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
        timeout_seconds: float | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, timeout_seconds, should_stop
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
        timeout_seconds: float | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, timeout_seconds, should_stop
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
        timeout_seconds: float | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, timeout_seconds, should_stop
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
        timeout_seconds: float | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, timeout_seconds, should_stop
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
        timeout_seconds: float | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, timeout_seconds, should_stop
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
        timeout_seconds: float | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, timeout_seconds, should_stop
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
        timeout_seconds: float | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, timeout_seconds, should_stop
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
        timeout_seconds: float | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, timeout_seconds, should_stop
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
        timeout_seconds: float | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, timeout_seconds, should_stop
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
    client: AgentBackendRunClient,
    store: _FakeSessionStore,
    *,
    text_delta_debounce_seconds: float = 0,
) -> AgentAppRunner:
    return AgentAppRunner(
        request_builder=AgentAppRuntimeRequestBuilder(
            dify_tools_builder=_NoToolsBuilder(),
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


def _run_finalization(runner: AgentAppRunner) -> None:
    runner.run_finalization(
        dify_context=_dify_ctx(),
        agent_id="agent-1",
        build_draft_id="build-1",
        agent_soul=_soul(),
        home_snapshot_id="home-1",
        conversation_id="conv-1",
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
    """A persisted chat message registers a trace and records usage without a queue consumer."""
    sqlite_session.add(_message_record())
    sqlite_session.flush()
    hooks = RecordingTracingHooks(
        ApplicationTracingContext(
            run_id=uuid4(),
            invocation_id=uuid4(),
            trace_id="1" * 32,
            parent_span_id="2" * 16,
            session_id="conv-1",
            capture_content=False,
        )
    )
    trace_app = Flask(__name__)
    bind_tracing(trace_app, scopes=StoredPolicyTraceScopes(untraced_scopes()), hooks=hooks)

    with trace_app.app_context():
        _run(
            _runner(_StreamingFakeAgentBackendRunClient(), _FakeSessionStore()),
            _FakeQueueManager(),
        )

    sqlite_session.expire_all()
    message = sqlite_session.get(Message, "msg-1")
    assert message is not None
    assert [context.idempotency_key for context in hooks.agent_apps] == [message.id]
    assert hooks.terminals == [("app-1", message.id, "succeeded")]
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


class _FinalizationClient(_RecordingFakeAgentBackendRunClient):
    def __init__(
        self,
        outcome: str,
        *,
        scoped_session: Session,
        check_chat_history: Callable[[], None],
        cancel_fails: bool = False,
    ) -> None:
        super().__init__(run_id="run-1")
        self.outcome = outcome
        self.scoped_session = scoped_session
        self.check_chat_history = check_chat_history
        self.cancel_fails = cancel_fails

    @override
    def create_run(self, request: CreateRunRequest, *, timeout_seconds: float | None = None) -> CreateRunResponse:
        """Accept the runtime request only after its preparation transaction has closed."""
        assert not self.scoped_session.in_transaction()
        return super().create_run(request, timeout_seconds=timeout_seconds)

    @override
    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        timeout_seconds: float | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after, timeout_seconds, should_stop
        assert not self.scoped_session.in_transaction()
        # These real process events would create thoughts on the normal chat path.
        process_events = iter(_ProcessStreamingFakeAgentBackendRunClient().stream_events(run_id))
        yield from (event for event in process_events if not isinstance(event, RunSucceededEvent))
        self.check_chat_history()
        snapshot = SessionSnapshot(layers={"history": {"finalization": "FINISHED"}})
        usage = AgentRunUsage(prompt_tokens=13, completion_tokens=8)
        if self.outcome == "stream_error":
            raise RuntimeError("finalization stream interrupted")
        if self.outcome == "success":
            yield RunSucceededEvent(
                id="7-0",
                run_id=run_id,
                data=RunSucceededEventData(output="FINISHED", session_snapshot=snapshot, usage=usage),
            )
        elif self.outcome == "cancelled":
            yield RunCancelledEvent(
                id="7-0", run_id=run_id, data=RunCancelledEventData(session_snapshot=snapshot, usage=usage)
            )
        elif self.outcome != "eof":
            yield RunFailedEvent(
                id="7-0",
                run_id=run_id,
                data=RunFailedEventData(
                    error="finalization failed",
                    session_snapshot=snapshot,
                    usage=usage,
                    reason={"binding_lost": "binding_lost", "provider_auth": "InvokeAuthorizationError"}.get(
                        self.outcome
                    ),
                ),
            )

    @override
    def cancel_run_and_wait(
        self,
        run_id: str,
        request: CancelRunRequest | None = None,
        *,
        after: str | None = None,
        timeout_seconds: float | None = None,
    ) -> RunCancelledEvent:
        result = super().cancel_run_and_wait(run_id, request, after=after, timeout_seconds=timeout_seconds)
        if self.cancel_fails:
            raise RuntimeError("cancellation failed")
        return result


@pytest.mark.parametrize(
    ("outcome", "cancel_fails", "expected_error", "expected_message"),
    [
        ("success", False, None, None),
        ("failed", False, AgentBackendRunFailedError, "finalization failed"),
        ("cancelled", False, AgentBackendError, "Agent backend run did not complete successfully."),
        (
            "binding_lost",
            False,
            AgentBackendError,
            "The retained agent working environment is no longer available.",
        ),
        ("provider_auth", False, InvokeAuthorizationError, "finalization failed"),
        ("eof", False, AgentBackendError, "Agent backend run did not complete successfully."),
        ("stream_error", False, RuntimeError, "finalization stream interrupted"),
        ("stream_error", True, RuntimeError, "finalization stream interrupted"),
    ],
)
def test_finalization_preserves_chat_records_and_binding_history(
    outcome: str,
    cancel_fails: bool,
    expected_error: type[Exception] | None,
    expected_message: str | None,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    config_overrides: Callable[..., None],
) -> None:
    """Retain only the existing chat history during and after each finalization outcome."""
    config_overrides(APP_MAX_EXECUTION_TIME=60)
    history = _compatible_session_snapshot()
    workspace = AgentWorkspace(
        id="workspace-1",
        tenant_id="tenant-1",
        app_id="app-1",
        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
        owner_id="build-1",
        owner_scope_key="root",
        backend_workspace_ref="backend-workspace-1",
    )
    binding = AgentWorkspaceBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workspace_id=workspace.id,
        agent_id="agent-1",
        agent_config_version_id="build-1",
        agent_config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
        base_home_snapshot_id="home-1",
        backend_binding_ref="backend-binding-1",
        session_snapshot=history.model_dump_json(),
    )
    draft = AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="user-1",
        config_snapshot=_soul(),
        home_snapshot_id="home-1",
        agent_workspace_binding_id=binding.id,
    )
    existing_message = _message_record()
    existing_message.from_source = ConversationFromSource.CONSOLE
    existing_message.from_account_id = "user-1"
    existing_message.from_end_user_id = None
    existing_message.invoke_from = ModelInvokeFrom.DEBUGGER
    sqlite_session.add_all(
        [
            make_account(account_id="user-1"),
            make_app(mode=AppMode.AGENT),
            make_conversation(
                conversation_id="conv-1",
                mode=AppMode.AGENT,
                dialogue_count=1,
                from_source=ConversationFromSource.CONSOLE,
                from_account_id="user-1",
            ),
            existing_message,
            workspace,
            binding,
            draft,
        ]
    )
    sqlite_session.commit()
    before = [
        sqlite_session.execute(select(model.__table__)).all()
        for model in (Conversation, Message, MessageAgentThought, AgentWorkspaceBinding)
    ]
    sqlite_session.rollback()

    history_checked = False

    def check_chat_history() -> None:
        """Read committed history from a fresh session before the runtime emits its terminal event."""
        nonlocal history_checked
        page = MessageRepository(session_factory=sqlite_session_factory).get_console_message_page(
            app_id="app-1",
            app_owner_tenant_id="tenant-1",
            account_id="user-1",
            conversation_id="conv-1",
            first_id=None,
            limit=20,
        )
        assert [(item.record.id, item.record.query) for item in page.data] == [("msg-1", "hello")]
        with sqlite_session_factory() as observer:
            assert observer.scalar(select(func.count()).select_from(Message)) == 1
            assert observer.scalar(select(func.count()).select_from(MessageAgentThought)) == 0
        history_checked = True

    def resolve_model_profile(**_kwargs: object) -> ModelRuntimeProfile:
        """Open a scoped read during runtime assembly, as model and tool resolution may do."""
        assert sqlite_session.scalar(select(Conversation.id)) == "conv-1"
        assert sqlite_session.in_transaction()
        return ModelRuntimeProfile(None, [])

    monkeypatch.setattr("core.app.llm.model_access.resolve_model_runtime_profile", resolve_model_profile)
    hooks = RecordingTracingHooks(None)
    trace_app = Flask(__name__)
    bind_tracing(trace_app, scopes=StoredPolicyTraceScopes(untraced_scopes()), hooks=hooks)
    client = _FinalizationClient(
        outcome, scoped_session=sqlite_session, check_chat_history=check_chat_history, cancel_fails=cancel_fails
    )
    runner = AgentAppRunner(
        request_builder=AgentAppRuntimeRequestBuilder(),
        agent_backend_client=client,
        event_adapter=AgentBackendRunEventAdapter(),
        session_store=AgentAppWorkspaceStore(),
        text_delta_debounce_seconds=0,
    )
    expectation = nullcontext() if expected_error is None else pytest.raises(expected_error, match=expected_message)
    with trace_app.app_context(), expectation as exc_info:
        _run_finalization(runner)
    assert history_checked
    if expected_error is not None:
        assert exc_info is not None
        assert type(exc_info.value) is expected_error
    assert client.request is not None
    assert client.request.session_snapshot == history
    assert UUID(client.request.idempotency_key).version == 4
    config_layer = next(layer for layer in client.request.composition.layers if layer.name == "config")
    assert config_layer.config["config_version"] == {"id": "build-1", "kind": "build_draft", "writable": True}
    prompt_layer = next(layer for layer in client.request.composition.layers if layer.name == "agent_app_user_prompt")
    prompt = DifyUserPromptLayerConfig.model_validate(prompt_layer.config).text
    assert "Build chat message history" in prompt
    assert "update the build-draft config note" in prompt
    assert "respond FINISHED" in prompt
    assert client.cancelled_run_ids == (["run-1"] if outcome == "stream_error" else [])
    assert client.cancel_after == (["5-0"] if outcome == "stream_error" else [])
    assert client.cancel_timeouts == ([5.0] if outcome == "stream_error" else [])
    if cancel_fails:
        assert "Failed to cancel Agent App finalization run: run_id=run-1" in caplog.text
    assert hooks.agent_apps == []
    assert hooks.terminals == []
    assert AgentRosterService(sqlite_session).count_agent_app_debug_conversation_messages(conversation_id="conv-1") == 1
    after = [
        sqlite_session.execute(select(model.__table__)).all()
        for model in (Conversation, Message, MessageAgentThought, AgentWorkspaceBinding)
    ]
    assert after == before


@pytest.mark.parametrize("close_fails", [False, True])
def test_finalization_closes_event_stream_before_cancelling_after_adapter_error(
    close_fails: bool,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cancel from the offending event after releasing the stream and retain the adapter error."""
    config_overrides(APP_MAX_EXECUTION_TIME=60)
    adapter_error = RuntimeError("event adaptation failed")
    original_adapt = AgentBackendRunEventAdapter.adapt
    stream_closed = False

    def adapt(self: AgentBackendRunEventAdapter, event: RunEvent) -> list[AgentBackendInternalEvent]:
        if isinstance(event, PydanticAIStreamRunEvent):
            raise adapter_error
        return original_adapt(self, event)

    class ObservedStreamClient(_RecordingFakeAgentBackendRunClient):
        @override
        def stream_events(
            self,
            run_id: str,
            *,
            after: str | None = None,
            timeout_seconds: float | None = None,
            should_stop: Callable[[], bool] | None = None,
        ) -> Iterator[RunEvent]:
            nonlocal stream_closed
            try:
                yield from _ProcessStreamingFakeAgentBackendRunClient().stream_events(
                    run_id, after=after, timeout_seconds=timeout_seconds, should_stop=should_stop
                )
            finally:
                stream_closed = True
                if close_fails:
                    raise AgentBackendTransportError("response close failed")

        @override
        def cancel_run_and_wait(
            self,
            run_id: str,
            request: CancelRunRequest | None = None,
            *,
            after: str | None = None,
            timeout_seconds: float | None = None,
        ) -> RunCancelledEvent:
            assert stream_closed
            return super().cancel_run_and_wait(run_id, request, after=after, timeout_seconds=timeout_seconds)

    monkeypatch.setattr(AgentBackendRunEventAdapter, "adapt", adapt)
    client = ObservedStreamClient(run_id="run-1")
    with pytest.raises(RuntimeError, match="event adaptation failed") as caught:
        _run_finalization(_runner(client, _FakeSessionStore()))

    assert caught.value is adapter_error
    assert client.cancelled_run_ids == ["run-1"]
    assert client.cancel_after == ["2-0"]
    assert client.cancel_timeouts == [5.0]


@pytest.mark.parametrize(
    ("execution_timeout", "stream_error", "stream_end"),
    [
        (1, None, 101.0),
        (1, AgentBackendTimeoutError("SSE stream exceeded its timeout"), nextafter(101.0, 100.0)),
        (0, AgentBackendTimeoutError("SSE transport timed out"), 100.5),
    ],
)
def test_finalization_cancels_the_created_run_on_stream_timeout(
    execution_timeout: int,
    stream_error: Exception | None,
    stream_end: float,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Use the remaining budget if configured and cancel on deadline or transport timeout."""
    config_overrides(APP_MAX_EXECUTION_TIME=execution_timeout)
    client = _RecordingFakeAgentBackendRunClient(run_id="run-1")
    now = 100.0
    monkeypatch.setattr(app_runner_module.time, "monotonic", lambda: now)
    create = client.create_run

    def create_run(request: CreateRunRequest, *, timeout_seconds: float | None = None) -> CreateRunResponse:
        nonlocal now
        assert timeout_seconds == (1.0 if execution_timeout else None)
        now = 100.25
        return create(request, timeout_seconds=timeout_seconds)

    def stream_events(
        run_id: str,
        *,
        after: str | None = None,
        timeout_seconds: float | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        """Report EOF at the execution deadline or an SDK timeout."""
        nonlocal now
        assert after is None
        assert timeout_seconds == (0.75 if execution_timeout else None)
        assert should_stop is None
        yield RunStartedEvent(id="3-0", run_id=run_id)
        now = stream_end
        if stream_error is not None:
            raise stream_error

    monkeypatch.setattr(client, "create_run", create_run)
    monkeypatch.setattr(client, "stream_events", stream_events)
    store = _FakeSessionStore()
    with pytest.raises(AgentBackendError, match=r"^Build chat finalization timed out\.$") as caught:
        _run_finalization(_runner(client, store))
    assert caught.value.__cause__ is stream_error
    assert client.cancelled_run_ids == ["run-1"]
    assert client.cancel_after == ["3-0"]
    assert client.cancel_timeouts == ([1.0] if execution_timeout else [5.0])
    assert store.saved == []


def test_finalization_cancels_and_maps_exhausted_sse_read_timeouts(
    config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Keep the timeout classification across the SDK and API wrapper before the app deadline."""
    config_overrides(APP_MAX_EXECUTION_TIME=60)
    monkeypatch.setattr("dify_agent.client._client._sleep_sync", lambda _seconds: None)

    class StalledEventStream(httpx.SyncByteStream):
        @override
        def __iter__(self) -> Iterator[bytes]:
            yield b": heartbeat\n\n"
            raise httpx.ReadTimeout("stream stalled")

    cancelled = RunCancelledEvent(id="1-0", run_id="run-1")
    responses = iter(
        [
            httpx.Response(201, json={"run_id": "run-1", "status": "running"}),
            httpx.Response(200, stream=StalledEventStream()),
            httpx.Response(200, stream=StalledEventStream()),
            httpx.Response(202, json={"run_id": "run-1", "status": "cancelled"}),
            httpx.Response(200, text=f"data: {cancelled.model_dump_json()}\n\n"),
        ]
    )
    requests: list[tuple[str, str]] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path))
        return next(responses)

    with httpx.Client(transport=httpx.MockTransport(respond)) as http_client:
        sdk = Client(base_url="http://agent-backend", sync_http_client=http_client)
        client = DifyAgentBackendRunClient(sdk, stream_max_reconnects=1)
        with pytest.raises(AgentBackendError, match=r"^Build chat finalization timed out\.$") as caught:
            _run_finalization(_runner(client, _FakeSessionStore()))

    cause = caught.value.__cause__
    assert isinstance(cause, AgentBackendTimeoutError)
    assert str(cause) == "SSE stream reconnect attempts exhausted"
    assert requests == [
        ("POST", "/runs"),
        ("GET", "/runs/run-1/events/sse"),
        ("GET", "/runs/run-1/events/sse"),
        ("POST", "/runs/run-1/cancel"),
        ("GET", "/runs/run-1/events/sse"),
    ]
    assert "Failed to cancel Agent App finalization run" not in caplog.text


def test_finalization_skips_event_stream_after_run_creation_exhausts_budget(
    config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The accepted run is cancelled without subscribing if creation used the budget."""
    config_overrides(APP_MAX_EXECUTION_TIME=10)
    client = _RecordingFakeAgentBackendRunClient(run_id="run-1")
    now = 100.0
    create = client.create_run

    def create_run(request: CreateRunRequest, *, timeout_seconds: float | None = None) -> CreateRunResponse:
        nonlocal now
        assert timeout_seconds == 10.0
        now = 110.0
        return create(request, timeout_seconds=timeout_seconds)

    def unexpected_stream(*_args: object, **_kwargs: object) -> Iterator[RunEvent]:
        pytest.fail("An expired run must be cancelled without opening its event stream")

    monkeypatch.setattr(app_runner_module.time, "monotonic", lambda: now)
    monkeypatch.setattr(client, "create_run", create_run)
    monkeypatch.setattr(client, "stream_events", unexpected_stream)

    with pytest.raises(AgentBackendError, match=r"^Build chat finalization timed out\.$"):
        _run_finalization(_runner(client, _FakeSessionStore()))

    assert client.cancelled_run_ids == ["run-1"]
    assert client.cancel_after == [None]
    assert client.cancel_timeouts == [5.0]


@pytest.mark.parametrize(
    ("error_type", "finished_at"),
    [(AgentBackendTimeoutError, 100.5), (AgentBackendTransportError, 101.0)],
)
def test_finalization_maps_create_run_timeout_without_streaming_or_cancelling(
    error_type: type[AgentBackendError],
    finished_at: float,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Creation failure before a run ID is known returns the public timeout error."""
    config_overrides(APP_MAX_EXECUTION_TIME=1)
    client = _RecordingFakeAgentBackendRunClient()
    now = 100.0
    error = error_type("create_run_sync timed out")

    def create_run(_request: CreateRunRequest, *, timeout_seconds: float | None = None) -> CreateRunResponse:
        nonlocal now
        assert timeout_seconds == 1.0
        now = finished_at
        raise error

    def unexpected_stream(*_args: object, **_kwargs: object) -> Iterator[RunEvent]:
        pytest.fail("Failed creation leaves no run to stream")

    monkeypatch.setattr(app_runner_module.time, "monotonic", lambda: now)
    monkeypatch.setattr(client, "create_run", create_run)
    monkeypatch.setattr(client, "stream_events", unexpected_stream)

    with pytest.raises(AgentBackendError, match=r"^Build chat finalization timed out\.$") as caught:
        _run_finalization(_runner(client, _FakeSessionStore()))

    assert caught.value.__cause__ is error
    assert client.cancelled_run_ids == []
    assert client.cancel_timeouts == []
