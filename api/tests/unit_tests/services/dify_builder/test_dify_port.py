"""Tests for the real ``DifyPort`` adapter -- ``WorkflowServiceDifyPort``.

These use real SQLite sessions and persisted identity/draft rows. External
workflow generation and service boundaries remain patched to pin the adapter's
orchestration and the P2 plan's service contracts:

- ``apply_repair`` calls ``sync_draft_workflow`` with ``graph_only=True`` and
  ``sync_agent_bindings=False``, mutating only the target node's data (deep
  copy -- the workflow's own ``graph_dict`` stays untouched), and re-maps
  ``WorkflowHashNotEqualError`` to the domain ``HashMismatchError``.
- ``run_draft`` calls ``AppGenerateService.generate`` with
  ``invoke_from=InvokeFrom.DEBUGGER`` and ``streaming=True`` in process, emits an
  ``on_event`` per node frame *as the run streams*, consumes that stream
  outside the ``Session`` block, and still reads the node-execution rows once
  at the end for the ``run_mapping``-mapped ``Run``. A stream that ends without
  a terminal frame never fabricates a failure -- it recovers the run's real
  status from the database, or reports the outcome as unknown.
- ``publish`` calls ``publish_workflow`` AND sets ``app.workflow_id`` AND
  commits -- omitting the ``workflow_id`` update makes publish a silent
  no-op, so all three are asserted together.

The genuine red -> green -> publish end-to-end against a running local stack
is Task 5's runbook, not this suite.
"""

import json
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from types import TracebackType
from typing import override
from unittest.mock import MagicMock, patch

import pytest
import pytest_mock
import sqlalchemy
from sqlalchemy import Engine, update
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from core.dify_builder.models import Actor, Graph, MutationIntent, Run
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.account import Account
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import App, AppMode
from models.workflow import (
    Workflow,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
)
from services.dify_builder import run_mapping
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.errors import HashMismatchError, WorkflowNotInitializedError
from services.dify_builder.revision import execution_revision
from services.errors.app import WorkflowHashNotEqualError
from tests.unit_tests.installed_spies import installed_mock


