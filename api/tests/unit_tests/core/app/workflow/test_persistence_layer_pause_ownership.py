"""Regression tests for the pause transaction ownership contract (#41560).

A workflow run must become observably ``PAUSED`` only when its pause record,
reasons, and readable resumption snapshot are committed together, and the
paused outcome must be published only after that transaction succeeds.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import QueueWorkflowFailedEvent, QueueWorkflowPausedEvent
from core.app.entities.workflow_pause_state import PauseStateConfig, WorkflowResumptionContext
from core.app.workflow.layers.persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from core.workflow.system_variables import build_system_variables
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from graphon.filters import GraphEventFilterContext, ResponseStreamFilter
from graphon.graph_events import GraphRunPausedEvent, GraphRunStartedEvent
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.runtime import GraphRuntimeState, ReadOnlyGraphRuntimeStateWrapper, VariablePool
from models.model import AppMode

_RUN_ID = "run-id"


class _CallLog:
    def __init__(self) -> None:
        self.calls: list[str] = []


def _initialized_response_stream_filter() -> ResponseStreamFilter:
    """Return a filter that satisfies the `initialize()` precondition for `dumps()`.

    In production `WorkflowEntry` initializes the filter before any event,
    including `GraphRunPausedEvent`, reaches the persistence layers.
    """
    response_stream_filter = ResponseStreamFilter()
    response_stream_filter.initialize(GraphEventFilterContext(graph=Mock(nodes={}), runtime_state=Mock()))
    return response_stream_filter


class _ExecutionRepo:
    def __init__(self, log: _CallLog, *, fail: bool = False) -> None:
        self.log = log
        self.fail = fail
        self.saved: list[object] = []

    def save(self, entity):
        self.log.calls.append("execution.save")
        if self.fail:
            raise RuntimeError("mirror storage backend down")
        self.saved.append(entity)

    def save_synchronously(self, entity):
        self.saved.append(entity)

    def save_execution_data(self, entity):
        pass

    def get_by_workflow_execution(self, _workflow_execution_id):
        return []


class _PauseRepo:
    def __init__(self, log: _CallLog, *, fail: bool = False) -> None:
        self.log = log
        self.fail = fail
        self.calls_kwargs: dict[str, object] | None = None

    def pause_workflow_run(self, workflow_run_id: str, **kwargs):
        self.log.calls.append("pause_workflow_run")
        if self.fail:
            raise RuntimeError("db commit failed")
        self.calls_kwargs = {"workflow_run_id": workflow_run_id, **kwargs}
        return SimpleNamespace()


def _make_layer(
    log: _CallLog,
    *,
    pause_repo: _PauseRepo | None = None,
    with_owner: bool = True,
    monkeypatch=None,
    total_tokens: int = 0,
    node_run_steps: int = 0,
):
    system_variables = build_system_variables(workflow_execution_id=_RUN_ID, conversation_id="conv-id")
    llm_usage = LLMUsage.empty_usage().model_copy(update={"total_tokens": total_tokens})
    runtime_state = GraphRuntimeState(
        variable_pool=VariablePool.from_bootstrap(system_variables=system_variables),
        start_at=0.0,
        llm_usage=llm_usage,
        node_run_steps=node_run_steps,
    )
    application_generate_entity = WorkflowAppGenerateEntity.model_construct(
        task_id="task",
        app_config=WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.WORKFLOW,
            workflow_id="workflow-id",
        ),
        inputs={},
        files=[],
        user_id="user",
        stream=False,
        invoke_from=InvokeFrom.SERVICE_API,
        trace_manager=None,
        workflow_execution_id=_RUN_ID,
        extras={},
        call_depth=0,
    )
    execution_repo = _ExecutionRepo(log)
    kwargs: dict[str, object] = {}
    if with_owner:
        kwargs["pause_state_config"] = PauseStateConfig(
            session_factory=object(),  # type: ignore[arg-type]
            state_owner_user_id="owner",
        )
        kwargs["response_stream_filter"] = _initialized_response_stream_filter()
        if monkeypatch is not None and pause_repo is not None:

            def _factory(_session):
                return pause_repo

            monkeypatch.setattr(
                "core.app.workflow.layers.persistence.DifyAPIRepositoryFactory.create_api_workflow_run_repository",
                staticmethod(_factory),
            )

    layer = WorkflowPersistenceLayer(
        application_generate_entity=application_generate_entity,
        workflow_info=PersistenceWorkflowInfo(
            workflow_id="workflow-id",
            workflow_type=WorkflowType.WORKFLOW,
            version="1",
            graph_data={"nodes": [], "edges": []},
        ),
        workflow_execution_repository=execution_repo,
        workflow_node_execution_repository=execution_repo,
        **kwargs,
    )
    layer.initialize(ReadOnlyGraphRuntimeStateWrapper(runtime_state), command_channel=None)
    layer.on_event(_started_event())
    # Drop the run-start bookkeeping so each test observes only pause traffic.
    log.calls.clear()
    execution_repo.saved.clear()
    return layer, execution_repo, runtime_state


def _started_event() -> GraphRunStartedEvent:
    return GraphRunStartedEvent()


def _paused_event() -> GraphRunPausedEvent:
    return GraphRunPausedEvent(
        reasons=[SchedulingPause(message="wait")],
        outputs={"answer": "paused"},
    )


class TestOwnerPath:
    def test_on_event_does_not_commit_pause_when_layer_owns_it(self, monkeypatch):
        log = _CallLog()
        pause_repo = _PauseRepo(log)
        layer, execution_repo, _ = _make_layer(log, pause_repo=pause_repo, monkeypatch=monkeypatch)

        layer.on_event(_paused_event())

        assert "pause_workflow_run" not in log.calls
        assert execution_repo.saved == []

    def test_persist_pause_commits_pause_before_mirroring(self, monkeypatch):
        log = _CallLog()
        pause_repo = _PauseRepo(log)
        layer, execution_repo, runtime_state = _make_layer(
            log,
            pause_repo=pause_repo,
            monkeypatch=monkeypatch,
            total_tokens=12,
            node_run_steps=3,
        )
        runtime_state.graph_execution.exceptions_count = 2

        layer.persist_pause(_paused_event())

        assert log.calls == ["pause_workflow_run", "execution.save"]
        assert pause_repo.calls_kwargs is not None
        assert pause_repo.calls_kwargs["workflow_run_id"] == _RUN_ID
        assert pause_repo.calls_kwargs["state_owner_user_id"] == "owner"
        assert pause_repo.calls_kwargs["total_tokens"] == 12
        assert pause_repo.calls_kwargs["total_steps"] == 3
        assert pause_repo.calls_kwargs["exceptions_count"] == 2
        assert pause_repo.calls_kwargs["outputs"] == {"answer": "paused"}
        context = WorkflowResumptionContext.loads(pause_repo.calls_kwargs["state"])
        assert context.serialized_graph_runtime_state
        entity = execution_repo.saved[0]
        assert entity.status == WorkflowExecutionStatus.PAUSED

    def test_pause_failure_propagates_without_mirroring(self, monkeypatch):
        log = _CallLog()
        pause_repo = _PauseRepo(log, fail=True)
        layer, execution_repo, _ = _make_layer(log, pause_repo=pause_repo, monkeypatch=monkeypatch)

        with pytest.raises(RuntimeError, match="db commit failed"):
            layer.persist_pause(_paused_event())

        assert log.calls == ["pause_workflow_run"]
        assert execution_repo.saved == []

    def test_mirror_failure_after_commit_does_not_fail_pause(self, monkeypatch):
        log = _CallLog()
        pause_repo = _PauseRepo(log)
        layer, execution_repo, _ = _make_layer(log, pause_repo=pause_repo, monkeypatch=monkeypatch)
        execution_repo.fail = True

        layer.persist_pause(_paused_event())

        assert log.calls == ["pause_workflow_run", "execution.save"]
        assert pause_repo.calls_kwargs is not None

    def test_fail_after_pause_persistence_error_converges_to_failed(self, monkeypatch):
        log = _CallLog()
        layer, execution_repo, _ = _make_layer(log, pause_repo=_PauseRepo(log), monkeypatch=monkeypatch)

        layer.fail_after_pause_persistence_error("boom")

        entity = execution_repo.saved[0]
        assert entity.status == WorkflowExecutionStatus.FAILED
        assert entity.error_message == "boom"


class TestNoOwnerFallback:
    def test_on_event_keeps_legacy_pause_save_without_config(self):
        log = _CallLog()
        layer, execution_repo, _ = _make_layer(log, with_owner=False)

        layer.on_event(_paused_event())

        assert execution_repo.saved
        assert execution_repo.saved[0].status == WorkflowExecutionStatus.PAUSED


class TestRunnerGating:
    def _make_runner(self, layer):
        published = []

        class _QueueManager:
            def publish(self, event, _source):
                published.append(event)

        runner = WorkflowBasedAppRunner(queue_manager=_QueueManager(), app_id="app")
        runner._workflow_persistence_layer = layer
        return runner, published

    @staticmethod
    def _workflow_entry(runtime_state):
        return SimpleNamespace(graph_engine=SimpleNamespace(graph_runtime_state=runtime_state))

    def test_paused_outcome_published_only_after_commit(self, monkeypatch):
        log = _CallLog()
        pause_repo = _PauseRepo(log)
        layer, _, runtime_state = _make_layer(log, pause_repo=pause_repo, monkeypatch=monkeypatch)
        runner, published = self._make_runner(layer)

        runner._handle_event(self._workflow_entry(runtime_state), _paused_event())

        assert [type(e) for e in published] == [QueueWorkflowPausedEvent]
        assert log.calls == ["pause_workflow_run", "execution.save"]

    def test_failed_pause_converges_to_failed_outcome(self, monkeypatch):
        log = _CallLog()
        pause_repo = _PauseRepo(log, fail=True)
        layer, _, runtime_state = _make_layer(log, pause_repo=pause_repo, monkeypatch=monkeypatch)
        runner, published = self._make_runner(layer)

        runner._handle_event(self._workflow_entry(runtime_state), _paused_event())

        assert [type(e) for e in published] == [QueueWorkflowFailedEvent]
        assert "db commit failed" in published[0].error

    def test_runner_without_owner_keeps_legacy_publish(self):
        log = _CallLog()
        _, _, runtime_state = _make_layer(log, with_owner=False)
        runner, published = self._make_runner(None)

        runner._handle_event(self._workflow_entry(runtime_state), _paused_event())

        assert [type(e) for e in published] == [QueueWorkflowPausedEvent]
