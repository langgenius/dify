from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from queue import Queue
from threading import Event, Lock
from types import SimpleNamespace

import pytest
from sqlalchemy import event as sqlalchemy_event
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, WorkflowAppGenerateEntity
from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY
from core.ops.ops_trace_manager import TraceTask, TraceTaskName
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.tools.workflow_as_tool.repository import WorkflowToolSource
from core.workflow.node_execution_process_data import (
    WORKFLOW_TOOL_INVOCATION_ID_KEY,
    WORKFLOW_TOOL_ROOT_APP_ID_KEY,
)
from core.workflow.system_variables import SystemVariableKey, build_system_variables
from enums import WorkflowKind
from graphon.engine.event.node_failure import NodeFailureHandler
from graphon.engine.event.processor import NodeEventProcessor
from graphon.engine.event.stream import EventStream
from graphon.engine.frame import ExecutionFrame, FrameRegistry
from graphon.engine.scheduler import Scheduler
from graphon.engine.worker import NodeEventTask
from graphon.engine.worker.worker import Worker
from graphon.engine_events import (
    EngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunPauseRequestedEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.entities import WorkflowNodeExecution, WorkflowStartReason
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import (
    BuiltinNodeTypes,
    WorkflowExecutionStatus,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
    WorkflowType,
)
from graphon.graph import Graph
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import ReadOnlyRuntimeStateWrapper, RuntimeState, VariablePool
from graphon.runtime.execution import ROOT_FRAME_ID
from models import Account, WorkflowRun
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)
from services.workflow_persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from services.workflow_run_index import WorkflowRunIndex
from tests.workflow_test_utils import build_test_graph_init_params, build_test_run_context


class _RepoRecorder:
    def __init__(self) -> None:
        self.saved: list[object] = []
        self.synchronously_saved: list[object] = []
        self.saved_exec_data: list[object] = []

    def save(self, entity):
        self.saved.append(entity)

    def save_many(self, entities):
        self.saved.extend(entities)

    def save_synchronously(self, entity):
        self.synchronously_saved.append(entity)

    def save_execution_data(self, entity):
        self.saved_exec_data.append(entity)


def _naive_utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _make_layer(
    system_variables: list | None = None,
    *,
    extras: dict | None = None,
    graph_data: dict | None = None,
    trace_manager: object | None = None,
    workflow_execution_repo=None,
    workflow_node_execution_repo=None,
    node_run_indices=None,
):
    system_variables = system_variables or build_system_variables(
        workflow_execution_id="run-id",
        conversation_id="conv-id",
    )
    runtime_state = RuntimeState(
        workflow_id="test-workflow",
        variable_pool=VariablePool.from_bootstrap(system_variables=system_variables),
        start_at=0.0,
    )
    read_only_state = ReadOnlyRuntimeStateWrapper(runtime_state)

    application_generate_entity = WorkflowAppGenerateEntity.model_construct(
        task_id="task",
        app_config=SimpleNamespace(app_id="app", tenant_id="tenant"),
        inputs={"foo": "bar"},
        files=[],
        user_id="user",
        stream=False,
        invoke_from=None,
        trace_manager=None,
        workflow_execution_id="run-id",
        extras=extras or {},
        call_depth=0,
    )

    workflow_info = PersistenceWorkflowInfo(
        workflow_id="workflow-id",
        workflow_type=WorkflowType.WORKFLOW,
        version="1",
        graph_data=graph_data if graph_data is not None else {"nodes": [], "edges": []},
    )

    workflow_execution_repo = workflow_execution_repo if workflow_execution_repo is not None else _RepoRecorder()
    workflow_node_execution_repo = (
        workflow_node_execution_repo if workflow_node_execution_repo is not None else _RepoRecorder()
    )

    layer = WorkflowPersistenceLayer(
        application_generate_entity=application_generate_entity,
        workflow_info=workflow_info,
        workflow_execution_repository=workflow_execution_repo,
        workflow_node_execution_repository=workflow_node_execution_repo,
        trace_manager=trace_manager,
    )
    layer.initialize(read_only_state, command_channel=None)
    layer.set_node_run_indices(node_run_indices or {})

    return layer, workflow_execution_repo, workflow_node_execution_repo, runtime_state


def _make_sql_layer(session_factory, *, node_run_indices=None):
    user = Account(name="Test", email="test@example.com")
    user.id = "user"
    layer, _, _, _ = _make_layer(
        node_run_indices=node_run_indices,
        workflow_execution_repo=SQLAlchemyWorkflowExecutionRepository(
            session_factory=session_factory,
            tenant_id="tenant",
            user=user,
            app_id="caller-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        ),
        workflow_node_execution_repo=SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=session_factory,
            tenant_id="tenant",
            user=user,
            app_id="caller-app",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        ),
    )
    layer._application_generate_entity.app_config.app_id = "caller-app"
    return layer


def test_tool_trace_identity_survives_start_pause_and_resume():
    layer, _, node_repo, _ = _make_layer(node_run_indices={"tool-exec": 1})
    layer.on_event(GraphRunStartedEvent())
    started_at = _naive_utc_now()
    layer.on_event(
        NodeRunStartedEvent(
            id="tool-exec",
            node_id="tool",
            node_type=BuiltinNodeTypes.TOOL,
            node_title="Nested tool",
            provider_type="workflow",
            provider_id="provider",
            start_at=started_at,
            node_run_result=NodeRunResult(process_data={WORKFLOW_TOOL_INVOCATION_ID_KEY: "invocation"}),
        )
    )
    for event in (
        NodeRunPauseRequestedEvent(
            id="tool-exec", node_id="tool", node_type=BuiltinNodeTypes.TOOL, reason=SchedulingPause(message="pause")
        ),
        NodeRunSucceededEvent(id="tool-exec", node_id="tool", node_type=BuiltinNodeTypes.TOOL, start_at=started_at),
    ):
        layer.on_event(event)
        execution = node_repo.saved_exec_data[-1]
        assert execution.process_data[WORKFLOW_TOOL_INVOCATION_ID_KEY] == "invocation"
        assert execution.metadata[WorkflowNodeExecutionMetadataKey.TOOL_INFO] == {
            "provider_type": "workflow",
            "provider_id": "provider",
        }