def _workflow(
    *, graph_dict: Graph | None = None, features_dict: Graph | None = None, session: Session | None = None
) -> Workflow:
    row = Workflow.new(
        tenant_id="tenant-1",
        app_id="app-1",
        type="workflow",
        version=Workflow.VERSION_DRAFT,
        created_by="acc-1",
        graph=json.dumps(graph_dict or {"nodes": [], "edges": []}),
        features=json.dumps(features_dict or {}),
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    if session is not None:
        session.add(row)
        session.flush()
        session.commit()
        _installed_spy_13 = installed_mock(session.commit)
        _installed_spy_13.reset_mock()
    return row


def _account(*, id: str = "acc-1") -> Account:
    row = Account(name="Actor", email=f"{id}@example.test")
    row.id = id
    return row


def _app(
    *,
    id: str = "app-1",
    tenant_id: str = "tenant-1",
    mode: str = "workflow",
    workflow_id: str | None = None,
    updated_by: str | None = None,
    updated_at: datetime | None = None,
) -> App:
    row = App(
        id=id,
        tenant_id=tenant_id,
        mode=AppMode(mode),
        name="Draft",
        enable_site=False,
        enable_api=False,
        workflow_id=workflow_id,
        updated_by=updated_by,
    )
    if updated_at is not None:
        row.updated_at = updated_at
    return row


def _execution(
    *,
    node_id: str,
    node_type: str,
    title: str,
    status: str,
    error: str | None = None,
    inputs_dict: Graph | None = None,
    outputs_dict: Graph | None = None,
) -> WorkflowNodeExecutionModel:
    return WorkflowNodeExecutionModel(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id="run-1",
        triggered_from=WorkflowNodeExecutionTriggeredFrom("workflow-run"),
        index=1,
        node_id=node_id,
        node_type=node_type,
        title=title,
        status=WorkflowNodeExecutionStatus(status),
        error=error,
        created_by="acc-1",
        created_by_role=CreatorUserRole("account"),
        inputs=json.dumps(inputs_dict) if inputs_dict is not None else None,
        outputs=json.dumps(outputs_dict) if outputs_dict is not None else None,
    )


def _run(
    *,
    id: str = "run-1",
    status: str = "succeeded",
    error: str | None = None,
    elapsed_time: float = 0,
    total_tokens: int = 0,
    graph_dict: Graph | None = None,
) -> WorkflowRun:
    return WorkflowRun(
        id=id,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType("workflow"),
        triggered_from=WorkflowRunTriggeredFrom("debugging"),
        version="draft",
        created_by="acc-1",
        created_by_role=CreatorUserRole("account"),
        status=WorkflowExecutionStatus(status),
        error=error,
        elapsed_time=elapsed_time,
        total_tokens=total_tokens,
        graph=json.dumps(graph_dict or {}),
    )


def _published_workflow(*, id: str, marked_name: str, version_number: int = 1) -> Workflow:
    row = _workflow()
    row.id, row.marked_name, row.version_number = id, marked_name, version_number
    return row


@dataclass
class PortDatabase:
    engine: Engine | Connection


class TrackedPortSession(Session):
    exits: int = 0

    @override
    def __exit__(
        self, type_: type[BaseException] | None, value: BaseException | None, traceback: TracebackType | None
    ) -> None:
        self.exits += 1
        super().__exit__(type_, value, traceback)


def _actor() -> Actor:
    return Actor(account_id="acc-1", tenant_id="tenant-1")


def _configure_session_get(session: Session, *, account: Account | None = None, app: App | None = None) -> None:
    for row in (account, app):
        if row is not None:
            if session.get(type(row), row.id) is None:
                session.add(row)
            else:
                session.merge(row)
    session.commit()
    _installed_spy_1 = installed_mock(session.get)
    _installed_spy_1.reset_mock()
    _installed_spy_2 = installed_mock(session.refresh)
    _installed_spy_2.reset_mock()
    _installed_spy_3 = installed_mock(session.commit)
    _installed_spy_3.reset_mock()


@pytest.fixture
def mock_session(sqlite_engine: sqlalchemy.Engine, mocker: pytest_mock.MockerFixture) -> Iterator[TrackedPortSession]:
    with TrackedPortSession(sqlite_engine, expire_on_commit=False) as session:
        for name in ("get", "refresh", "commit"):
            mocker.spy(session, name)
        yield session


@pytest.fixture(autouse=True)
def _mock_db(sqlite_engine: sqlalchemy.Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr("services.dify_builder.dify_port.db", PortDatabase(sqlite_engine))
    with patch("services.dify_builder.dify_port.set_login_user"):
        yield


@pytest.fixture(autouse=True)
def _skip_preflight() -> Iterator[None]:
    """``apply_repair`` dry-validates the mutated graph
    (``new_preflight_problems``). The ``apply_repair`` tests in THIS module build
    nodes from bare ``config={}`` stand-ins that are not valid node data, so the
    check is bypassed here; ``test_dify_port_preflight.py`` exercises the real
    one."""
    with patch("services.dify_builder.dify_port.new_preflight_problems", return_value=[]):
        yield


@pytest.fixture(autouse=True)
def _mock_sessionmaker(mock_session: TrackedPortSession, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.dify_builder.dify_port._session_factory", lambda: lambda: mock_session)


@pytest.fixture(autouse=True)
def _default_draft_for_native_runs(mock_session: TrackedPortSession) -> Iterator[None]:
    # Stream fixtures now also read a real draft to establish launch identity.
    with patch("services.dify_builder.dify_port.WorkflowService") as service:
        service.return_value.get_draft_workflow.return_value = _workflow(
            session=mock_session,
        )
        yield


# ---- read_graph --------------------------------------------------------------


def test_read_graph_returns_graph_and_execution_revision(mock_session: TrackedPortSession) -> None:
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, app=app)
    workflow = _workflow(session=mock_session, graph_dict={"nodes": [], "edges": []})

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, workflow.id
        )

        graph, unique_hash = WorkflowServiceDifyPort().read_graph("app-1", _actor())

    assert graph == {"nodes": [], "edges": []}
    assert unique_hash == execution_revision(workflow)
    assert unique_hash != workflow.unique_hash
    mock_ws_cls.return_value.get_draft_workflow.assert_called_once_with(app, session=mock_session)


def test_read_graph_raises_when_no_draft_workflow(mock_session: TrackedPortSession) -> None:
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, app=app)

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = None

        with pytest.raises(WorkflowNotInitializedError):
            WorkflowServiceDifyPort().read_graph("app-1", _actor())


# ---- apply_repair --------------------------------------------------------------


