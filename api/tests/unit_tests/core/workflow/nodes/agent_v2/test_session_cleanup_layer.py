from datetime import UTC
from typing import cast

import pytest
from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from dify_agent.protocol import CancelRunRequest, RunEvent, RunStatusResponse

from clients.agent_backend import AgentBackendRunRequestBuilder, FakeAgentBackendRunClient, RuntimeLayerSpec
from clients.agent_backend.errors import AgentBackendHTTPError
from core.workflow.nodes.agent_v2.session_cleanup_layer import WorkflowAgentSessionCleanupLayer
from core.workflow.nodes.agent_v2.session_store import (
    StoredWorkflowAgentSession,
    WorkflowAgentRuntimeSessionStore,
    WorkflowAgentSessionScope,
)
from core.workflow.system_variables import build_system_variables
from graphon.entities.pause_reason import SchedulingPause
from graphon.graph_engine.command_channels import CommandChannel
from graphon.graph_events import (
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
)
from graphon.runtime import GraphRuntimeState, ReadOnlyGraphRuntimeStateWrapper, VariablePool


def _layer_snapshot(name: str) -> LayerSessionSnapshot:
    return LayerSessionSnapshot(
        name=name,
        lifecycle_state=LifecycleState.SUSPENDED,
        runtime_state={},
    )


def _stored_session(scope: WorkflowAgentSessionScope, *, index: int = 1) -> StoredWorkflowAgentSession:
    """A typical stored session with prompt + execution_context + history + llm specs.

    The LLM layer is *not* in ``runtime_layer_specs`` because the cleanup
    contract excludes credential-bearing plugin layers, but it *is* present in
    the saved snapshot so the layer's filter logic gets exercised.
    """
    return StoredWorkflowAgentSession(
        scope=scope,
        session_snapshot=CompositorSessionSnapshot(
            layers=[
                _layer_snapshot("workflow_node_job_prompt"),
                _layer_snapshot("execution_context"),
                _layer_snapshot("history"),
                _layer_snapshot("llm"),
            ]
        ),
        backend_run_id=f"agent-run-{index}",
        runtime_layer_specs=[
            RuntimeLayerSpec(name="workflow_node_job_prompt", type="plain.prompt", config={"prefix": "ok"}),
            RuntimeLayerSpec(name="execution_context", type="dify.execution_context", config={"tenant_id": "t"}),
            RuntimeLayerSpec(name="history", type="pydantic_ai.history"),
        ],
    )


class FakeSessionStore:
    """In-memory stand-in for ``WorkflowAgentRuntimeSessionStore``."""

    def __init__(self, *, stored: list[StoredWorkflowAgentSession] | None = None) -> None:
        self._stored = stored if stored is not None else [_stored_session(_default_scope())]
        self.list_calls: list[str] = []
        self.cleaned: list[tuple[WorkflowAgentSessionScope, str | None]] = []

    def list_active_sessions(self, *, workflow_run_id: str) -> list[StoredWorkflowAgentSession]:
        self.list_calls.append(workflow_run_id)
        return list(self._stored)

    def mark_cleaned(self, *, scope: WorkflowAgentSessionScope, backend_run_id: str | None = None) -> None:
        self.cleaned.append((scope, backend_run_id))


def _default_scope() -> WorkflowAgentSessionScope:
    return WorkflowAgentSessionScope(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id="workflow-run-1",
        node_id="agent-node",
        node_execution_id="node-exec-1",
        binding_id="binding-1",
        agent_id="agent-1",
        agent_config_snapshot_id="snapshot-1",
    )