def _tool_source():
    return WorkflowToolSource(
        app_id="source-app",
        workflow_id="source-workflow",
        graph_config={"nodes": [{"id": "source-loop", "data": {"type": "loop"}}], "edges": []},
        features_dict={},
        environment_variables=[],
        workflow_kind=WorkflowKind.STANDARD,
    )


def test_workflow_tool_agent_nodes_persist_in_source_app_under_only_root_run(sqlite_session_factory):
    layer = _make_sql_layer(sqlite_session_factory, node_run_indices={"caller-exec": 1, "source-agent-exec": 1})
    listen = layer.create_workflow_tool_event_listener(_tool_source(), "workflow-id", "caller-exec")
    layer.on_graph_start()
    layer.on_event(GraphRunStartedEvent())
    started_at = _naive_utc_now()
    layer.on_event(
        NodeRunStartedEvent(
            id="caller-exec",
            node_id="caller",
            node_type=BuiltinNodeTypes.TOOL,
            node_title="Workflow Tool",
            start_at=started_at,
        )
    )
    listen(
        NodeRunStartedEvent(
            id="source-agent-exec",
            node_id="agent",
            node_type=BuiltinNodeTypes.AGENT,
            node_version="2",
            node_title="Agent",
            start_at=started_at,
            container_id="source-loop",
            node_run_result=NodeRunResult(
                process_data={WORKFLOW_TOOL_ROOT_APP_ID_KEY: "untrusted-app"}, metadata={"loop_id": "source-loop"}
            ),
        )
    )

    with sqlite_session_factory() as session:
        rows = {row.id: row for row in session.scalars(select(WorkflowNodeExecutionModel))}
        assert rows["caller-exec"].app_id == "caller-app"
        source_row = rows["source-agent-exec"]
        assert (source_row.tenant_id, source_row.app_id, source_row.workflow_id, source_row.workflow_run_id) == (
            "tenant",
            "source-app",
            "source-workflow",
            "run-id",
        )
        assert source_row.status == "running"
        assert source_row.process_data_dict[WORKFLOW_TOOL_ROOT_APP_ID_KEY] == "caller-app"
        assert source_row.execution_metadata_dict["loop_id"] == "source-loop"
        assert session.scalars(select(WorkflowRun)).one().workflow_id == "workflow-id"

    listen(
        NodeRunSucceededEvent(
            id="source-agent-exec",
            node_id="agent",
            node_type=BuiltinNodeTypes.AGENT,
            node_title="Agent",
            start_at=started_at,
            node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, outputs={"answer": "ok"}),
        )
    )
    layer.on_event(GraphRunSucceededEvent(outputs={"result": "caller-result"}))

    with sqlite_session_factory() as session:
        run = session.scalars(select(WorkflowRun)).one()
        assert (run.app_id, run.workflow_id, run.status, run.outputs_dict) == (
            "caller-app",
            "workflow-id",
            "succeeded",
            {"result": "caller-result"},
        )
        row = session.get(WorkflowNodeExecutionModel, "source-agent-exec")
        assert row.status == "succeeded"
        assert row.outputs_dict == {"answer": "ok"}
        assert row.process_data_dict[WORKFLOW_TOOL_ROOT_APP_ID_KEY] == "caller-app"


def test_nested_tool_callers_keep_distinct_invocations_in_shared_source_layers(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    ids = ["a-call-1", "a-call-2", "b-call-1", "b-call-2", "c-child"]
    layer = _make_sql_layer(sqlite_session_factory, node_run_indices=dict.fromkeys(ids, 1))
    source = _tool_source()
    nested = replace(source, app_id="nested-app", workflow_id="nested-workflow")
    first_call = layer.create_workflow_tool_event_listener(source, "workflow-id", "a-call-1")
    second_call = layer.create_workflow_tool_event_listener(source, "workflow-id", "a-call-2")
    nested_call = layer.create_workflow_tool_event_listener(nested, source.workflow_id, "b-call-1")
    layer.on_event(GraphRunStartedEvent())
    for execution_id, listener in zip(
        ids, [layer.on_event, layer.on_event, first_call, second_call, nested_call], strict=True
    ):
        listener(
            NodeRunStartedEvent(
                id=execution_id,
                node_id="same-canvas-node",
                node_type=BuiltinNodeTypes.TOOL,
                node_title="Tool",
                start_at=_naive_utc_now(),
            )
        )
    repository = DifyAPISQLAlchemyWorkflowNodeExecutionRepository(sqlite_session_factory)
    for caller, expected, source_app, source_workflow in (
        ("a-call-1", "b-call-1", "source-app", "source-workflow"),
        ("a-call-2", "b-call-2", "source-app", "source-workflow"),
        ("b-call-1", "c-child", "nested-app", "nested-workflow"),
    ):
        children = repository.get_workflow_tool_executions("tenant", "run-id", caller)
        assert [child.id for child in children] == [expected]
        child = children[0]
        assert (child.app_id, child.workflow_id, child.workflow_run_id) == (source_app, source_workflow, "run-id")
        assert child.triggered_from_workflow_id == ("source-workflow" if caller == "b-call-1" else "workflow-id")
        assert child.triggered_from_node_execution_id == caller


def test_workflow_tool_resume_updates_existing_running_container(sqlite_session_factory):
    layer = _make_sql_layer(sqlite_session_factory, node_run_indices={"loop-exec": 1})
    listen = layer.create_workflow_tool_event_listener(_tool_source(), "workflow-id", "caller-exec")
    layer.on_event(GraphRunStartedEvent())
    started_at = _naive_utc_now()
    listen(
        NodeRunStartedEvent(
            id="loop-exec",
            node_id="source-loop",
            node_type=BuiltinNodeTypes.LOOP,
            node_title="Approval Loop",
            start_at=started_at,
        )
    )
    layer.on_event(GraphRunPausedEvent(outputs={}, reasons=[]))

    resumed = _make_sql_layer(sqlite_session_factory, node_run_indices={"loop-exec": 1})
    resume_listener = resumed.create_workflow_tool_event_listener(
        _tool_source(),
        "workflow-id",
        "caller-exec",
        node_executions=resumed._workflow_node_execution_repository.for_workflow_tool(
            "source-app"
        ).get_by_workflow_execution("run-id"),
    )
    resumed.on_graph_start()
    resumed.on_event(GraphRunStartedEvent(reason=WorkflowStartReason.RESUMPTION))
    resume_listener(
        NodeRunSucceededEvent(
            id="loop-exec",
            node_id="source-loop",
            node_type=BuiltinNodeTypes.LOOP,
            node_title="Approval Loop",
            start_at=started_at,
            node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, outputs={"approved": True}),
        )
    )
    resumed.on_event(GraphRunSucceededEvent(outputs={"answer": "approved"}))

    with sqlite_session_factory() as session:
        node = session.scalars(select(WorkflowNodeExecutionModel)).one()
        assert (node.app_id, node.workflow_id, node.workflow_run_id, node.status) == (
            "source-app",
            "source-workflow",
            "run-id",
            "succeeded",
        )
        assert node.outputs_dict == {"approved": True}
        run = session.scalars(select(WorkflowRun)).one()
        assert (run.app_id, run.workflow_id, run.status) == ("caller-app", "workflow-id", "succeeded")