def test_apply_repair_syncs_mutated_graph_with_graph_only_and_no_agent_binding_sync(
    mock_session: TrackedPortSession,
) -> None:
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    original_graph: Graph = {"nodes": [{"id": "node-1", "data": {"code": "old"}}], "edges": []}
    workflow = _workflow(
        session=mock_session,
        graph_dict=original_graph,
        features_dict={"feature": True},
    )
    updated_workflow = _workflow(
        session=mock_session,
    )
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "new"})]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, workflow.id
        )
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        result = WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
        )

    assert result.changed_nodes == ["node-1"]
    assert result.new_hash == execution_revision(updated_workflow)

    _, kwargs = mock_ws_cls.return_value.sync_draft_workflow.call_args
    # graph_only=True means sync_draft_workflow IGNORES the features/conversation_variables
    # kwargs entirely -- what actually protects the rest of the draft from being clobbered
    # is this combination: graph-only sync, no agent-binding sync, and environment variables
    # preserved (not overwritten by the `environment_variables=[]` we pass).
    assert kwargs["graph_only"] is True
    assert kwargs["sync_agent_bindings"] is False
    assert kwargs["commit"] is True
    assert kwargs["preserve_environment_variables"] is True
    assert kwargs["environment_variables"] == []
    assert kwargs["unique_hash"] == workflow.unique_hash
    assert kwargs["account"].id == account.id
    assert kwargs["app_model"].id == app.id
    assert kwargs["session"] is mock_session

    mutated_node = next(n for n in kwargs["graph"]["nodes"] if n["id"] == "node-1")
    assert mutated_node["data"]["code"] == "new"
    # The workflow's own graph_dict is untouched -- apply_set_node_config deep-copies.
    assert original_graph["nodes"][0]["data"]["code"] == "old"


def test_apply_repair_maps_hash_mismatch_to_domain_error(mock_session: TrackedPortSession) -> None:
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        session=mock_session,
        graph_dict={"nodes": [{"id": "node-1", "data": {}}], "edges": []},
        features_dict={},
    )
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "x"})]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, workflow.id
        )
        mock_ws_cls.return_value.sync_draft_workflow.side_effect = WorkflowHashNotEqualError()

        with pytest.raises(HashMismatchError):
            WorkflowServiceDifyPort().apply_repair(
                "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
            )


def test_apply_repair_dispatches_connect_and_reports_dangling_ref_as_value_error(
    mock_session: TrackedPortSession,
) -> None:
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        session=mock_session,
        graph_dict={"nodes": [{"id": "a", "data": {}}], "edges": []},
        features_dict={},
    )
    intents = [MutationIntent(op="connect", args={"from_node": "a", "to_node": "missing"})]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, workflow.id
        )

        with pytest.raises(ValueError, match="node not found: missing"):
            WorkflowServiceDifyPort().apply_repair(
                "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
            )


@pytest.mark.parametrize("values", [["changed", "changed-again"], ["unchanged", "unchanged"]])
def test_apply_repair_notifies_once_after_a_changed_committed_batch(
    mock_session: TrackedPortSession, values: list[str]
) -> None:
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        session=mock_session,
        graph_dict={"nodes": [{"id": "node-1", "data": {"code": "unchanged"}}], "edges": []},
        features_dict={},
    )
    updated_workflow = _workflow(
        session=mock_session,
    )
    intents = [
        MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": value})
        for value in values
    ]
    events: list[Graph] = []

    def on_canvas(event: Graph) -> None:
        assert mock_session.exits == 2
        events.append(event)

    def preflight_before_lock(*_args: object) -> list[str]:
        _installed_spy_14 = installed_mock(mock_session.refresh)
        _installed_spy_14.assert_not_called()
        return []

    with (
        patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls,
        patch("services.dify_builder.dify_port.new_preflight_problems", side_effect=preflight_before_lock),
    ):
        mock_ws_cls.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, workflow.id
        )
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, on_canvas=on_canvas, expected_revision=execution_revision(workflow)
        )

    assert events == ([{"event": "graph_changed", "cause": "apply"}] if values[-1] != "unchanged" else [])


def test_apply_repair_skips_already_present_create_and_connect(mock_session: TrackedPortSession) -> None:
    """A fix.apply Retry re-applies the SAME intents against an already-mutated
    draft. create_node for a present id and connect for a present edge must be
    dropped (no duplicate, no ValueError); set_node_config still applies."""
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    # Draft already has node "llm_1" and edge start_1 -> llm_1 (the result of a prior apply).
    existing_graph = {
        "nodes": [
            {"id": "start_1", "data": {"type": "start"}},
            {"id": "llm_1", "data": {"type": "llm", "title": "old"}},
        ],
        "edges": [{"id": "e1", "source": "start_1", "target": "llm_1"}],
    }
    workflow = _workflow(
        session=mock_session,
        graph_dict=existing_graph,
        features_dict={},
    )
    intents = [
        MutationIntent(op="create_node", args={"node_type": "llm", "node_id": "llm_1", "config": {"title": "new"}}),
        MutationIntent(op="connect", args={"from_node": "start_1", "to_node": "llm_1"}),
    ]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, workflow.id
        )

        result = WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
        )

    # Both intents were already present -> filtered -> no changes -> no-op ApplyResult, no ValueError.
    assert result.changed_nodes == []
    assert result.new_hash == execution_revision(workflow)
    mock_ws_cls.return_value.sync_draft_workflow.assert_not_called()


