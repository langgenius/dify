"""Unit tests for the Agent App runner — verifies the agent-backend event
stream is republished as chat queue events and the conversation snapshot is
saved, using the deterministic fake backend client (no live stack)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, override

import pytest
from agenton.compositor import CompositorSessionSnapshot
from dify_agent.protocol import CancelRunRequest, CancelRunResponse, RuntimeLayerSpec

from clients.agent_backend import (
    AgentBackendError,
    AgentBackendRunEventAdapter,
    FakeAgentBackendRunClient,
    FakeAgentBackendScenario,
)
from core.app.apps.agent_app.app_runner import AgentAppRunner
from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeRequestBuilder
from core.app.apps.agent_app.session_store import AgentAppSessionScope
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.entities.queue_entities import QueueLLMChunkEvent, QueueMessageEndEvent
from models.agent_config_entities import AgentSoulConfig


class _FakeCredentialsProvider:
    def fetch(self, provider_name: str, model_name: str) -> dict[str, Any]:
        return {"openai_api_key": "sk-test"}


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


class _FakeSessionStore:
    def __init__(self, loaded: CompositorSessionSnapshot | None = None) -> None:
        self.loaded = loaded
        self.saved: list[
            tuple[AgentAppSessionScope, str, CompositorSessionSnapshot | None, list[RuntimeLayerSpec]]
        ] = []

    def load_active_snapshot(self, scope: AgentAppSessionScope) -> CompositorSessionSnapshot | None:
        return self.loaded

    def save_active_snapshot(self, *, scope, backend_run_id, snapshot, runtime_layer_specs) -> None:
        self.saved.append((scope, backend_run_id, snapshot, list(runtime_layer_specs)))


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
    # The conversation session snapshot is persisted for multi-turn continuity.
    assert store.saved
    saved_scope, saved_run_id, saved_snapshot, saved_specs = store.saved[0]
    assert saved_scope.conversation_id == "conv-1"
    assert saved_scope.agent_config_snapshot_id == "snap-1"
    assert saved_run_id == "fake-run-1"
    assert saved_snapshot is not None
    assert [spec.name for spec in saved_specs] == [
        "agent_soul_prompt",
        "agent_app_user_prompt",
        "execution_context",
        "history",
    ]


def test_prior_session_snapshot_is_threaded_into_request():
    prior = CompositorSessionSnapshot(layers=[])
    client = FakeAgentBackendRunClient()
    store = _FakeSessionStore(loaded=prior)
    qm = _FakeQueueManager()

    _run(_runner(client, store), qm)

    assert client.request is not None
    assert client.request.session_snapshot is prior


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
