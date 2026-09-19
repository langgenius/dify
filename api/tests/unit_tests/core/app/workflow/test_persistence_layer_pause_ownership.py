"""Regression tests for the pause transaction ownership contract (#41560).

A workflow run must become observably ``PAUSED`` only when its pause record,
reasons, and readable resumption snapshot are committed together, and the
paused outcome must be published only after that transaction succeeds.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock

import pytest

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import QueueWorkflowFailedEvent, QueueWorkflowPausedEvent
from core.app.entities.workflow_pause_state import PauseStateConfig, WorkflowResumptionContext
from core.app.workflow.layers.persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from core.repositories.factory import WorkflowExecutionRepository, WorkflowNodeExecutionRepository
from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.nodes.human_input.entities import FormDefinition
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired, PauseReason
from core.workflow.system_variables import build_system_variables
from core.workflow.workflow_entry import WorkflowEntry
from graphon.entities import WorkflowExecution
from graphon.entities.pause_reason import HitlRequired, SchedulingPause
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
    """Stand-in for the observational execution repository (logstore/celery mirror)."""

    def __init__(self, log: _CallLog, *, fail: bool = False) -> None:
        self.log = log
        self.fail = fail
        self.saved: list[WorkflowExecution] = []

    def save(self, execution: WorkflowExecution) -> None:
        self.log.calls.append("execution.save")
        if self.fail:
            raise RuntimeError("mirror storage backend down")
        self.saved.append(execution)


@dataclass
class _PauseCall:
    workflow_run_id: str
    state_owner_user_id: str
    state: str
    pause_reasons: Sequence[PauseReason]
    outputs: Mapping[str, object] | None
    total_tokens: int
    total_steps: int
    exceptions_count: int


class _PauseRepo:
    """Stand-in for the authoritative workflow run repository."""

    def __init__(self, log: _CallLog, *, fail: bool = False) -> None:
        self.log = log
        self.fail = fail
        self.call: _PauseCall | None = None

    def pause_workflow_run(
        self,
        workflow_run_id: str,
        state_owner_user_id: str,
        state: str,
        pause_reasons: Sequence[PauseReason],
        *,
        outputs: Mapping[str, object] | None,
        total_tokens: int,
        total_steps: int,
        exceptions_count: int,
    ) -> None:
        self.log.calls.append("pause_workflow_run")
        if self.fail:
            raise RuntimeError("db commit failed")
        self.call = _PauseCall(
            workflow_run_id=workflow_run_id,
            state_owner_user_id=state_owner_user_id,
            state=state,
            pause_reasons=pause_reasons,
            outputs=outputs,
            total_tokens=total_tokens,
            total_steps=total_steps,
            exceptions_count=exceptions_count,
        )


def _make_layer(
    log: _CallLog,
    *,
    pause_repo: _PauseRepo | None = None,
    with_owner: bool = True,
    monkeypatch: pytest.MonkeyPatch | None = None,
    total_tokens: int = 0,
    node_run_steps: int = 0,
) -> tuple[WorkflowPersistenceLayer, _ExecutionRepo, GraphRuntimeState]:
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

    pause_state_config: PauseStateConfig | None = None
    response_stream_filter: ResponseStreamFilter | None = None
    if with_owner:
        pause_state_config = PauseStateConfig(session_factory=Mock(), state_owner_user_id="owner")
        response_stream_filter = _initialized_response_stream_filter()
        if monkeypatch is not None and pause_repo is not None:
            captured = pause_repo

            def _factory(_session: object) -> _PauseRepo:
                return captured

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
        workflow_execution_repository=cast(WorkflowExecutionRepository, execution_repo),
        workflow_node_execution_repository=cast(WorkflowNodeExecutionRepository, Mock()),
        pause_state_config=pause_state_config,
        response_stream_filter=response_stream_filter,
    )
    layer.initialize(ReadOnlyGraphRuntimeStateWrapper(runtime_state), Mock())
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


def _hitl_event() -> GraphRunPausedEvent:
    return GraphRunPausedEvent(
        reasons=[HitlRequired(session_id="form-123", node_id="node-1", node_title="Ask for approval")],
        outputs={},
    )


_HITL_FORM_RECORD = SimpleNamespace(
    form_id="form-123",
    node_id="node-1",
    rendered_content="Please approve",
    definition=FormDefinition(
        form_content="Please approve",
        rendered_content="Please approve",
        expiration_time=datetime(2026, 1, 1, tzinfo=UTC),
        node_title="Ask for approval",
    ),
)


def _stub_form_repository(monkeypatch: pytest.MonkeyPatch, *, record: object | None) -> Mock:
    """Route the layer's form lookups to `record` and return the stub repository."""
    form_repository = Mock(spec=HumanInputFormSubmissionRepository)
    form_repository.get_by_form_id.return_value = record
    monkeypatch.setattr(
        "core.app.workflow.layers.persistence.HumanInputFormSubmissionRepository",
        Mock(return_value=form_repository),
    )
    return form_repository