def test_apply_repair_survives_delete_and_recreate_of_same_id_in_one_batch(mock_session: TrackedPortSession) -> None:
    """A from-scratch build (handlers_build.handle_plan_approval) sends
    delete_node(placeholder_start) + create_node(same id) in ONE batch, to
    replace the canvas's default placeholder start with the generator's own
    start node of the same id. The already-present filter above must NOT
    treat "start" as already-present just because it's in before_graph --
    that would drop the create_node while the delete_node still runs,
    deleting the start node with no re-create, and the subsequent connect
    would then raise ValueError('node not found: start')."""
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    # Draft has only the canvas's default placeholder start node "start".
    existing_graph: Graph = {
        "nodes": [{"id": "start", "data": {"type": "start"}}],
        "edges": [],
    }
    workflow = _workflow(
        session=mock_session,
        graph_dict=existing_graph,
        features_dict={},
    )
    updated_workflow = _workflow(
        session=mock_session,
    )
    intents = [
        MutationIntent(op="delete_node", args={"node_id": "start"}),
        MutationIntent(op="create_node", args={"node_type": "start", "node_id": "start", "config": {}}),
        MutationIntent(op="create_node", args={"node_type": "llm", "node_id": "llm_1", "config": {}}),
        MutationIntent(op="connect", args={"from_node": "start", "to_node": "llm_1"}),
    ]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, workflow.id
        )
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        # Must not raise -- the recreate of "start" must survive the filter.
        result = WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
        )

    assert result.new_hash == execution_revision(updated_workflow)
    _, kwargs = mock_ws_cls.return_value.sync_draft_workflow.call_args
    synced_nodes = {n["id"] for n in kwargs["graph"]["nodes"]}
    synced_edges = {(e["source"], e["target"]) for e in kwargs["graph"]["edges"]}
    # "start" must still be present (recreated, not left deleted) alongside the new node.
    assert synced_nodes == {"start", "llm_1"}
    # The connect from the recreated "start" to "llm_1" must have applied.
    assert ("start", "llm_1") in synced_edges


@pytest.mark.parametrize("operation", ["apply", "noop", "restore"])
def test_mutations_recheck_execution_revision_after_locking(mock_session: TrackedPortSession, operation: str) -> None:
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)
    workflow = _workflow(
        session=mock_session, graph_dict={"nodes": [{"id": "node-1", "data": {"code": "old"}}], "edges": []}
    )
    expected = execution_revision(workflow)

    def concurrent_edit(_workflow: Workflow, *, with_for_update: bool) -> None:
        assert with_for_update is True
        workflow.graph = json.dumps({"nodes": [{"id": "node-1", "data": {"code": "human edit"}}], "edges": []})
        with Session(mock_session.get_bind()) as writer, writer.begin():
            writer.execute(update(Workflow).where(Workflow.id == workflow.id).values(graph=workflow.graph))
        Session.refresh(mock_session, _workflow, with_for_update=with_for_update)

    _installed_spy_4 = installed_mock(mock_session.refresh)
    _installed_spy_4.side_effect = concurrent_edit
    events = []
    with patch("services.dify_builder.dify_port.WorkflowService") as service:
        service.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, workflow.id
        )
        port = WorkflowServiceDifyPort()
        if operation == "apply":
            with pytest.raises(HashMismatchError, match="execution configuration changed"):
                port.apply_repair(
                    "app-1",
                    _actor(),
                    [
                        MutationIntent(
                            op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "AI edit"}
                        )
                    ],
                    on_canvas=events.append,
                    expected_revision=expected,
                )
        elif operation == "noop":
            with pytest.raises(HashMismatchError, match="execution configuration changed"):
                port.apply_repair("app-1", _actor(), [], on_canvas=events.append, expected_revision=expected)
        else:
            with pytest.raises(HashMismatchError, match="execution configuration changed"):
                port.restore_graph("app-1", _actor(), {"nodes": [], "edges": []}, expected_revision=expected)
        service.return_value.sync_draft_workflow.assert_not_called()
    assert events == []
    assert workflow.graph_dict["nodes"][0]["data"]["code"] == "human edit"