@pytest.mark.parametrize("source_workflow_id", ["older-workflow", "workflow-id"])
def test_root_resume_isolates_same_app_workflow_tool_origin(sqlite_session_factory, source_workflow_id):
    source = replace(_tool_source(), app_id="caller-app", workflow_id=source_workflow_id)
    layer = _make_sql_layer(sqlite_session_factory, node_run_indices={"caller-exec": 1, "older-exec": 1})
    listen = layer.create_workflow_tool_event_listener(source, "workflow-id", "caller-exec")
    layer.on_event(GraphRunStartedEvent())
    started_at = _naive_utc_now()
    layer.on_event(
        NodeRunStartedEvent(
            id="caller-exec",
            node_id="caller",
            node_type=BuiltinNodeTypes.TOOL,
            node_title="Caller",
            start_at=started_at,
        )
    )
    listen(
        NodeRunStartedEvent(
            id="older-exec",
            node_id="older-node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="Older version",
            start_at=started_at,
        )
    )
    layer.on_event(GraphRunPausedEvent())

    resumed = _make_sql_layer(sqlite_session_factory, node_run_indices={"caller-exec": 1, "older-exec": 1})
    resumed.set_node_execution_history(resumed._workflow_node_execution_repository.get_by_workflow_execution("run-id"))
    resume_listener = resumed.create_workflow_tool_event_listener(
        source,
        "workflow-id",
        "caller-exec",
        node_executions=resumed._workflow_node_execution_repository.for_workflow_tool(
            source.app_id
        ).get_by_workflow_execution("run-id"),
    )
    resumed.on_event(GraphRunStartedEvent(reason=WorkflowStartReason.RESUMPTION))
    resume_listener(
        NodeRunSucceededEvent(
            id="older-exec",
            node_id="older-node",
            node_type=BuiltinNodeTypes.LLM,
            start_at=started_at,
            node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED),
        )
    )
    resumed.on_event(GraphRunFailedEvent(error="caller failed later"))

    with sqlite_session_factory() as session:
        rows = {row.id: row for row in session.scalars(select(WorkflowNodeExecutionModel))}
        assert rows["caller-exec"].status == "failed"
        assert rows["older-exec"].status == "succeeded"
        assert rows["older-exec"].workflow_id == source_workflow_id


@pytest.mark.parametrize("source", [False, True])
@pytest.mark.parametrize("outcome", ["succeeded", "failed", "aborted", "paused"])
def test_retry_starts_preserve_original_execution_and_attempt_history(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    source: bool,
    outcome: str,
) -> None:
    layer = _make_sql_layer(sqlite_session_factory, node_run_indices={"retry-exec": 1})
    listen = (
        layer.create_workflow_tool_event_listener(_tool_source(), "workflow-id", "caller-exec")
        if source
        else layer.on_event
    )
    layer.on_event(GraphRunStartedEvent())
    workflow_id = "source-workflow" if source else "workflow-id"
    state = RuntimeState(workflow_id=workflow_id, variable_pool=VariablePool(), start_at=0)
    frames = FrameRegistry()
    node = StartNode(
        node_id="child",
        data=StartNodeData(title="Child", variables=[]),
        init_params=build_test_graph_init_params(workflow_id=workflow_id),
        runtime_state=state,
    )
    graph = Graph.new().add_root(node).build()
    frames.register(
        ExecutionFrame(
            frame_id=ROOT_FRAME_ID,
            graph=graph,
            state=state,
            scheduler=Scheduler(graph, state, ROOT_FRAME_ID),
            failure_handler=NodeFailureHandler(graph, state.graph_execution),
        )
    )

    event_stream = EventStream(layers=[])
    collect = event_stream.collect

    def collect_source_event(event: EngineEvent) -> None:
        assert isinstance(event, NodeEvent)
        listen(event)
        collect(event)

    monkeypatch.setattr(event_stream, "collect", collect_source_event)
    processor = NodeEventProcessor(state.graph_execution, event_stream, frames, {})

    def dispatch(event: NodeEvent) -> None:
        processor.dispatch(NodeEventTask(frame_id=ROOT_FRAME_ID, event=event))

    started_at = _naive_utc_now()
    started = NodeRunStartedEvent(
        id="retry-exec",
        node_id="child",
        node_type=BuiltinNodeTypes.LLM,
        node_title="Child",
        start_at=started_at,
    )
    dispatch(started)
    for attempt in (1, 2):
        dispatch(
            NodeRunRetryEvent(
                id="retry-exec",
                node_id="child",
                node_type=BuiltinNodeTypes.LLM,
                node_title="Child",
                start_at=started_at,
                retry_index=attempt,
                error=f"attempt-{attempt}",
                node_run_result=NodeRunResult(outputs={"attempt": attempt}),
            )
        )
        dispatch(started)
    if outcome == "succeeded":
        dispatch(
            NodeRunSucceededEvent(
                id="retry-exec",
                node_id="child",
                node_type=BuiltinNodeTypes.LLM,
                start_at=started_at,
                node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, outputs={"ok": True}),
            )
        )
    elif outcome == "failed":
        layer.on_event(GraphRunFailedEvent(error="terminal failure"))
    elif outcome == "aborted":
        layer.on_event(GraphRunAbortedEvent(reason="terminal failure"))
    else:
        commits = []

        def record_commit(_session: Session) -> None:
            commits.append(True)

        sqlalchemy_event.listen(Session, "after_commit", record_commit)
        try:
            layer.persist_unfinished_nodes_synchronously()
        finally:
            sqlalchemy_event.remove(Session, "after_commit", record_commit)
        assert len(commits) == 1

    with sqlite_session_factory() as session:
        row = session.scalars(select(WorkflowNodeExecutionModel)).one()
        assert row.index == 1
        assert row.created_at == started_at
        assert row.workflow_id == workflow_id
        assert row.app_id == ("source-app" if source else "caller-app")
        if outcome == "succeeded":
            assert row.status == "succeeded"
            assert row.outputs_dict == {"ok": True}
        elif outcome == "paused":
            assert row.status == "retry"
            assert row.finished_at is None
        else:
            assert row.status == "failed"
            assert row.error == "terminal failure"
            assert row.finished_at is not None
        history = row.process_data_dict[RETRY_HISTORY_PROCESS_DATA_KEY]
        assert [(attempt["retry_index"], attempt["error"]) for attempt in history] == [
            (1, "attempt-1"),
            (2, "attempt-2"),
        ]