class TestOwnerPath:
    def test_on_event_does_not_commit_pause_when_layer_owns_it(self, monkeypatch: pytest.MonkeyPatch) -> None:
        log = _CallLog()
        pause_repo = _PauseRepo(log)
        layer, execution_repo, _ = _make_layer(log, pause_repo=pause_repo, monkeypatch=monkeypatch)

        layer.on_event(_paused_event())

        assert "pause_workflow_run" not in log.calls
        assert execution_repo.saved == []

    def test_persist_pause_commits_pause_before_mirroring(self, monkeypatch: pytest.MonkeyPatch) -> None:
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
        assert pause_repo.call is not None
        assert pause_repo.call.workflow_run_id == _RUN_ID
        assert pause_repo.call.state_owner_user_id == "owner"
        assert pause_repo.call.total_tokens == 12
        assert pause_repo.call.total_steps == 3
        assert pause_repo.call.exceptions_count == 2
        assert pause_repo.call.outputs == {"answer": "paused"}
        context = WorkflowResumptionContext.loads(pause_repo.call.state)
        assert context.serialized_graph_runtime_state
        assert execution_repo.saved[0].status == WorkflowExecutionStatus.PAUSED

    def test_persist_pause_commits_enriched_hitl_reasons(self, monkeypatch: pytest.MonkeyPatch) -> None:
        log = _CallLog()
        pause_repo = _PauseRepo(log)
        layer, _, _ = _make_layer(log, pause_repo=pause_repo, monkeypatch=monkeypatch)
        form_repository = _stub_form_repository(monkeypatch, record=_HITL_FORM_RECORD)

        layer.persist_pause(_hitl_event())

        form_repository.get_by_form_id.assert_called_once_with("form-123")
        assert pause_repo.call is not None
        assert pause_repo.call.pause_reasons == [
            HumanInputRequired(
                form_id="form-123",
                form_content="Please approve",
                node_id="node-1",
                node_title="Ask for approval",
            )
        ]

    def test_unresolvable_hitl_reason_aborts_the_pause_transaction(self, monkeypatch: pytest.MonkeyPatch) -> None:
        log = _CallLog()
        pause_repo = _PauseRepo(log)
        layer, execution_repo, _ = _make_layer(log, pause_repo=pause_repo, monkeypatch=monkeypatch)
        _stub_form_repository(monkeypatch, record=None)

        with pytest.raises(LookupError, match="form-123"):
            layer.persist_pause(_hitl_event())

        assert log.calls == []
        assert pause_repo.call is None
        assert execution_repo.saved == []

    def test_pause_failure_propagates_without_mirroring(self, monkeypatch: pytest.MonkeyPatch) -> None:
        log = _CallLog()
        pause_repo = _PauseRepo(log, fail=True)
        layer, execution_repo, _ = _make_layer(log, pause_repo=pause_repo, monkeypatch=monkeypatch)

        with pytest.raises(RuntimeError, match="db commit failed"):
            layer.persist_pause(_paused_event())

        assert log.calls == ["pause_workflow_run"]
        assert execution_repo.saved == []

    def test_mirror_failure_after_commit_does_not_fail_pause(self, monkeypatch: pytest.MonkeyPatch) -> None:
        log = _CallLog()
        pause_repo = _PauseRepo(log)
        layer, execution_repo, _ = _make_layer(log, pause_repo=pause_repo, monkeypatch=monkeypatch)
        execution_repo.fail = True

        layer.persist_pause(_paused_event())

        assert log.calls == ["pause_workflow_run", "execution.save"]
        assert pause_repo.call is not None

    def test_fail_after_pause_persistence_error_converges_to_failed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        log = _CallLog()
        layer, execution_repo, _ = _make_layer(log, pause_repo=_PauseRepo(log), monkeypatch=monkeypatch)

        layer.fail_after_pause_persistence_error("boom")

        assert execution_repo.saved[0].status == WorkflowExecutionStatus.FAILED
        assert execution_repo.saved[0].error_message == "boom"