def test_repair_preserves_layout_committed_while_builder_was_planning(mock_session: TrackedPortSession) -> None:
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)
    workflow = _workflow(
        session=mock_session,
        graph_dict={
            "nodes": [
                {"id": "node-1", "type": "custom", "data": {"type": "code", "code": "old"}},
                {"id": "end", "type": "custom", "data": {"type": "end"}},
            ],
            "edges": [{"id": "node-1-end", "source": "node-1", "target": "end", "type": "custom"}],
        },
    )
    expected = execution_revision(workflow)

    def move_node(_workflow: Workflow, *, with_for_update: bool) -> None:
        assert with_for_update is True
        graph = dict(workflow.graph_dict)
        graph["nodes"][0]["position"] = {"x": 900, "y": 500}
        graph["edges"][0].update(
            sourceHandle="source",
            targetHandle="target",
            data={"sourceType": "code", "targetType": "end", "isInIteration": False, "isInLoop": False},
        )
        graph["viewport"] = {"x": 50, "y": 70, "zoom": 2}
        workflow.graph = json.dumps(graph)
        with Session(mock_session.get_bind()) as writer, writer.begin():
            writer.execute(update(Workflow).where(Workflow.id == workflow.id).values(graph=workflow.graph))
        Session.refresh(mock_session, _workflow, with_for_update=with_for_update)

    _installed_spy_5 = installed_mock(mock_session.refresh)
    _installed_spy_5.side_effect = move_node
    with (
        patch("services.dify_builder.dify_port.WorkflowService") as service,
        patch("services.dify_builder.dify_port.notify_workflow_draft_changed") as notify,
    ):
        service.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, workflow.id
        )

        def sync_graph(**kwargs: object) -> Workflow:
            assert kwargs["unique_hash"] == workflow.unique_hash
            workflow.graph = json.dumps(kwargs["graph"])
            return workflow

        service.return_value.sync_draft_workflow.side_effect = sync_graph
        result = WorkflowServiceDifyPort().apply_repair(
            "app-1",
            _actor(),
            [MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "AI edit"})],
            expected_revision=expected,
        )
        assert notify.call_args.kwargs["previous_graph"]["nodes"][0]["position"] == {"x": 900, "y": 500}

    assert workflow.graph_dict["nodes"][0]["position"] == {"x": 900, "y": 500}
    assert workflow.graph_dict["nodes"][0]["data"]["code"] == "AI edit"
    assert workflow.graph_dict["edges"][0]["data"]["sourceType"] == "code"
    assert workflow.graph_dict["viewport"]["zoom"] == 2
    assert result.new_hash == execution_revision(workflow)
    assert result.new_hash != expected


# ---- run_draft --------------------------------------------------------------


def _sse(chunk: Graph) -> str:
    """One event as ``AppGenerateService.generate(streaming=True)`` really emits it.

    ``BaseAppGenerator.convert_to_event_stream`` is the tail of every streaming
    generate call and wraps each event mapping as ``"data: {json}\\n\\n"``.
    """
    return f"data: {json.dumps(chunk)}\n\n"


_FINISHED_CHUNK = {
    "event": "workflow_finished",
    "workflow_run_id": "run-1",
    "data": {
        "id": "run-1",
        "workflow_id": "wf-1",
        "status": "succeeded",
        "outputs": {"answer": "42"},
        "error": None,
        "elapsed_time": 1.0,
        "total_tokens": 10,
    },
}


def _configure_default_identity(session: TrackedPortSession) -> None:
    _configure_session_get(
        session,
        account=_account(id="acc-1"),
        app=_app(id="app-1", tenant_id="tenant-1", mode="workflow"),
    )


def _node_exec() -> WorkflowNodeExecutionModel:
    return _execution(
        node_id="node-1",
        node_type="code",
        title="Code",
        status="succeeded",
        error=None,
        inputs_dict={},
        outputs_dict={"x": 1},
    )


# ---- run_draft: truncated streams must never fabricate a failure -------------


def _truncated_stream() -> list[str]:
    """A stream that stamps the run id and then just stops -- no terminal frame.

    This is what the subscription's idle timeout (or a dead publishing worker)
    leaves behind.
    """
    return [
        _sse({"event": "workflow_started", "workflow_run_id": "run-1", "data": {"id": "run-1"}}),
        _sse(
            {
                "event": "node_started",
                "workflow_run_id": "run-1",
                "data": {"id": "node-exec-1", "node_id": "node-1", "title": "Code"},
            }
        ),
    ]