@pytest.mark.parametrize(
    "event", [GraphRunFailedEvent(error="failed", exceptions_count=1), GraphRunAbortedEvent(reason="aborted")]
)
def test_root_terminal_failure_finishes_running_workflow_tool_nodes(sqlite_session_factory, event):
    layer = _make_sql_layer(sqlite_session_factory, node_run_indices={"source-exec": 1})
    listen = layer.create_workflow_tool_event_listener(_tool_source(), "workflow-id", "caller-exec")
    layer.on_event(GraphRunStartedEvent())
    listen(
        NodeRunStartedEvent(
            id="source-exec",
            node_id="child",
            node_type=BuiltinNodeTypes.LLM,
            node_title="Child",
            start_at=_naive_utc_now(),
        )
    )

    layer.on_event(event)

    with sqlite_session_factory() as session:
        node = session.scalars(select(WorkflowNodeExecutionModel)).one()
        assert node.status == "failed"
        assert node.error == (event.error if isinstance(event, GraphRunFailedEvent) else event.reason)
        assert node.finished_at is not None
        assert session.scalars(select(WorkflowRun)).one().workflow_id == "workflow-id"


def test_terminal_failure_batches_only_unfinished_nodes_per_source(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    ids = (
        "root-a",
        "root-b",
        "root-retry",
        "root-paused",
        "source-a",
        "source-b",
        "source-retry",
        "source-paused",
        "source-done",
    )
    layer = _make_sql_layer(sqlite_session_factory, node_run_indices=dict.fromkeys(ids, 1))
    listen = layer.create_workflow_tool_event_listener(_tool_source(), "workflow-id", "root-a")
    layer.on_event(GraphRunStartedEvent())
    started_at = _naive_utc_now()
    for execution_id in ids:
        listener = listen if execution_id.startswith("source") else layer.on_event
        listener(
            NodeRunStartedEvent(
                id=execution_id,
                node_id=execution_id,
                node_type=BuiltinNodeTypes.CODE,
                node_title="Code",
                start_at=started_at,
            )
        )
        if execution_id.endswith("paused"):
            listener(
                NodeRunPauseRequestedEvent(
                    id=execution_id,
                    node_id=execution_id,
                    node_type=BuiltinNodeTypes.CODE,
                    reason=SchedulingPause(message="pause"),
                )
            )
        elif execution_id.endswith("retry"):
            listener(
                NodeRunRetryEvent(
                    id=execution_id,
                    node_id=execution_id,
                    node_type=BuiltinNodeTypes.CODE,
                    node_title="Code",
                    start_at=started_at,
                    retry_index=1,
                    error="retry failed",
                )
            )
    listen(
        NodeRunSucceededEvent(
            id="source-done",
            node_id="source-done",
            node_type=BuiltinNodeTypes.CODE,
            start_at=started_at,
            node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, outputs={"answer": "kept"}),
        )
    )
    commits = []

    def record_commit(_session: Session) -> None:
        commits.append(True)

    sqlalchemy_event.listen(Session, "after_commit", record_commit)
    try:
        layer.on_event(GraphRunFailedEvent(error="terminal failure", exceptions_count=0))
    finally:
        sqlalchemy_event.remove(Session, "after_commit", record_commit)

    with sqlite_session_factory() as session:
        rows = {row.id: row for row in session.scalars(select(WorkflowNodeExecutionModel))}
        assert {key: row.status for key, row in rows.items()} == {
            "root-a": "failed",
            "root-b": "failed",
            "root-retry": "failed",
            "root-paused": "paused",
            "source-a": "failed",
            "source-b": "failed",
            "source-retry": "failed",
            "source-paused": "paused",
            "source-done": "succeeded",
        }
        assert rows["source-done"].outputs_dict == {"answer": "kept"}
        for execution_id in ("root-a", "root-b", "root-retry", "source-a", "source-b", "source-retry"):
            assert rows[execution_id].error == "terminal failure"
            assert rows[execution_id].finished_at is not None
        for execution_id in ("root-retry", "source-retry"):
            assert rows[execution_id].process_data_dict[RETRY_HISTORY_PROCESS_DATA_KEY][0]["error"] == "retry failed"
        assert rows["source-a"].triggered_from_node_execution_id == "root-a"
        assert rows["source-a"].app_id == "source-app"
    # One commit per source owner, plus the workflow summary.
    assert len(commits) == 3