class TestNoOwnerFallback:
    def test_on_event_keeps_legacy_pause_save_without_config(self) -> None:
        log = _CallLog()
        layer, execution_repo, _ = _make_layer(log, with_owner=False)

        layer.on_event(_paused_event())

        assert execution_repo.saved
        assert execution_repo.saved[0].status == WorkflowExecutionStatus.PAUSED


class _QueueManager:
    def __init__(self, published: list[object]) -> None:
        self.published = published

    def publish(self, event: object, _pub_from: object) -> None:
        self.published.append(event)


class TestRunnerGating:
    @staticmethod
    def _make_runner(layer: WorkflowPersistenceLayer | None) -> tuple[WorkflowBasedAppRunner, list[object]]:
        published: list[object] = []
        runner = WorkflowBasedAppRunner(queue_manager=cast(AppQueueManager, _QueueManager(published)), app_id="app")
        runner._workflow_persistence_layer = layer
        return runner, published

    @staticmethod
    def _workflow_entry(runtime_state: GraphRuntimeState) -> WorkflowEntry:
        return cast(
            WorkflowEntry,
            SimpleNamespace(graph_engine=SimpleNamespace(graph_runtime_state=runtime_state)),
        )

    def test_paused_outcome_published_only_after_commit(self, monkeypatch: pytest.MonkeyPatch) -> None:
        log = _CallLog()
        pause_repo = _PauseRepo(log)
        layer, _, runtime_state = _make_layer(log, pause_repo=pause_repo, monkeypatch=monkeypatch)
        runner, published = self._make_runner(layer)

        runner._handle_event(self._workflow_entry(runtime_state), _paused_event())

        assert [type(event) for event in published] == [QueueWorkflowPausedEvent]
        assert log.calls == ["pause_workflow_run", "execution.save"]

    def test_failed_pause_converges_to_failed_outcome(self, monkeypatch: pytest.MonkeyPatch) -> None:
        log = _CallLog()
        pause_repo = _PauseRepo(log, fail=True)
        layer, _, runtime_state = _make_layer(log, pause_repo=pause_repo, monkeypatch=monkeypatch)
        runner, published = self._make_runner(layer)

        runner._handle_event(self._workflow_entry(runtime_state), _paused_event())

        assert [type(event) for event in published] == [QueueWorkflowFailedEvent]
        failure = cast(QueueWorkflowFailedEvent, published[0])
        assert "db commit failed" in failure.error

    def test_runner_without_owner_keeps_legacy_publish(self) -> None:
        log = _CallLog()
        _, _, runtime_state = _make_layer(log, with_owner=False)
        runner, published = self._make_runner(None)

        runner._handle_event(self._workflow_entry(runtime_state), _paused_event())

        assert [type(event) for event in published] == [QueueWorkflowPausedEvent]