def test_a_truncated_stream_reports_the_runs_real_status_from_the_database(mock_session: TrackedPortSession) -> None:
    """THE regression this guards: a slow run that SUCCEEDED must not read as failed.

    The stream can end early while the run is still fine. Synthesising "failed"
    would send a perfectly good build into the repair loop.
    """
    _configure_default_identity(mock_session)

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = iter(_truncated_stream())
        node_repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        node_repo.get_executions_by_workflow_run.return_value = [_node_exec()]
        run_repo = mock_repo_factory.create_api_workflow_run_repository.return_value
        run_repo.get_workflow_run_by_id.return_value = _run(
            id="run-1", status="succeeded", error=None, elapsed_time=361.0, total_tokens=99
        )

        run, _ = WorkflowServiceDifyPort()._finish_run("tenant-1", "app-1", {}, "run-1")

    # The run id came off a non-terminal frame, so both reads could still happen.
    node_repo.get_executions_by_workflow_run.assert_called_once_with("tenant-1", "app-1", "run-1")
    run_repo.get_workflow_run_by_id.assert_called_once_with(tenant_id="tenant-1", app_id="app-1", run_id="run-1")
    assert run.status == "succeeded"
    assert run.error == ""
    assert run.dify_run_id == "run-1"
    assert run.tokens == 99
    assert run.per_node[0].node_id == "node-1"


def test_a_truncated_stream_over_a_still_running_run_is_unknown_not_failed(mock_session: TrackedPortSession) -> None:
    """Outcome genuinely unknown -> "running" + a visible reason, never "failed"."""
    _configure_default_identity(mock_session)

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = iter(_truncated_stream())
        node_repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        node_repo.get_executions_by_workflow_run.return_value = list[object]()
        run_repo = mock_repo_factory.create_api_workflow_run_repository.return_value
        run_repo.get_workflow_run_by_id.return_value = _run(
            id="run-1", status="running", error=None, elapsed_time=300.0, total_tokens=5
        )

        run, _ = WorkflowServiceDifyPort()._finish_run("tenant-1", "app-1", {}, "run-1")

    assert run.status == "running"
    assert run.status != "failed"
    assert run.error == run_mapping.TRUNCATED_STREAM_ERROR
    assert run.dify_run_id == "run-1"


# ---- publish --------------------------------------------------------------


def test_publish_publishes_workflow_updates_app_workflow_id_and_commits(mock_session: TrackedPortSession) -> None:
    account = _account(id="acc-1")
    app = _app(
        id="app-1",
        tenant_id="tenant-1",
        workflow_id="old-wf-id",
        updated_by="old-updater",
        updated_at=None,
    )
    _configure_session_get(mock_session, account=account, app=app)
    published_workflow = _published_workflow(id="new-wf-id", marked_name="", version_number=2)

    with (
        patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls,
        patch("services.dify_builder.dify_port.naive_utc_now") as mock_naive_utc_now,
    ):
        # WorkflowService.publish_workflow returns a single Workflow (-> Workflow),
        # NOT a (workflow, retirement_candidates) tuple. Mock the real signature so
        # this test catches the tuple-unpack regression that crashed the publish step.
        mock_ws_cls.return_value.publish_workflow.return_value = published_workflow
        mock_naive_utc_now.return_value = datetime(2026, 10, 20, 12)

        draft = _workflow(
            session=mock_session,
        )
        draft.id = "locked-draft"
        mock_session.commit()
        _installed_spy_15 = installed_mock(mock_session.commit)
        _installed_spy_15.reset_mock()
        mock_ws_cls.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, draft.id
        )
        result = WorkflowServiceDifyPort().publish(
            "app-1",
            _actor(),
            expected_revision=execution_revision(draft),
            expected_graph_revision=WorkflowServiceDifyPort().graph_revision(dict(draft.graph_dict)),
        )

    publish = mock_ws_cls.return_value.publish_workflow
    assert publish.call_count == 1
    assert publish.call_args.kwargs["session"] is mock_session
    assert publish.call_args.kwargs["app_model"].id == app.id
    assert publish.call_args.kwargs["account"].id == account.id
    stored_app = mock_session.get(App, app.id)
    assert stored_app is not None
    assert stored_app.workflow_id == "new-wf-id"
    # Publish must also advance the app's audit fields -- mirrors the console idiom at
    # controllers/console/app/workflow.py (~1315) so publishing via the dify_builder leaves the
    # same trail as publishing via the console UI.
    assert stored_app is not None
    assert stored_app.updated_by == "acc-1"
    assert stored_app is not None
    assert stored_app.updated_at == datetime(2026, 10, 20, 12)
    assert result.version_name == "# 2"
    assert result.status == "live"
    _installed_spy_6 = installed_mock(mock_session.commit)
    _installed_spy_6.assert_called_once()


