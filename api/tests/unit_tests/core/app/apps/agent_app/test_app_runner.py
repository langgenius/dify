"""Unit tests for the Agent App runner — verifies the agent-backend event
stream is republished as chat queue events and the conversation snapshot is
saved, using the deterministic fake backend client (no live stack)."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, override
from unittest.mock import MagicMock

import pytest
from agenton.compositor import CompositorSessionSnapshot
from dify_agent.layers.ask_human import AskHumanToolResult
from dify_agent.protocol import (
    CancelRunRequest,
    CancelRunResponse,
    PydanticAIStreamRunEvent,
    RunEvent,
    RunStartedEvent,
    RunSucceededEvent,
    RunSucceededEventData,
    RuntimeLayerSpec,
)
from pydantic_ai.messages import PartDeltaEvent, PartStartEvent, TextPart, TextPartDelta

from clients.agent_backend import (
    AgentBackendError,
    AgentBackendRunEventAdapter,
    FakeAgentBackendRunClient,
    FakeAgentBackendScenario,
)
from core.app.apps.agent_app.app_runner import AgentAppRunner
from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeRequestBuilder
from core.app.apps.agent_app.session_store import AgentAppSessionScope, StoredAgentAppSession
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.entities.queue_entities import QueueLLMChunkEvent, QueueMessageEndEvent
from core.workflow.nodes.agent_v2.ask_human_resume import AskHumanResumeOutcome
from models.agent_config_entities import AgentSoulConfig


class _FakeCredentialsProvider:
    def fetch(self, provider_name: str, model_name: str) -> dict[str, Any]:
        return {"openai_api_key": "sk-test"}


@pytest.fixture(autouse=True)
def _disable_drive_manifest_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.app.apps.agent_app.runtime_request_builder.dify_config.AGENT_DRIVE_MANIFEST_ENABLED", False
    )


class _NoToolsBuilder:
    def build(self, **kwargs):
        del kwargs


class _FakeQueueManager:
    def __init__(self) -> None:
        self.events: list[Any] = []

    def publish(self, event: Any, _from: Any) -> None:
        self.events.append(event)

    def is_stopped(self) -> bool:
        return False


class _StoppedQueueManager(_FakeQueueManager):
    @override
    def is_stopped(self) -> bool:
        return True


class _RecordingFakeAgentBackendRunClient(FakeAgentBackendRunClient):
    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.cancelled_run_ids: list[str] = []

    @override
    def cancel_run(self, run_id: str, request: CancelRunRequest | None = None) -> CancelRunResponse:
        self.cancelled_run_ids.append(run_id)
        return super().cancel_run(run_id, request=request)


class _StreamingFakeAgentBackendRunClient(FakeAgentBackendRunClient):
    @override
    def stream_events(self, run_id: str, *, after: str | None = None) -> Iterator[RunEvent]:
        del after
        created_at = datetime(2026, 1, 1, tzinfo=UTC)
        yield RunStartedEvent(id="1-0", run_id=run_id, created_at=created_at)
        yield PydanticAIStreamRunEvent(
            id="2-0",
            run_id=run_id,
            created_at=created_at,
            data=PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="hello ")),
        )
        yield PydanticAIStreamRunEvent(
            id="3-0",
            run_id=run_id,
            created_at=created_at,
            data=PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="agent")),
        )
        yield RunSucceededEvent(
            id="4-0",
            run_id=run_id,
            created_at=created_at,
            data=RunSucceededEventData(
                output={"text": "hello agent"},
                session_snapshot=CompositorSessionSnapshot(layers=[]),
            ),
        )


class _StreamingPartStartFakeAgentBackendRunClient(FakeAgentBackendRunClient):
    @override
    def stream_events(self, run_id: str, *, after: str | None = None) -> Iterator[RunEvent]:
        del after
        created_at = datetime(2026, 1, 1, tzinfo=UTC)
        yield RunStartedEvent(id="1-0", run_id=run_id, created_at=created_at)
        yield PydanticAIStreamRunEvent(
            id="2-0",
            run_id=run_id,
            created_at=created_at,
            data=PartStartEvent(index=0, part=TextPart(content="hello")),
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


class _FakeSessionStore:
    def __init__(
        self,
        loaded: CompositorSessionSnapshot | None = None,
        loaded_session: StoredAgentAppSession | None = None,
    ) -> None:
        self.loaded = loaded
        self._loaded_session = loaded_session
        self.loaded_scopes: list[AgentAppSessionScope] = []
        self.saved: list[
            tuple[
                AgentAppSessionScope,
                str,
                CompositorSessionSnapshot | None,
                list[RuntimeLayerSpec],
                str | None,
                str | None,
            ]
        ] = []

    def load_active_snapshot(self, scope: AgentAppSessionScope) -> CompositorSessionSnapshot | None:
        self.loaded_scopes.append(scope)
        return self.loaded

    def load_active_session(self, scope: AgentAppSessionScope) -> StoredAgentAppSession | None:
        self.loaded_scopes.append(scope)
        if self._loaded_session is not None:
            return self._loaded_session
        if self.loaded is None:
            return None
        return StoredAgentAppSession(scope=scope, session_snapshot=self.loaded, backend_run_id=None)

    def save_active_snapshot(
        self,
        *,
        scope,
        backend_run_id,
        snapshot,
        runtime_layer_specs,
        pending_form_id=None,
        pending_tool_call_id=None,
    ) -> None:
        self.saved.append(
            (scope, backend_run_id, snapshot, list(runtime_layer_specs), pending_form_id, pending_tool_call_id)
        )


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


def _dify_ctx() -> Any:
    return SimpleNamespace(
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="user-1",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )


def _runner(client: FakeAgentBackendRunClient, store: _FakeSessionStore) -> AgentAppRunner:
    return AgentAppRunner(
        request_builder=AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            plugin_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        ),
        agent_backend_client=client,
        event_adapter=AgentBackendRunEventAdapter(),
        session_store=store,  # type: ignore[arg-type]
    )


def _run(runner: AgentAppRunner, qm: _FakeQueueManager) -> None:
    runner.run(
        dify_context=_dify_ctx(),
        agent_id="agent-1",
        agent_config_snapshot_id="snap-1",
        agent_soul=_soul(),
        conversation_id="conv-1",
        query="hello",
        message_id="msg-1",
        model_name="gpt-4o-mini",
        queue_manager=qm,  # type: ignore[arg-type]
    )


def _message_end(qm: _FakeQueueManager) -> QueueMessageEndEvent:
    return next(e for e in qm.events if isinstance(e, QueueMessageEndEvent))


def _saved_user_query(qm: _FakeQueueManager) -> str:
    llm_result = _message_end(qm).llm_result
    assert llm_result is not None
    prompt_messages = llm_result.prompt_messages
    assert len(prompt_messages) == 1
    content = prompt_messages[0].content
    assert isinstance(content, str)
    return content


def test_successful_turn_publishes_chunk_and_message_end_and_saves_session():
    client = FakeAgentBackendRunClient()  # SUCCESS: output {"text": "hello agent"}
    store = _FakeSessionStore()
    qm = _FakeQueueManager()

    _run(_runner(client, store), qm)

    # One LLM chunk + one message-end, carrying the backend's answer text.
    chunk_events = [e for e in qm.events if isinstance(e, QueueLLMChunkEvent)]
    end_events = [e for e in qm.events if isinstance(e, QueueMessageEndEvent)]
    assert len(chunk_events) == 1
    assert len(end_events) == 1
    assert chunk_events[0].chunk.delta.message.content == "hello agent"
    assert end_events[0].llm_result.message.content == "hello agent"
    assert end_events[0].llm_result.model == "gpt-4o-mini"
    assert _saved_user_query(qm) == "hello"
    # The conversation session snapshot is persisted for multi-turn continuity.
    assert store.saved
    saved_scope, saved_run_id, saved_snapshot, saved_specs, pending_form_id, pending_tool_call_id = store.saved[0]
    assert saved_scope.conversation_id == "conv-1"
    assert saved_scope.agent_config_snapshot_id == "snap-1"
    assert saved_run_id == "fake-run-1"
    assert saved_snapshot is not None
    # A successful turn carries no ask_human pause correlation.
    assert pending_form_id is None
    assert pending_tool_call_id is None
    assert [spec.name for spec in saved_specs] == [
        "agent_soul_prompt",
        "agent_app_user_prompt",
        "execution_context",
        "history",
    ]


def test_successful_turn_forwards_agent_backend_stream_text_deltas_without_duplicate_terminal_chunk():
    client = _StreamingFakeAgentBackendRunClient()
    store = _FakeSessionStore()
    qm = _FakeQueueManager()

    _run(_runner(client, store), qm)

    chunk_events = [e for e in qm.events if isinstance(e, QueueLLMChunkEvent)]
    end_events = [e for e in qm.events if isinstance(e, QueueMessageEndEvent)]
    assert [event.chunk.delta.message.content for event in chunk_events] == ["hello ", "agent"]
    assert len(end_events) == 1
    assert end_events[0].llm_result.message.content == "hello agent"
    assert store.saved


def test_successful_turn_forwards_part_start_text_and_publishes_missing_terminal_suffix():
    client = _StreamingPartStartFakeAgentBackendRunClient()
    store = _FakeSessionStore()
    qm = _FakeQueueManager()

    _run(_runner(client, store), qm)

    chunk_events = [e for e in qm.events if isinstance(e, QueueLLMChunkEvent)]
    end_events = [e for e in qm.events if isinstance(e, QueueMessageEndEvent)]
    assert [event.chunk.delta.message.content for event in chunk_events] == ["hello", " agent"]
    assert len(end_events) == 1
    assert end_events[0].llm_result.message.content == "hello agent"


def test_prior_session_snapshot_is_threaded_into_request():
    prior = CompositorSessionSnapshot(layers=[])
    client = FakeAgentBackendRunClient()
    store = _FakeSessionStore(loaded=prior)
    qm = _FakeQueueManager()

    _run(_runner(client, store), qm)

    assert client.request is not None
    assert client.request.session_snapshot is prior


def test_debug_session_scope_can_reuse_conversation_across_config_snapshots():
    prior = CompositorSessionSnapshot(layers=[])
    client = FakeAgentBackendRunClient()
    store = _FakeSessionStore(loaded=prior)
    qm = _FakeQueueManager()

    _runner(client, store).run(
        dify_context=_dify_ctx(),
        agent_id="agent-1",
        agent_config_snapshot_id="snap-new",
        agent_soul=_soul(),
        conversation_id="conv-1",
        query="hello",
        message_id="msg-1",
        model_name="gpt-4o-mini",
        queue_manager=qm,  # type: ignore[arg-type]
        session_scope_snapshot_id=None,
    )

    assert client.request is not None
    assert client.request.session_snapshot is prior
    assert store.loaded_scopes[0].agent_config_snapshot_id is None
    assert store.saved[0][0].agent_config_snapshot_id is None


def test_failed_run_raises_agent_backend_error():
    client = FakeAgentBackendRunClient(scenario=FakeAgentBackendScenario.FAILED)
    store = _FakeSessionStore()
    qm = _FakeQueueManager()

    with pytest.raises(AgentBackendError):
        _run(_runner(client, store), qm)
    # No message-end on failure; no snapshot saved.
    assert not [e for e in qm.events if isinstance(e, QueueMessageEndEvent)]
    assert store.saved == []


def test_stopped_task_cancels_agent_backend_run_and_skips_session_save():
    client = _RecordingFakeAgentBackendRunClient()
    store = _FakeSessionStore()
    qm = _StoppedQueueManager()

    with pytest.raises(GenerateTaskStoppedError):
        _run(_runner(client, store), qm)

    assert client.cancelled_run_ids == ["fake-run-1"]
    assert store.saved == []


def test_extract_answer_handles_plain_string_and_dict():
    assert AgentAppRunner._extract_answer("plain text") == "plain text"
    assert AgentAppRunner._extract_answer({"text": "hi"}) == "hi"
    assert AgentAppRunner._extract_answer({"a": 1}) == '{"a": 1}'


def test_ask_human_pauses_turn_creates_form_and_persists_correlation():
    # ENG-635/637: the PAUSED scenario emits a dify.ask_human deferred call, so
    # the chat turn ends by creating a conversation-owned HITL form + saving the
    # pause correlation, instead of crashing. Stub the form repo (DB-free).
    client = FakeAgentBackendRunClient(scenario=FakeAgentBackendScenario.PAUSED)
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
    # The pause correlation is persisted so a form submission can resume the run.
    assert store.saved
    assert store.saved[0][4] == "form-1"
    assert store.saved[0][5] == "fake-ask-human-1"


def test_submitted_form_resumes_turn_with_deferred_tool_results(monkeypatch):
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
        ),
        session_snapshot=snapshot,
        backend_run_id="run-0",
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