@pytest.mark.parametrize("dispatch_immediately", [False, True])
@pytest.mark.parametrize("fail_commit", [False, True])
def test_worker_commits_caller_before_agent_body(dispatch_immediately, fail_commit):
    """Exercise Graphon's real worker with both dispatcher schedules and hook failure."""
    layer, _, repo, state = _make_layer()
    index = WorkflowRunIndex(())
    layer.set_node_run_indices(index.indices)
    layer.on_event(GraphRunStartedEvent())
    entered = []

    class ProbeAgent(StartNode):
        node_type = BuiltinNodeTypes.AGENT
        persistence_error = None

        @classmethod
        def version(cls):
            return "2"

        def record_caller_persistence_result(self, *, error=None):
            self.persistence_error = error

        def _run(self):
            if self.persistence_error is not None:
                raise self.persistence_error
            assert [row.node_execution_id for row in repo.synchronously_saved] == [self.execution_id]
            entered.append(True)
            return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, outputs={})

    node = ProbeAgent(
        node_id="agent-node",
        data=StartNodeData(title="Agent", type=BuiltinNodeTypes.AGENT),
        init_params=build_test_graph_init_params(workflow_id="workflow-id"),
        runtime_state=state,
    )
    node.bind_execution_id("agent-exec")
    if fail_commit:

        def fail(_execution):
            raise RuntimeError("caller commit failed")

        repo.save_synchronously = fail

    class DispatchQueue(Queue):
        def put(self, task, *args, **kwargs):
            super().put(task, *args, **kwargs)
            if dispatch_immediately:
                # Like EventStream, an observer error must not stop the worker.
                EventStream([layer]).notify_layers(task.event)

    queue = DispatchQueue()
    worker = Worker(
        ready_queue=None,
        dispatch_queue=queue,
        frame_registry=None,
        layers=[index, layer],
        task_acquisition_lock=Lock(),
        task_acquisition_enabled=Event(),
    )
    worker._run_node_events(invocation_id=None, node=node, node_events=node.run())
    assert entered == ([] if fail_commit else [True])
    events = []
    while not queue.empty():
        events.append(queue.get_nowait().event)
    if fail_commit:
        assert isinstance(events[-1], NodeRunFailedEvent)
        assert "caller commit failed" in events[-1].error
    else:
        assert isinstance(events[-1], NodeRunSucceededEvent)
        if not dispatch_immediately:
            for event in events:
                layer.on_event(event)
        assert layer._node_execution_cache["agent-exec"].index == index.index_for("agent-exec")


@pytest.mark.parametrize("source_workflow_id", ["source-workflow", "workflow-id"])
@pytest.mark.parametrize("source_app_id", ["source-app", "caller-app"])
def test_worker_caller_uses_workflow_tool_source_owner(sqlite_session_factory, source_workflow_id, source_app_id):
    source = replace(_tool_source(), app_id=source_app_id, workflow_id=source_workflow_id)
    layer = _make_sql_layer(sqlite_session_factory, node_run_indices={"agent-exec": 1})
    listen = layer.create_workflow_tool_event_listener(source, "workflow-id", "caller-exec")
    layer.on_event(GraphRunStartedEvent())
    context = build_test_run_context(app_id=source_app_id)
    context[DIFY_RUN_CONTEXT_KEY].workflow_tool_invocation_id = "tool-invocation"
    results = []
    node = SimpleNamespace(
        id="agent-node",
        execution_id="agent-exec",
        node_type=BuiltinNodeTypes.AGENT,
        title="Agent",
        version=lambda: "2",
        workflow_id=source_workflow_id,
        run_context=context,
        record_caller_persistence_result=lambda *, error=None: results.append(error),
    )
    layer.on_node_run_start(node)
    # An independent session sees the committed row before any start-event delivery.
    with sqlite_session_factory() as session:
        row = session.scalars(select(WorkflowNodeExecutionModel)).one()
        assert (row.tenant_id, row.app_id, row.workflow_id, row.workflow_run_id) == (
            "tenant",
            source_app_id,
            source_workflow_id,
            "run-id",
        )
        assert row.process_data_dict[WORKFLOW_TOOL_ROOT_APP_ID_KEY] == "caller-app"
    listen(
        NodeRunStartedEvent(
            id="agent-exec",
            node_id="agent-node",
            node_type=BuiltinNodeTypes.AGENT,
            node_version="2",
            node_title="Agent",
            start_at=_naive_utc_now(),
        )
    )
    with sqlite_session_factory() as session:
        row = session.scalars(select(WorkflowNodeExecutionModel)).one()
        assert row.triggered_from_node_execution_id == "caller-exec"
    assert results == [None]
    assert "agent-exec" not in layer._node_execution_cache


def test_caller_persistence_retries_failed_commit_and_reuses_restored_identity():
    layer, _, repo, _ = _make_layer(node_run_indices={"agent-exec": 7})
    layer.on_event(GraphRunStartedEvent())
    results = []
    node = SimpleNamespace(
        id="agent-node",
        execution_id="agent-exec",
        node_type=BuiltinNodeTypes.AGENT,
        title="Agent",
        version=lambda: "2",
        run_context=build_test_run_context(),
        record_caller_persistence_result=lambda *, error=None: results.append(error),
    )
    save = repo.save_synchronously
    failure = RuntimeError("commit failed")

    def fail(_execution):
        raise failure

    repo.save_synchronously = fail
    with pytest.raises(RuntimeError, match="commit failed"):
        layer.on_node_run_start(node)
    assert "agent-exec" not in layer._node_execution_cache
    repo.save_synchronously = save
    layer.on_node_run_start(node)
    assert results == [failure, None]
    assert len(repo.synchronously_saved) == 1
    previous = repo.synchronously_saved[0]
    previous.id = "durable-row-id"
    previous.process_data = {"workflow_agent_binding_id": "binding-id"}

    resumed, _, resumed_repo, _ = _make_layer(node_run_indices={"agent-exec": 7})
    resumed.set_node_execution_history([previous])
    resumed.on_event(GraphRunStartedEvent(reason=WorkflowStartReason.RESUMPTION))
    resumed.on_node_run_start(node)
    assert resumed_repo.synchronously_saved == []
    assert resumed._node_execution_cache["agent-exec"].id == "durable-row-id"
    assert resumed._node_execution_cache["agent-exec"].process_data == previous.process_data