# ---- Protocol conformance --------------------------------------------------


# ---- run_draft: an explicit error frame is a FAILED run, not an unknown one ----


# (ESQ1-302) The frame below is the exact one the session received four times
# (trace seq 52); until this fix the stream ended without a terminal frame, the
# run mapped to "running", and the handler bounced the user back to re-run.


def _run_stream(
    chunks: Sequence[str | Graph], *, node_execs: list[object] | None = None, run_row: object | None = None
) -> tuple[Run, list[Mapping[str, object]], MagicMock]:
    """Exercise the legacy presentation mapper only; no native/sealed execution proof."""
    forwarded = [value for chunk in chunks if (value := run_mapping.stream_chunk_as_mapping(chunk)) is not None]
    final, run_id, error = dict[str, object](), "", None
    for payload in forwarded:
        run_id = run_id or run_mapping.run_id_from_stream_chunk(payload)
        terminal = run_mapping.run_result_data_from_terminal_chunk(payload)
        if terminal is not None:
            final = terminal
        error = error or run_mapping.error_from_stream_chunk(payload)
    with patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as factory:
        node_repo = factory.create_api_workflow_node_execution_repository.return_value
        node_repo.get_executions_by_workflow_run.return_value = node_execs or []
        factory.create_api_workflow_run_repository.return_value.get_workflow_run_by_id.return_value = run_row
        run, _ = WorkflowServiceDifyPort()._finish_run("tenant-1", "app-1", final, run_id, error_frame=error)
    return run, forwarded, node_repo


def test_an_error_frame_after_workflow_started_keeps_the_run_id_and_its_rows(mock_session: TrackedPortSession) -> None:
    _configure_default_identity(mock_session)
    chunks = [
        _sse({"event": "workflow_started", "workflow_run_id": "run-9", "data": {"id": "run-9"}}),
        _sse({"event": "node_started", "workflow_run_id": "run-9", "data": {"node_id": "node-1", "title": "Code"}}),
        _sse({"event": "error", "workflow_run_id": "run-9", "code": "internal", "status": 500, "message": "boom"}),
    ]
    failed_row = _execution(
        node_id="node-1", node_type="code", title="Code", status="failed", error="boom", inputs_dict={}, outputs_dict={}
    )

    run, _, node_repo = _run_stream(chunks, node_execs=[failed_row])

    assert run.status == "failed"
    assert run.dify_run_id == "run-9"
    assert [n.node_id for n in run.per_node] == ["node-1"]
    assert run.culprit_node_id == "node-1"
    assert run.error == "boom [internal]"
    node_repo.get_executions_by_workflow_run.assert_called_once_with("tenant-1", "app-1", "run-9")


def test_chatflow_ordering_finished_failed_then_error_prefers_the_terminal_frame(
    mock_session: TrackedPortSession,
) -> None:
    """advanced_chat's pipeline yields workflow_finished(failed) AND THEN an error
    frame for the same failure. The terminal frame is the authority."""
    _configure_default_identity(mock_session)
    chunks = [
        _sse({"event": "workflow_started", "workflow_run_id": "run-2", "data": {"id": "run-2"}}),
        _sse(
            {
                "event": "workflow_finished",
                "workflow_run_id": "run-2",
                "data": {
                    "id": "run-2",
                    "status": "failed",
                    "outputs": {},
                    "error": "node4: timeout",
                    "elapsed_time": 2.5,
                    "total_tokens": 7,
                },
            }
        ),
        _sse(
            {
                "event": "error",
                "workflow_run_id": "run-2",
                "code": "internal",
                "status": 500,
                "message": "Run failed: node4: timeout",
            }
        ),
    ]

    run, _, _ = _run_stream(chunks)

    assert run.status == "failed"
    assert run.dify_run_id == "run-2"
    assert run.error == "node4: timeout"  # from the terminal frame, not the error frame
    assert run.elapsed_ms == 2500
    assert run.tokens == 7