class _WaitableFakeAgentBackendRunClient(FakeAgentBackendRunClient):
    """``FakeAgentBackendRunClient`` plus the ``wait_run`` hook the layer needs."""

    def __init__(
        self,
        *,
        run_id: str = "cleanup-run-1",
        wait_status: str = "succeeded",
        wait_error: str | None = None,
        wait_raises: Exception | None = None,
    ) -> None:
        super().__init__(run_id=run_id)
        self._wait_status = wait_status
        self._wait_error = wait_error
        self._wait_raises = wait_raises
        self.wait_calls: list[tuple[str, float | None]] = []

    def wait_run(self, run_id: str, *, timeout_seconds: float | None = None) -> RunStatusResponse:
        self.wait_calls.append((run_id, timeout_seconds))
        if self._wait_raises is not None:
            raise self._wait_raises
        from datetime import datetime

        return RunStatusResponse(
            run_id=run_id,
            status=cast(object, self._wait_status),  # protocol Literal; cast keeps tests flexible
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
            updated_at=datetime(2026, 1, 1, tzinfo=UTC),
            error=self._wait_error,
        )

    # Inherit ``create_run`` from FakeAgentBackendRunClient; the missing protocol
    # methods below are stub-only because the cleanup layer never calls them.
    def cancel_run(self, run_id: str, request: CancelRunRequest | None = None):  # pragma: no cover
        del run_id, request
        raise NotImplementedError

    def stream_events(self, run_id: str, *, after: str | None = None):  # pragma: no cover
        del run_id, after
        if False:
            yield cast(RunEvent, None)


def _build_layer(
    *,
    session_store: FakeSessionStore,
    agent_backend_client: _WaitableFakeAgentBackendRunClient,
    http_cleanup_supported: bool = True,
) -> WorkflowAgentSessionCleanupLayer:
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(workflow_execution_id="workflow-run-1"),
        user_inputs={},
        conversation_variables=[],
    )
    runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)
    layer = WorkflowAgentSessionCleanupLayer(
        session_store=cast(WorkflowAgentRuntimeSessionStore, session_store),
        request_builder=AgentBackendRunRequestBuilder(),
        agent_backend_client=agent_backend_client,
    )
    # Tests opt in to the future HTTP-cleanup branch; the production default
    # (False) is exercised by the dedicated tests below.
    layer._HTTP_CLEANUP_SUPPORTED = http_cleanup_supported  # type: ignore[reportPrivateUsage]
    layer.initialize(ReadOnlyGraphRuntimeStateWrapper(runtime_state), cast(CommandChannel, object()))
    return layer


@pytest.mark.parametrize(
    "terminal_event",
    [
        GraphRunSucceededEvent(outputs={}),
        GraphRunPartialSucceededEvent(exceptions_count=1, outputs={}),
        GraphRunFailedEvent(error="boom"),
        GraphRunAbortedEvent(reason="user cancelled", outputs={}),
    ],
    ids=["succeeded", "partial_succeeded", "failed", "aborted"],
)
def test_cleanup_layer_triggers_cleanup_only_run_on_each_terminal_event(terminal_event):
    session_store = FakeSessionStore()
    agent_backend_client = _WaitableFakeAgentBackendRunClient()
    layer = _build_layer(session_store=session_store, agent_backend_client=agent_backend_client)

    layer.on_event(terminal_event)

    assert session_store.list_calls == ["workflow-run-1"]
    assert agent_backend_client.request is not None
    # Cleanup composition replays the persisted (non-plugin) layer specs so the
    # agent backend's snapshot-vs-composition name match succeeds.
    layer_names = [layer.name for layer in agent_backend_client.request.composition.layers]
    assert layer_names == ["workflow_node_job_prompt", "execution_context", "history"]
    assert agent_backend_client.request.on_exit.default.value == "delete"
    assert agent_backend_client.request.metadata["agent_backend_lifecycle"] == "session_cleanup"
    # Snapshot is filtered to drop the plugin layer entry so names match the
    # cleanup composition.
    assert agent_backend_client.request.session_snapshot is not None
    snapshot_names = [layer.name for layer in agent_backend_client.request.session_snapshot.layers]
    assert snapshot_names == ["workflow_node_job_prompt", "execution_context", "history"]
    # The layer waited for terminal status and the run succeeded, so the row
    # is marked CLEANED with the cleanup run id.
    assert agent_backend_client.wait_calls
    assert session_store.cleaned == [(_default_scope(), "cleanup-run-1")]


@pytest.mark.parametrize(
    "non_terminal_event",
    [
        GraphRunStartedEvent(),
        GraphRunPausedEvent(reasons=[SchedulingPause(message="awaiting human input")], outputs={}),
    ],
    ids=["started", "paused"],
)
def test_cleanup_layer_ignores_non_terminal_events(non_terminal_event):
    session_store = FakeSessionStore()
    agent_backend_client = _WaitableFakeAgentBackendRunClient()
    layer = _build_layer(session_store=session_store, agent_backend_client=agent_backend_client)

    layer.on_event(non_terminal_event)

    assert session_store.list_calls == []
    assert agent_backend_client.request is None
    assert session_store.cleaned == []