class TestWorkflowPersistenceLayer:
    def test_get_execution_id_requires_system_variable(self):
        layer, _, _, _ = _make_layer(build_system_variables())

        with pytest.raises(ValueError, match="workflow_execution_id must be provided"):
            layer._get_execution_id()

    def test_prepare_workflow_inputs_excludes_conversation_id(self, monkeypatch: pytest.MonkeyPatch):
        layer, _, _, _ = _make_layer()

        monkeypatch.setattr(
            "core.workflow.workflow_entry.WorkflowEntry.handle_special_values",
            lambda inputs: inputs,
        )

        inputs = layer._prepare_workflow_inputs()

        assert "sys.conversation_id" not in inputs
        assert inputs[f"sys.{SystemVariableKey.WORKFLOW_EXECUTION_ID.value}"] == "run-id"

    @pytest.mark.parametrize(
        "status",
        [
            WorkflowNodeExecutionStatus.RUNNING,
            WorkflowNodeExecutionStatus.RETRY,
            WorkflowNodeExecutionStatus.PAUSED,
            WorkflowNodeExecutionStatus.SUCCEEDED,
        ],
    )
    def test_fail_running_node_executions_marks_only_live_attempts_failed(self, status):
        layer, _, node_repo, _ = _make_layer()

        execution = WorkflowNodeExecution(
            id="exec-id",
            workflow_id="workflow-id",
            workflow_execution_id="run-id",
            index=1,
            node_id="node",
            node_type=BuiltinNodeTypes.START,
            title="Start",
            status=status,
            created_at=_naive_utc_now(),
        )
        layer._node_execution_cache[execution.id] = execution

        layer._fail_running_node_executions(error_message="boom")

        if status in (WorkflowNodeExecutionStatus.RUNNING, WorkflowNodeExecutionStatus.RETRY):
            assert execution.status == WorkflowNodeExecutionStatus.FAILED
            assert execution.error == "boom"
            assert execution.finished_at is not None
            assert node_repo.saved == [execution]
        else:
            assert execution.status == status
            assert execution.finished_at is None
            assert node_repo.saved == []

    def test_resumption_restores_container_execution_before_terminal_event(self):
        layer, _, node_repo, _ = _make_layer()
        started_at = _naive_utc_now()
        execution = WorkflowNodeExecution(
            id="loop-exec",
            workflow_id="workflow-id",
            workflow_execution_id="run-id",
            index=4,
            node_id="loop",
            node_type=BuiltinNodeTypes.LOOP,
            title="Loop",
            status=WorkflowNodeExecutionStatus.RUNNING,
            created_at=started_at,
        )
        layer.set_node_execution_history([execution])

        layer.on_event(GraphRunStartedEvent(reason=WorkflowStartReason.RESUMPTION))
        layer.on_event(
            NodeRunSucceededEvent(
                id=execution.id,
                node_id=execution.node_id,
                node_type=execution.node_type,
                start_at=started_at,
                finished_at=started_at + timedelta(seconds=2),
                node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED),
            )
        )

        assert execution.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert execution.elapsed_time == 2.0
        assert execution.index == 4

    def test_handle_graph_run_succeeded_updates_execution(self):
        layer, exec_repo, _, runtime_state = _make_layer()
        layer.on_event(GraphRunStartedEvent())
        usage = LLMUsage.empty_usage()
        usage.total_tokens = 3
        runtime_state.add_llm_usage(usage)
        for _ in range(2):
            runtime_state.increment_node_run_steps()
        runtime_state.set_output("out", "v")

        layer.on_event(GraphRunSucceededEvent(outputs={"ok": True}))

        saved = exec_repo.synchronously_saved[-1]
        assert saved.status == WorkflowExecutionStatus.SUCCEEDED
        assert saved.total_tokens == 3
        assert saved.total_steps == 2

    def test_handle_graph_run_partial_succeeded_updates_execution(self):
        layer, exec_repo, _, runtime_state = _make_layer()
        layer.on_event(GraphRunStartedEvent())
        usage = LLMUsage.empty_usage()
        usage.total_tokens = 5
        runtime_state.add_llm_usage(usage)
        for _ in range(4):
            runtime_state.increment_node_run_steps()
        runtime_state._graph_execution = SimpleNamespace(exceptions_count=2)

        layer.on_event(GraphRunPartialSucceededEvent(outputs={"ok": True}, exceptions_count=2))

        saved = exec_repo.synchronously_saved[-1]
        assert saved.status == WorkflowExecutionStatus.PARTIAL_SUCCEEDED
        assert saved.exceptions_count == 2
        assert saved.total_tokens == 5

    def test_handle_graph_run_failed_marks_nodes_and_enqueues_trace(self):
        trace_tasks: list[object] = []
        trace_manager = SimpleNamespace(user_id="user", add_trace_task=lambda task: trace_tasks.append(task))
        layer, exec_repo, node_repo, _ = _make_layer(extras={"external_trace_id": "trace"}, trace_manager=trace_manager)
        layer.on_event(GraphRunStartedEvent())

        running = WorkflowNodeExecution(
            id="node-exec",
            workflow_id="workflow-id",
            workflow_execution_id="run-id",
            index=1,
            node_id="node",
            node_type=BuiltinNodeTypes.START,
            title="Start",
            created_at=_naive_utc_now(),
        )
        layer._node_execution_cache[running.id] = running

        layer.on_event(GraphRunFailedEvent(error="boom", exceptions_count=1))

        assert node_repo.saved
        assert exec_repo.synchronously_saved[-1].status == WorkflowExecutionStatus.FAILED
        assert trace_tasks

    def test_handle_graph_run_succeeded_enqueues_parent_trace_context(self, monkeypatch: pytest.MonkeyPatch):
        trace_tasks: list[TraceTask] = []
        trace_manager = SimpleNamespace(user_id="user", add_trace_task=lambda task: trace_tasks.append(task))
        layer, _, _, _ = _make_layer(
            extras={
                "external_trace_id": "trace",
                "trace_session_id": "session-1",
                "parent_trace_context": {
                    "parent_workflow_run_id": "outer-workflow-run-1",
                    "parent_node_execution_id": "outer-node-execution-1",
                },
            },
            trace_manager=trace_manager,
        )
        layer.on_event(GraphRunStartedEvent())

        captured: dict[str, object] = {}

        def fake_workflow_trace(
            self: TraceTask,
            *,
            workflow_run_id: str | None,
            conversation_id: str | None,
            user_id: str | None,
            total_tokens_override: int | None = None,
        ):
            captured["trace_type"] = self.trace_type
            captured["external_trace_id"] = self.kwargs.get("external_trace_id")
            captured["trace_session_id"] = self.kwargs.get("trace_session_id")
            captured["parent_trace_context"] = self.kwargs.get("parent_trace_context")
            captured["workflow_run_id"] = workflow_run_id
            return {"ok": True}

        monkeypatch.setattr(TraceTask, "workflow_trace", fake_workflow_trace)

        layer.on_event(GraphRunSucceededEvent(outputs={"ok": True}))

        assert trace_tasks
        trace_task = trace_tasks[0]
        assert trace_task.trace_type == TraceTaskName.WORKFLOW_TRACE
        assert trace_task.kwargs["external_trace_id"] == "trace"
        assert trace_task.kwargs["trace_session_id"] == "session-1"
        assert trace_task.kwargs["parent_trace_context"] == {
            "parent_workflow_run_id": "outer-workflow-run-1",
            "parent_node_execution_id": "outer-node-execution-1",
        }

        trace_task.execute()

        assert captured["trace_type"] == TraceTaskName.WORKFLOW_TRACE
        assert captured["external_trace_id"] == "trace"
        assert captured["trace_session_id"] == "session-1"
        assert captured["parent_trace_context"] == {
            "parent_workflow_run_id": "outer-workflow-run-1",
            "parent_node_execution_id": "outer-node-execution-1",
        }

    def test_handle_graph_run_aborted_sets_status(self):
        layer, exec_repo, _, _ = _make_layer()
        layer.on_event(GraphRunStartedEvent())

        layer.on_event(GraphRunAbortedEvent(reason=None, outputs={}))

        saved = exec_repo.synchronously_saved[-1]
        assert saved.status == WorkflowExecutionStatus.STOPPED
        assert saved.error_message

    def test_handle_node_started_and_retry(self):
        layer, _, node_repo, _ = _make_layer(node_run_indices={"exec": 1})
        layer.on_event(GraphRunStartedEvent())

        start_event = NodeRunStartedEvent(
            id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.START,
            node_title="Start",
            start_at=_naive_utc_now(),
            predecessor_node_id="prev",
        )
        layer.on_event(start_event)

        assert node_repo.saved
        assert "exec" in layer._node_execution_cache
        assert node_repo.saved[-1].created_at == start_event.start_at

        retry_event = NodeRunRetryEvent(
            id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.START,
            node_title="Start",
            start_at=_naive_utc_now(),
            error="retry",
            retry_index=1,
        )
        layer.on_event(retry_event)
        assert node_repo.saved_exec_data

    def test_agent_v2_caller_row_is_saved_synchronously_before_node_run(self):
        layer, _, node_repo, _ = _make_layer(node_run_indices={"agent-exec": 1})
        layer.on_event(GraphRunStartedEvent())
        results = []
        node = SimpleNamespace(
            id="agent-node",
            execution_id="agent-exec",
            node_type=BuiltinNodeTypes.AGENT,
            title="Agent",
            version=lambda: "2",
            run_context=build_test_run_context(),
            record_caller_persistence_result=lambda *, error=None: results.append(error),
        )
        layer.on_node_run_start(node)
        layer.on_node_run_start(node)
        assert [execution.id for execution in node_repo.synchronously_saved] == ["agent-exec"]
        assert node_repo.saved == []
        assert results == [None, None]

        layer.on_event(
            NodeRunStartedEvent(
                id="agent-exec",
                node_id="agent-node",
                node_type=BuiltinNodeTypes.AGENT,
                node_version="2",
                node_title="Agent",
                start_at=_naive_utc_now(),
            )
        )

        assert [execution.id for execution in node_repo.synchronously_saved] == ["agent-exec"]
        assert [execution.id for execution in node_repo.saved] == ["agent-exec"]

    def test_retry_history_is_preserved_after_node_succeeds(self):
        layer, _, node_repo, _ = _make_layer(node_run_indices={"exec": 1})
        layer.on_event(GraphRunStartedEvent())
        started_at = _naive_utc_now()
        layer.on_event(
            NodeRunStartedEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.HTTP_REQUEST,
                node_title="HTTP",
                start_at=started_at,
            )
        )

        for retry_index in (1, 2):
            layer.on_event(
                NodeRunRetryEvent(
                    id="exec",
                    node_id="node",
                    node_type=BuiltinNodeTypes.HTTP_REQUEST,
                    node_title="HTTP",
                    start_at=started_at,
                    error=f"attempt {retry_index} failed",
                    retry_index=retry_index,
                    node_run_result=NodeRunResult(
                        inputs={"attempt": retry_index},
                        process_data={"request": f"attempt-{retry_index}"},
                        outputs={"status_code": 500, "body": f"failure-{retry_index}"},
                        metadata={WorkflowNodeExecutionMetadataKey.ITERATION_ID: "iteration-1"},
                    ),
                )
            )

        layer.on_event(
            NodeRunSucceededEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.HTTP_REQUEST,
                start_at=started_at,
                node_run_result=NodeRunResult(
                    inputs={"attempt": 3},
                    process_data={"request": "successful-attempt"},
                    outputs={"status_code": 200, "body": "ok"},
                    metadata={},
                ),
            )
        )

        saved_execution = node_repo.saved_exec_data[-1]
        assert saved_execution.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert saved_execution.process_data["request"] == "successful-attempt"
        retry_history = saved_execution.process_data["__dify_retry_history"]
        assert [attempt["retry_index"] for attempt in retry_history] == [1, 2]
        assert retry_history[0]["inputs"] == {"attempt": 1}
        assert retry_history[0]["process_data"] == {"request": "attempt-1"}
        assert retry_history[0]["outputs"] == {"status_code": 500, "body": "failure-1"}
        assert retry_history[0]["error"] == "attempt 1 failed"
        assert retry_history[0]["execution_metadata"] == {"iteration_id": "iteration-1"}

    @pytest.mark.parametrize(
        ("event_type", "expected_status"),
        [
            (NodeRunFailedEvent, WorkflowNodeExecutionStatus.FAILED),
            (NodeRunExceptionEvent, WorkflowNodeExecutionStatus.EXCEPTION),
            (GraphRunFailedEvent, WorkflowNodeExecutionStatus.FAILED),
            (GraphRunAbortedEvent, WorkflowNodeExecutionStatus.FAILED),
        ],
    )
    def test_retry_history_is_preserved_after_terminal_error(self, event_type, expected_status):
        layer, _, node_repo, _ = _make_layer(node_run_indices={"exec": 1})
        layer.on_event(GraphRunStartedEvent())
        started_at = _naive_utc_now()
        layer.on_event(
            NodeRunStartedEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.LLM,
                node_title="LLM",
                start_at=started_at,
            )
        )
        layer.on_event(
            NodeRunRetryEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.LLM,
                node_title="LLM",
                start_at=started_at,
                error="retry failed",
                retry_index=1,
                node_run_result=NodeRunResult(outputs={"attempt": 1}),
            )
        )

        if event_type is GraphRunFailedEvent:
            terminal_event = event_type(error="terminal failure")
        elif event_type is GraphRunAbortedEvent:
            terminal_event = event_type(reason="terminal failure")
        else:
            terminal_event = event_type(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.LLM,
                start_at=started_at,
                error="terminal failure",
                node_run_result=NodeRunResult(process_data={"terminal": True}),
            )
        node_repo.saved.clear()
        layer.on_event(terminal_event)

        saved_execution = node_repo.saved[-1]
        assert saved_execution.status == expected_status
        assert saved_execution.error == "terminal failure"
        assert saved_execution.finished_at is not None
        if event_type in (NodeRunFailedEvent, NodeRunExceptionEvent):
            assert saved_execution.process_data["terminal"] is True
        assert saved_execution.process_data["__dify_retry_history"][0]["retry_index"] == 1

    def test_pause_flush_persists_retry_history_synchronously(self):
        layer, _, node_repo, _ = _make_layer(node_run_indices={"exec": 1})
        layer.on_event(GraphRunStartedEvent())
        started_at = _naive_utc_now()
        layer.on_event(
            NodeRunStartedEvent(
                id="exec", node_id="node", node_type=BuiltinNodeTypes.LLM, node_title="LLM", start_at=started_at
            )
        )
        layer.on_event(
            NodeRunRetryEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.LLM,
                node_title="LLM",
                start_at=started_at,
                error="retry failed",
                retry_index=1,
            )
        )
        assert node_repo.synchronously_saved == []

        layer.persist_unfinished_nodes_synchronously()

        saved_execution = node_repo.synchronously_saved[-1]
        assert saved_execution.status == WorkflowNodeExecutionStatus.RETRY
        assert saved_execution.finished_at is None
        assert saved_execution.process_data["__dify_retry_history"][0]["error"] == "retry failed"

    def test_handle_node_pause_requested_skips_outputs(self):
        layer, _, _, _ = _make_layer(node_run_indices={"exec": 1})
        layer.on_event(GraphRunStartedEvent())
        start_event = NodeRunStartedEvent(
            id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
            start_at=_naive_utc_now(),
        )
        layer.on_event(start_event)

        domain_execution = layer._node_execution_cache["exec"]
        domain_execution.inputs = {"old": True}

        result = NodeRunResult(
            inputs={"new": True},
            outputs={"out": 1},
            process_data={
                "p": 1,
                "workflow_agent_binding_id": "workflow-binding-1",
                "workflow_tool_invocation_id": "tool-call-1",
            },
            metadata={},
        )
        pause_event = NodeRunPauseRequestedEvent(
            id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            reason=SchedulingPause(message="pause"),
            node_run_result=result,
        )
        layer.on_event(pause_event)

        assert domain_execution.status == WorkflowNodeExecutionStatus.PAUSED
        assert domain_execution.inputs == {"old": True}
        assert domain_execution.process_data == {
            "workflow_agent_binding_id": "workflow-binding-1",
            "workflow_tool_invocation_id": "tool-call-1",
        }

    def test_handle_node_retry_preserves_workflow_agent_binding_identity(self):
        layer, _, _, _ = _make_layer(node_run_indices={"exec": 1})
        layer.on_event(GraphRunStartedEvent())
        started_at = _naive_utc_now()
        layer.on_event(
            NodeRunStartedEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.AGENT,
                node_title="Agent",
                start_at=started_at,
            )
        )

        layer.on_event(
            NodeRunRetryEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.AGENT,
                node_title="Agent",
                start_at=started_at,
                error="retry",
                retry_index=1,
                node_run_result=NodeRunResult(
                    process_data={
                        "workflow_agent_binding_id": "workflow-binding-1",
                        "workflow_tool_invocation_id": "tool-call-1",
                    },
                ),
            )
        )

        assert layer._node_execution_cache["exec"].process_data["workflow_agent_binding_id"] == "workflow-binding-1"
        assert layer._node_execution_cache["exec"].process_data["workflow_tool_invocation_id"] == "tool-call-1"

    def test_get_node_execution_raises_for_missing(self):
        layer, _, _, _ = _make_layer()
        with pytest.raises(ValueError, match="Node execution not found"):
            layer._get_node_execution("missing")

    def test_get_workflow_execution_raises_when_uninitialized(self):
        layer, _, _, _ = _make_layer()

        with pytest.raises(ValueError, match="workflow execution not initialized"):
            layer._get_workflow_execution()