@pytest.mark.parametrize(
    ("native_graph", "changed_features", "bound"),
    [("same", False, True), ("different", False, False), (None, False, False), ("same", True, False)],
)
def test_verification_binds_actual_native_graph(
    mock_session: TrackedPortSession, native_graph: None | str, changed_features: bool, bound: bool
) -> None:
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)
    workflow = _workflow(
        session=mock_session, graph_dict={"nodes": [{"id": "a", "data": {"type": "start"}}], "edges": []}
    )
    native = (
        dict(workflow.graph_dict)
        if native_graph == "same"
        else {"nodes": [{"id": "b", "data": {"type": "start"}}], "edges": list[object]()}
        if native_graph
        else None
    )
    before = execution_revision(workflow)

    def stream() -> Iterator[str | Graph]:
        if changed_features:
            workflow.features = json.dumps({"changed": True})
        yield {
            "event": "workflow_finished",
            "data": {"id": "native", "status": "succeeded", "outputs": {"result": None}},
        }

    with (
        patch("services.dify_builder.dify_port.WorkflowService") as ws,
        patch("services.dify_builder.dify_port.AppGenerateService") as gen,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as factory,
    ):
        ws.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(Workflow, workflow.id)
        gen.generate.return_value = stream()
        node_repo = factory.create_api_workflow_node_execution_repository.return_value
        node_repo.get_executions_by_workflow_run.return_value = list[object]()
        repo = factory.create_api_workflow_run_repository.return_value
        repo.get_workflow_run_by_id.return_value = _run(graph_dict=native) if native else None
        list(stream())  # apply the deliberate post-execution configuration change
        run = run_mapping.map_run_result({"id": "native", "status": "succeeded", "outputs": {"result": None}}, [])
        run = WorkflowServiceDifyPort()._bind_run(
            (run, _run(graph_dict=native) if native else None),
            "app-1",
            _actor(),
            before,
            WorkflowServiceDifyPort().graph_revision({"nodes": [{"id": "a", "data": {"type": "start"}}], "edges": []}),
        )
    assert run.status == "succeeded"
    assert run.verification is not None
    assert run.verification.terminal_outputs == {"result": None}
    assert run.verification.execution_revision == (before if bound else "")


@pytest.mark.parametrize("stale", [True, False])
def test_publish_verification_locked_guard(mock_session: TrackedPortSession, stale: bool) -> None:
    from services.dify_builder.revision import executable_graph_revision

    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow", workflow_id="old")
    _configure_session_get(mock_session, account=account, app=app)
    draft = _workflow(
        session=mock_session,
    )
    draft.id = "locked-draft"
    mock_session.commit()
    _installed_spy_7 = installed_mock(mock_session.commit)
    _installed_spy_7.reset_mock()
    expected = execution_revision(draft)
    expected_graph = executable_graph_revision(dict(draft.graph_dict))

    def refresh(row: Workflow, *, with_for_update: bool) -> None:
        assert row.id == draft.id
        assert with_for_update
        if stale:
            with Session(mock_session.get_bind()) as writer, writer.begin():
                writer.execute(
                    update(Workflow)
                    .where(Workflow.id == draft.id)
                    .values({Workflow._features: json.dumps({"changed": True})})
                )
        Session.refresh(mock_session, row, with_for_update=with_for_update)

    _installed_spy_8 = installed_mock(mock_session.refresh)
    _installed_spy_8.side_effect = refresh
    with patch("services.dify_builder.dify_port.WorkflowService") as ws:
        ws.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(Workflow, draft.id)
        ws.return_value.publish_workflow.return_value = _published_workflow(id="published", marked_name="v1")
        if stale:
            with pytest.raises(HashMismatchError):
                WorkflowServiceDifyPort().publish(
                    "app-1", _actor(), expected_revision=expected, expected_graph_revision=expected_graph
                )
            ws.return_value.publish_workflow.assert_not_called()
            _installed_spy_16 = installed_mock(mock_session.commit)
            _installed_spy_16.assert_not_called()
            assert app.workflow_id == "old"
        else:
            WorkflowServiceDifyPort().publish(
                "app-1", _actor(), expected_revision=expected, expected_graph_revision=expected_graph
            )
            published_app = mock_session.get(App, app.id)
            assert published_app is not None
            assert published_app.workflow_id == "published"
            _installed_spy_17 = installed_mock(mock_session.commit)
            _installed_spy_17.assert_called_once()
    _installed_spy_9 = installed_mock(mock_session.refresh)
    assert _installed_spy_9.call_count == 1
    _installed_spy_10 = installed_mock(mock_session.refresh)
    assert _installed_spy_10.call_args.args[0].id == draft.id
    _installed_spy_11 = installed_mock(mock_session.refresh)
    assert _installed_spy_11.call_args.kwargs == {"with_for_update": True}