def test_cleanup_layer_does_not_mark_cleaned_when_cleanup_run_fails():
    """Trap D: cleanup-only run goes ``run_failed`` (e.g. snapshot validation
    error) — the layer must leave the row ACTIVE so it can be retried instead
    of silently leaking suspended agent-backend layers."""
    session_store = FakeSessionStore()
    agent_backend_client = _WaitableFakeAgentBackendRunClient(
        wait_status="failed",
        wait_error="snapshot mismatch",
    )
    layer = _build_layer(session_store=session_store, agent_backend_client=agent_backend_client)

    layer.on_event(GraphRunSucceededEvent(outputs={}))

    assert agent_backend_client.wait_calls
    assert session_store.cleaned == []


def test_cleanup_layer_does_not_mark_cleaned_when_wait_raises():
    session_store = FakeSessionStore()
    agent_backend_client = _WaitableFakeAgentBackendRunClient(
        wait_raises=AgentBackendHTTPError("boom", status_code=500, detail=None),
    )
    layer = _build_layer(session_store=session_store, agent_backend_client=agent_backend_client)

    layer.on_event(GraphRunSucceededEvent(outputs={}))

    assert session_store.cleaned == []


def test_cleanup_layer_marks_cleaned_locally_when_http_cleanup_disabled():
    """Production default: dify-agent has no cleanup-only run mode yet, so the
    layer must retire the local row without issuing a doomed HTTP request that
    would crash inside the agent backend's runner on the missing LLM layer."""
    session_store = FakeSessionStore()
    agent_backend_client = _WaitableFakeAgentBackendRunClient()
    layer = _build_layer(
        session_store=session_store,
        agent_backend_client=agent_backend_client,
        http_cleanup_supported=False,
    )

    layer.on_event(GraphRunSucceededEvent(outputs={}))

    # No HTTP call goes out — the trap is avoided entirely.
    assert agent_backend_client.request is None
    assert agent_backend_client.wait_calls == []
    # Local row is still retired so a workflow loop cannot resume from stale state.
    assert session_store.cleaned == [(_default_scope(), "agent-run-1")]


def test_cleanup_layer_skips_sessions_without_persisted_specs():
    """Backwards-compatible safety net: a row written before A.1 landed has
    no runtime_layer_specs, so cleanup would unavoidably hit the snapshot-
    validation trap. The layer must skip such rows instead of issuing a
    doomed request."""
    scope = _default_scope()
    legacy_session = StoredWorkflowAgentSession(
        scope=scope,
        session_snapshot=CompositorSessionSnapshot(layers=[_layer_snapshot("history")]),
        backend_run_id="legacy-run",
        runtime_layer_specs=[],
    )
    session_store = FakeSessionStore(stored=[legacy_session])
    agent_backend_client = _WaitableFakeAgentBackendRunClient()
    layer = _build_layer(session_store=session_store, agent_backend_client=agent_backend_client)

    layer.on_event(GraphRunSucceededEvent(outputs={}))

    assert agent_backend_client.request is None
    assert session_store.cleaned == []


def test_cleanup_layer_fans_out_to_every_active_session():
    scopes = [
        WorkflowAgentSessionScope(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_run_id="workflow-run-1",
            node_id=f"agent-node-{i}",
            node_execution_id=f"node-exec-{i}",
            binding_id=f"binding-{i}",
            agent_id=f"agent-{i}",
            agent_config_snapshot_id=f"snapshot-{i}",
        )
        for i in range(3)
    ]
    session_store = FakeSessionStore(stored=[_stored_session(scope, index=i) for i, scope in enumerate(scopes, 1)])
    agent_backend_client = _WaitableFakeAgentBackendRunClient(run_id="cleanup-run-many")
    layer = _build_layer(session_store=session_store, agent_backend_client=agent_backend_client)

    layer.on_event(GraphRunSucceededEvent(outputs={}))

    # One cleanup row per stored ACTIVE session, all marked cleaned with the
    # backend run id returned by the agent backend client.
    assert [entry[0] for entry in session_store.cleaned] == scopes
    assert {entry[1] for entry in session_store.cleaned} == {"cleanup-run-many"}


def test_cleanup_layer_warns_when_http_enabled_but_client_missing(caplog):
    """The HTTP cleanup branch must defensively skip when no client was wired.

    This is the deployment-misconfig path: ``_HTTP_CLEANUP_SUPPORTED`` was
    flipped to ``True`` but ``AGENT_BACKEND_BASE_URL`` is unset, so the
    factory returned ``None``. The layer must not crash and must not silently
    retire the row — the warning surfaces the misconfig.
    """
    import logging

    session_store = FakeSessionStore()
    layer = WorkflowAgentSessionCleanupLayer(
        session_store=cast(WorkflowAgentRuntimeSessionStore, session_store),
        request_builder=AgentBackendRunRequestBuilder(),
        agent_backend_client=None,
    )
    layer._HTTP_CLEANUP_SUPPORTED = True  # type: ignore[reportPrivateUsage]
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(workflow_execution_id="workflow-run-1"),
        user_inputs={},
        conversation_variables=[],
    )
    runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)
    layer.initialize(ReadOnlyGraphRuntimeStateWrapper(runtime_state), cast(CommandChannel, object()))

    with caplog.at_level(logging.WARNING):
        layer.on_event(GraphRunSucceededEvent(outputs={}))

    assert session_store.cleaned == []
    assert any("no agent backend client is wired in" in record.message for record in caplog.records)


def test_cleanup_layer_skips_workflow_terminal_when_workflow_run_id_missing(caplog):
    """``workflow_run_id`` is the keying field; without it the fanout cannot
    target a row, so the layer logs a warning and bails."""
    import logging

    session_store = FakeSessionStore()
    agent_backend_client = _WaitableFakeAgentBackendRunClient()
    layer = WorkflowAgentSessionCleanupLayer(
        session_store=cast(WorkflowAgentRuntimeSessionStore, session_store),
        request_builder=AgentBackendRunRequestBuilder(),
        agent_backend_client=agent_backend_client,
    )
    # Bootstrap *without* a workflow_execution_id system variable.
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(workflow_execution_id=""),
        user_inputs={},
        conversation_variables=[],
    )
    runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)
    layer.initialize(ReadOnlyGraphRuntimeStateWrapper(runtime_state), cast(CommandChannel, object()))

    with caplog.at_level(logging.WARNING):
        layer.on_event(GraphRunSucceededEvent(outputs={}))

    assert session_store.list_calls == []
    assert session_store.cleaned == []
    assert any("workflow_run_id is missing" in record.message for record in caplog.records)


def test_build_workflow_agent_session_cleanup_layer_returns_layer_without_client_when_unconfigured(
    monkeypatch,
):
    """The production builder must pass ``None`` for the agent backend client
    when neither AGENT_BACKEND_BASE_URL nor AGENT_BACKEND_USE_FAKE is set, so
    that unit-test environments without backend config don't crash at runner
    construction."""
    from configs import dify_config
    from core.workflow.nodes.agent_v2.session_cleanup_layer import (
        build_workflow_agent_session_cleanup_layer,
    )

    monkeypatch.setattr(dify_config, "AGENT_BACKEND_BASE_URL", None, raising=False)
    monkeypatch.setattr(dify_config, "AGENT_BACKEND_USE_FAKE", False, raising=False)

    layer = build_workflow_agent_session_cleanup_layer()
    assert layer._agent_backend_client is None  # type: ignore[reportPrivateUsage]


def test_build_workflow_agent_session_cleanup_layer_returns_layer_with_fake_client(monkeypatch):
    """With ``AGENT_BACKEND_USE_FAKE`` enabled the helper wires in the
    deterministic fake client without needing a base_url."""
    from clients.agent_backend.fake_client import FakeAgentBackendRunClient
    from configs import dify_config
    from core.workflow.nodes.agent_v2.session_cleanup_layer import (
        build_workflow_agent_session_cleanup_layer,
    )

    monkeypatch.setattr(dify_config, "AGENT_BACKEND_BASE_URL", None, raising=False)
    monkeypatch.setattr(dify_config, "AGENT_BACKEND_USE_FAKE", True, raising=False)
    monkeypatch.setattr(dify_config, "AGENT_BACKEND_FAKE_SCENARIO", "success", raising=False)

    layer = build_workflow_agent_session_cleanup_layer()
    assert isinstance(layer._agent_backend_client, FakeAgentBackendRunClient)  # type: ignore[reportPrivateUsage]
