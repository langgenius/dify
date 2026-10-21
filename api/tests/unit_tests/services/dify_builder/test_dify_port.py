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
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from unittest.mock import patch

import pytest
from sqlalchemy import Engine, update
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.dify_builder.models import Actor, ChangedNode, Graph, MutationIntent, NodeEvent, Run
from models.account import Account
from models.model import App
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowRun
from runtime_contracts.builder.execution import BuilderExecutionContext
from services.dify_builder import run_mapping
from services.dify_builder.application.ports import DifyPort
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.errors import HashMismatchError, WorkflowNotInitializedError
from services.dify_builder.revision import execution_revision
from services.errors.app import WorkflowHashNotEqualError
from tests.unit_tests.services.dify_builder.workflow_stream_fixtures import (
    native_chatflow_payloads,
    native_workflow_payloads,
)


def _workflow(
    *, graph_dict: Graph | None = None, features_dict: Graph | None = None, session: Session | None = None
) -> Workflow:
    row = Workflow(
        tenant_id="tenant-1",
        app_id="app-1",
        type="workflow",
        version=Workflow.VERSION_DRAFT,
        created_by="acc-1",
        graph=json.dumps(graph_dict or {"nodes": [], "edges": []}),
        features=json.dumps(features_dict or {}),
        environment_variables=[],
        conversation_variables=[],
    )
    if session is not None:
        session.add(row)
        session.flush()
        session.commit()
        session.commit.reset_mock()
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
        mode=mode,
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
        triggered_from="workflow-run",
        index=1,
        node_id=node_id,
        node_type=node_type,
        title=title,
        status=status,
        error=error,
        created_by="acc-1",
        created_by_role="account",
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
        type="workflow",
        triggered_from="debugging",
        version="draft",
        created_by="acc-1",
        created_by_role="account",
        status=status,
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
    engine: Engine


class TrackedPortSession(Session):
    exits: int = 0

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.exits += 1
        super().__exit__(exc_type, exc_value, traceback)


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
    session.get.reset_mock()
    session.refresh.reset_mock()
    session.commit.reset_mock()


@pytest.fixture
def mock_session(sqlite_engine, mocker) -> Iterator[TrackedPortSession]:
    with TrackedPortSession(sqlite_engine, expire_on_commit=False) as session:
        for name in ("get", "refresh", "commit"):
            mocker.spy(session, name)
        yield session


@pytest.fixture(autouse=True)
def _mock_db(sqlite_engine, monkeypatch) -> Iterator[None]:
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
def _mock_sessionmaker(mock_session: TrackedPortSession, monkeypatch) -> None:
    monkeypatch.setattr("services.dify_builder.dify_port._session_factory", lambda: lambda: mock_session)


@pytest.fixture(autouse=True)
def _default_draft_for_native_runs(mock_session: TrackedPortSession) -> Iterator[None]:
    # Stream fixtures now also read a real draft to establish launch identity.
    with patch("services.dify_builder.dify_port.WorkflowService") as service:
        service.return_value.get_draft_workflow.return_value = _workflow(
            session=mock_session,
        )
        yield


@pytest.fixture(autouse=True)
def _mock_execution_preparation() -> Iterator[None]:
    """Stream mapping tests isolate admission; real rows/normalization live in test_native_execution_admission."""
    from services.dify_builder.revision import executable_graph_revision
    from tests.unit_tests.core.app.apps.test_builder_execution_admission import context

    def prepare(*, app_id: str, actor: Actor, workflow: Workflow, **_kwargs: object) -> BuilderExecutionContext:
        return context().model_copy(
            update={
                "app_id": app_id,
                "tenant_id": actor.tenant_id,
                "execution_revision": execution_revision(workflow),
                "graph_revision": executable_graph_revision(dict(workflow.graph_dict)),
            }
        )

    with (
        patch("services.dify_builder.dify_port.BuilderExecutionPolicyService") as policy,
        patch("services.dify_builder.dify_port.admitted_node_bindings"),
        patch(
            "services.dify_builder.dify_port.BaseAppGenerator._prepare_user_inputs",
            side_effect=lambda **kw: kw["user_inputs"],
        ),
    ):
        policy.return_value.prepare.side_effect = prepare
        from services.dify_builder.application.execution_policy import ExecutionEvidenceSummary

        policy.return_value.seal.return_value = ExecutionEvidenceSummary(
            request_id="unit-request",
            mode="restricted",
            sealed=True,
            safety_outcome="execution_evidence_unknown",
            sandbox_profile="disabled",
            fixture_digest="a" * 64,
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


# ---- node_outputs --------------------------------------------------------------


def test_node_outputs_maps_executions_and_falls_back_to_empty_dicts(mock_session: TrackedPortSession) -> None:
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, app=app)

    node_exec_with_io = _execution(
        node_id="node-1",
        node_type="code",
        title="Code",
        status="succeeded",
        error=None,
        inputs_dict={"x": 1},
        outputs_dict={"y": 2},
    )
    node_exec_without_io = _execution(
        node_id="node-2",
        node_type="llm",
        title="LLM",
        status="failed",
        error="boom",
        inputs_dict=None,
        outputs_dict=None,
    )

    with patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory:
        mock_node_exec_repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        mock_node_exec_repo.get_executions_by_workflow_run.return_value = [node_exec_with_io, node_exec_without_io]

        outputs = WorkflowServiceDifyPort().node_outputs("app-1", _actor(), "run-1")

    mock_node_exec_repo.get_executions_by_workflow_run.assert_called_once_with("tenant-1", "app-1", "run-1")

    assert len(outputs) == 2

    assert outputs[0].node_id == "node-1"
    assert outputs[0].status == "succeeded"
    assert outputs[0].error == ""
    assert outputs[0].outputs == {"y": 2}

    assert outputs[1].node_id == "node-2"
    assert outputs[1].status == "failed"
    assert outputs[1].error == "boom"
    # None inputs/outputs fall back to {} rather than staying None.
    assert outputs[1].inputs == {}
    assert outputs[1].outputs == {}


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


def test_apply_repair_ignores_unknown_op_intents(mock_session: TrackedPortSession) -> None:
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        session=mock_session,
        graph_dict={"nodes": [{"id": "node-1", "data": {}}], "edges": []},
        features_dict={},
    )
    # Ops the dispatch table doesn't recognize are silently skipped -- this
    # is forward-compat for future verbs, distinct from a *recognized* op
    # with bad args (which raises, see test_apply_repair_dispatches_connect_
    # and_reports_dangling_ref_as_value_error below).
    intents = [MutationIntent(op="some_future_verb", args={"from": "node-1", "to": "node-2"})]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, workflow.id
        )

        result = WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
        )

    assert result.changed_nodes == []
    # No node changed -> no reason to write the draft back: sync_draft_workflow must not
    # be called at all (avoids a wasteful no-op DB write + signal), and the hash returned
    # is simply the one that was read.
    mock_ws_cls.return_value.sync_draft_workflow.assert_not_called()
    assert result.new_hash == execution_revision(workflow)


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


def test_apply_repair_dispatches_create_node(mock_session: TrackedPortSession) -> None:
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        session=mock_session,
        graph_dict={"nodes": [], "edges": []},
        features_dict={},
    )
    updated_workflow = _workflow(
        session=mock_session,
    )
    intents = [MutationIntent(op="create_node", args={"node_type": "llm", "config": {}})]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, workflow.id
        )
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        result = WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
        )

    assert len(result.changed_nodes) == 1
    _, kwargs = mock_ws_cls.return_value.sync_draft_workflow.call_args
    assert len(kwargs["graph"]["nodes"]) == 1
    assert kwargs["graph"]["nodes"][0]["data"]["type"] == "llm"


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


def test_apply_repair_computes_real_diff_changes_and_scope_for_structural_edit(
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
    updated_workflow = _workflow(
        session=mock_session,
    )
    intents = [
        MutationIntent(op="create_node", args={"node_type": "llm", "config": {}, "node_id": "llm-1"}),
        MutationIntent(op="connect", args={"from_node": "a", "to_node": "llm-1"}),
    ]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, workflow.id
        )
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        result = WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
        )

    assert result.scope == "structure"
    assert "＋ llm-1" in result.changes
    assert "＋ a → llm-1" in result.changes
    assert result.nodes == [ChangedNode(node_id="llm-1", title="llm-1"), ChangedNode(node_id="a")]


def test_apply_repair_computes_configuration_scope_for_set_node_config(mock_session: TrackedPortSession) -> None:
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        session=mock_session,
        graph_dict={"nodes": [{"id": "node-1", "data": {"code": "old"}}], "edges": []},
        features_dict={},
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

    assert result.scope == "configuration"
    assert result.changes == ["node-1: code"]
    assert result.nodes == [ChangedNode(node_id="node-1")]


def test_apply_repair_invokes_on_canvas_once_per_applied_intent(mock_session: TrackedPortSession) -> None:
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        session=mock_session,
        graph_dict={"nodes": [{"id": "node-1", "data": {}}], "edges": []},
        features_dict={},
    )
    updated_workflow = _workflow(
        session=mock_session,
    )
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "x"})]
    events: list[Graph] = []

    def on_canvas(event: Graph) -> None:
        assert mock_session.exits == 2
        events.append(event)

    def preflight_before_lock(*_args: object) -> list[str]:
        mock_session.refresh.assert_not_called()
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

    assert events == [{"event": "apply_error_fix", "node_id": "node-1"}]


@pytest.mark.parametrize(
    ("node_type", "expected_event"),
    [
        ("start", "add_start_node"),
        ("knowledge-retrieval", None),
        ("llm", "add_llm_node"),
        ("end", "add_output_node"),
        ("code", "apply_edit_plan"),  # unmapped node type falls back to the generic batch-mutate event
    ],
)
def test_apply_repair_maps_create_node_by_node_type_to_the_right_add_node_event(
    mock_session: TrackedPortSession, node_type: str, expected_event: None | str
) -> None:
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        session=mock_session,
        graph_dict={"nodes": [], "edges": []},
        features_dict={},
    )
    updated_workflow = _workflow(
        session=mock_session,
    )
    intents = [MutationIntent(op="create_node", args={"node_type": node_type, "config": {}})]
    events: list[Graph] = []

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, workflow.id
        )
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        if expected_event is None:
            from services.dify_builder.errors import PreflightError

            with pytest.raises(PreflightError, match="first phase"):
                WorkflowServiceDifyPort().apply_repair(
                    "app-1", _actor(), intents, on_canvas=events.append, expected_revision=execution_revision(workflow)
                )
            assert events == []
            mock_ws_cls.return_value.sync_draft_workflow.assert_not_called()
            return

        WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, on_canvas=events.append, expected_revision=execution_revision(workflow)
        )

    assert events[0]["event"] == expected_event


def test_apply_repair_skips_on_canvas_when_not_provided(mock_session: TrackedPortSession) -> None:
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        session=mock_session,
        graph_dict={"nodes": [{"id": "node-1", "data": {}}], "edges": []},
        features_dict={},
    )
    updated_workflow = _workflow(
        session=mock_session,
    )
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "x"})]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, workflow.id
        )
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        # must not raise even though on_canvas is omitted (default None)
        WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
        )


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

    mock_session.refresh.side_effect = concurrent_edit
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

    mock_session.refresh.side_effect = move_node
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


def test_run_draft_streams_node_events_while_the_run_is_still_going(mock_session: TrackedPortSession) -> None:
    """In-process streaming emits each event while the workflow is running,
    without waiting for a second Celery task or replaying completed rows."""
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    chunks = [
        "event: ping\n\n",
        _sse({"event": "workflow_started", "data": {"id": "run-1"}}),
        _sse({"event": "node_started", "data": {"node_id": "node-1", "title": "Code"}}),
        "ping",
        _sse({"event": "node_finished", "data": {"node_id": "node-1", "title": "Code", "status": "succeeded"}}),
        _sse(_FINISHED_CHUNK),
    ]

    events: list[NodeEvent] = []

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = iter(chunks)
        mock_node_exec_repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        mock_node_exec_repo.get_executions_by_workflow_run.return_value = [_node_exec()]

        run = WorkflowServiceDifyPort().run_draft(
            "app-1", _actor(), {"q": "hi"}, events.append, session_id="session-1", test_input_id="test-1"
        )

    _, kwargs = mock_ags.generate.call_args
    assert kwargs["app_model"].id == app.id
    assert kwargs["user"].id == account.id
    assert kwargs["args"] == {"inputs": {"q": "hi"}}
    assert kwargs["invoke_from"] == InvokeFrom.DEBUGGER
    assert kwargs["streaming"] is True
    assert kwargs["workflow_execution_mode"] == "in_process"
    assert kwargs["session"] is mock_session

    # Ping frames and workflow-level frames produce no node event.
    assert events == [
        NodeEvent(node_id="node-1", title="Code", status="running", error=""),
        NodeEvent(node_id="node-1", title="Code", status="succeeded", error=""),
    ]

    # Frame IDs alone are no longer authority for native linkage.
    mock_node_exec_repo.get_executions_by_workflow_run.assert_not_called()
    assert run.status == "running"
    assert run.dify_run_id == ""
    assert run.verification is not None
    assert run.verification.execution_evidence is not None
    assert run.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"


def test_run_draft_consumes_the_stream_after_the_session_is_closed(mock_session: TrackedPortSession) -> None:
    """``generate`` needs the Session eagerly; iterating the stream does not.

    Pulling chunks inside the ``with`` block would pin a DB connection for the
    whole workflow run, so the loop must sit outside it.
    """
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    session_open_at_pull: list[bool] = []

    def _stream() -> Iterator[str | Graph]:
        for chunk in (
            _sse({"event": "node_started", "data": {"node_id": "node-1", "title": "Code"}}),
            _sse(_FINISHED_CHUNK),
        ):
            session_open_at_pull.append(not bool(mock_session.exits))
            yield chunk

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = _stream()
        repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        repo.get_executions_by_workflow_run.return_value = list[object]()

        WorkflowServiceDifyPort().run_draft(
            "app-1", _actor(), {}, lambda _e: None, session_id="session-1", test_input_id="test-1"
        )

    # generate() itself was called while the session was open...
    assert mock_ags.generate.call_args.kwargs["session"] is mock_session
    # ...but every chunk was pulled after it closed.
    assert session_open_at_pull == [False, False]


def test_run_draft_accepts_raw_mapping_chunks(mock_session: TrackedPortSession) -> None:
    """Defensive: the SSE wrapping layer is not the only shape we tolerate."""
    _configure_default_identity(mock_session)
    seen: list[str] = []

    chunks: list[object] = [
        {"event": "node_started", "data": {"node_id": "n1", "title": "Start"}},
        "ping",
        {"event": "node_finished", "data": {"node_id": "n1", "title": "Start", "status": "succeeded"}},
        {"event": "workflow_finished", "data": {"id": "run-1", "status": "succeeded", "outputs": {}}},
    ]

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = iter(chunks)
        repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        repo.get_executions_by_workflow_run.return_value = list[object]()

        run = WorkflowServiceDifyPort().run_draft(
            "app-1", _actor(), {}, lambda e: seen.append(e.status), session_id="session-1", test_input_id="test-1"
        )

    assert seen == ["running", "succeeded"]
    assert run.status == "running"
    assert run.dify_run_id == ""


@pytest.mark.parametrize("wire_format", ["mapping", "sse"])
@pytest.mark.parametrize("payload_factory", [native_workflow_payloads, native_chatflow_payloads])
def test_run_draft_forwards_full_payloads_synchronously_without_reconstruction(
    mock_session: TrackedPortSession, wire_format: str, payload_factory: Callable[[], list[Graph]]
) -> None:
    _configure_default_identity(mock_session)
    payloads = payload_factory()
    received = []
    summaries = []

    def stream() -> Iterator[str | Graph]:
        yield "event: ping\n\n"
        for payload in payloads:
            yield _sse(payload) if wire_format == "sse" else payload
            assert received[-1] == payload

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as generate,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as repositories,
    ):
        generate.generate.return_value = stream()
        node_repo = repositories.create_api_workflow_node_execution_repository.return_value
        node_repo.get_executions_by_workflow_run.return_value = list[object]()
        WorkflowServiceDifyPort().run_draft(
            "app-1",
            _actor(),
            {},
            summaries.append,
            on_workflow_event=received.append,
            session_id="session-1",
            test_input_id="test-1",
        )

    assert received == payloads
    assert summaries  # Backend progress and diagnosis still receive node summaries.


def test_run_draft_maps_a_paused_stream_to_a_failed_run(mock_session: TrackedPortSession) -> None:
    """``workflow_paused`` carries ``workflow_run_id`` where blocking carried ``id``."""
    _configure_default_identity(mock_session)

    paused = {
        "event": "workflow_paused",
        "workflow_run_id": "run-9",
        "data": {
            "workflow_run_id": "run-9",
            "paused_nodes": ["human-1"],
            "reasons": [{"node_id": "human-1"}],
            "status": "paused",
            "elapsed_time": 2.0,
            "total_tokens": 3,
        },
    }

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = iter([_sse(paused)])
        repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        repo.get_executions_by_workflow_run.return_value = list[object]()

        run = WorkflowServiceDifyPort().run_draft(
            "app-1", _actor(), {}, lambda _e: None, session_id="session-1", test_input_id="test-1"
        )

    repo.get_executions_by_workflow_run.assert_not_called()
    assert run.status == "running"
    assert run.dify_run_id == ""


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


def test_a_truncated_stream_reports_a_real_database_failure_as_failed(mock_session: TrackedPortSession) -> None:
    """The flip side: a genuine failure recovered from the row still reads failed."""
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
            id="run-1", status="failed", error="node blew up", elapsed_time=1.0, total_tokens=1
        )

        run, _ = WorkflowServiceDifyPort()._finish_run("tenant-1", "app-1", {}, "run-1")

    assert run.status == "failed"
    assert run.dify_run_id == "run-1"


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


def test_a_truncated_stream_with_no_run_row_is_unknown_not_failed(mock_session: TrackedPortSession) -> None:
    _configure_default_identity(mock_session)

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = iter(_truncated_stream())
        node_repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        node_repo.get_executions_by_workflow_run.return_value = list[object]()
        run_repo = mock_repo_factory.create_api_workflow_run_repository.return_value
        run_repo.get_workflow_run_by_id.return_value = None

        run, _ = WorkflowServiceDifyPort()._finish_run("tenant-1", "app-1", {}, "run-1")

    assert run.status == "running"
    assert run.error == run_mapping.TRUNCATED_STREAM_ERROR


def test_a_stream_of_nothing_but_keep_alives_is_unknown_not_failed(mock_session: TrackedPortSession) -> None:
    """No frame ever carried a run id, so there is nothing to look up."""
    _configure_default_identity(mock_session)

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = iter(["event: ping\n\n"])
        node_repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        run_repo = mock_repo_factory.create_api_workflow_run_repository.return_value

        run = WorkflowServiceDifyPort().run_draft(
            "app-1", _actor(), {}, lambda _e: None, session_id="session-1", test_input_id="test-1"
        )

    node_repo.get_executions_by_workflow_run.assert_not_called()
    run_repo.get_workflow_run_by_id.assert_not_called()
    assert run.status == "running"
    assert run.status != "failed"
    assert run.error == run_mapping.TRUNCATED_STREAM_ERROR
    assert run.dify_run_id == ""


def test_run_draft_closes_the_stream_when_the_callback_raises(mock_session: TrackedPortSession) -> None:
    """Streaming only releases the app's rate-limit slot on close()."""
    _configure_default_identity(mock_session)

    closed = []

    def response_stream():
        try:
            yield _sse({"event": "node_started", "data": {"node_id": "n1", "title": "S"}})
        finally:
            closed.append(True)

    response = response_stream()

    def _boom(_event: NodeEvent) -> None:
        raise RuntimeError("callback exploded")

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory"),
    ):
        mock_ags.generate.return_value = response
        with pytest.raises(RuntimeError, match="callback exploded"):
            WorkflowServiceDifyPort().run_draft(
                "app-1", _actor(), {}, _boom, session_id="session-1", test_input_id="test-1"
            )

    assert closed == [True]


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
        mock_session.commit.reset_mock()
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
    assert publish.call_args.kwargs["expected_draft_id"] == draft.id
    stored_app = mock_session.get(App, app.id)
    assert stored_app.workflow_id == "new-wf-id"
    # Publish must also advance the app's audit fields -- mirrors the console idiom at
    # controllers/console/app/workflow.py (~1315) so publishing via the dify_builder leaves the
    # same trail as publishing via the console UI.
    assert stored_app.updated_by == "acc-1"
    assert stored_app.updated_at == datetime(2026, 10, 20, 12)
    assert result.version_name == "# 2"
    assert result.status == "live"
    mock_session.commit.assert_called_once()


# ---- Protocol conformance --------------------------------------------------


def test_workflow_service_dify_port_conforms_to_dify_port_protocol() -> None:
    assert isinstance(WorkflowServiceDifyPort(), DifyPort)


def test_run_draft_reads_a_blocking_dict_response(mock_session: TrackedPortSession) -> None:
    """AppGenerateService.generate(streaming=False) returns a DICT, not a
    stream. Iterating it yields its KEYS as strings -- probed live against the
    real service:

        response type: dict
        [1] raw=str -> stream_chunk_as_mapping=None  'task_id'
        [2] raw=str -> stream_chunk_as_mapping=None  'workflow_run_id'
        [3] raw=str -> stream_chunk_as_mapping=None  'data'

    so no run id and no terminal frame were ever found and every Builder test
    run was recorded status=running with an empty dify_run_id, bouncing the
    user back to build.execution forever. The pre-3838db8aa7 code read
    ``response["data"]`` directly; the streaming rewrite dropped that path.
    """
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    blocking_response = {
        "task_id": "task-1",
        "workflow_run_id": "run-1",
        "data": dict(_FINISHED_CHUNK["data"]),
    }

    events: list[NodeEvent] = []

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = blocking_response
        mock_node_exec_repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        mock_node_exec_repo.get_executions_by_workflow_run.return_value = [_node_exec()]

        run = WorkflowServiceDifyPort().run_draft(
            "app-1", _actor(), {"q": "hi"}, events.append, session_id="session-1", test_input_id="test-1"
        )

    assert run.status == "running"
    assert run.dify_run_id == ""
    assert run.per_node == []


def test_run_draft_does_not_enqueue_a_second_celery_task(mock_session: TrackedPortSession) -> None:
    """The Builder owns a Celery slot, so it must request in-process streaming.
    Default streaming dispatches a child task and deadlocks when all slots are
    occupied by Builder tasks waiting for their children."""
    account = _account(id="acc-1")
    app = _app(id="app-1", tenant_id="tenant-1", mode="workflow")
    _configure_session_get(mock_session, account=account, app=app)

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = iter([_sse(_FINISHED_CHUNK)])
        node_repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        node_repo.get_executions_by_workflow_run.return_value = list[object]()
        WorkflowServiceDifyPort().run_draft(
            "app-1", _actor(), {}, lambda _e: None, session_id="session-1", test_input_id="test-1"
        )

    _, kwargs = mock_ags.generate.call_args
    assert kwargs["streaming"] is True
    assert kwargs["workflow_execution_mode"] == "in_process", (
        "Builder streaming must execute in process to avoid waiting for a second Celery worker slot"
    )


# ---- run_draft: an explicit error frame is a FAILED run, not an unknown one ----


# (ESQ1-302) The frame below is the exact one the session received four times
# (trace seq 52); until this fix the stream ended without a terminal frame, the
# run mapped to "running", and the handler bounced the user back to re-run.

ESQ1_302_ERROR_FRAME = {
    "event": "error",
    "workflow_run_id": None,
    "code": "invalid_param",
    "status": 400,
    "message": (
        "2 validation errors for HttpRequestNodeData\nbody.data.0.type\n  Field required "
        "[type=missing, input_value={'value': '{{#node3.text#}}', 'key': 'slides'}, input_type=dict]\n"
        "    For further information visit https://errors.pydantic.dev/2.12/v/missing\nbody.data.1.type\n"
        "  Field required [type=missing, input_value={'value': '{{#node1.outpu...#}}', 'key': 'filename'}, "
        "input_type=dict]\n    For further information visit https://errors.pydantic.dev/2.12/v/missing"
    ),
}


def _run_stream(
    chunks: Sequence[str | Graph], *, node_execs: list[object] | None = None, run_row: object | None = None
) -> tuple[Run, list[Mapping[str, object]], TrackedPortSession]:
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


def test_the_esq1_302_launch_error_frame_is_a_failed_run_carrying_the_message(mock_session: TrackedPortSession) -> None:
    _configure_default_identity(mock_session)

    run, forwarded, node_repo = _run_stream([_sse(ESQ1_302_ERROR_FRAME)])

    assert run.status == "failed"
    assert run.dify_run_id == ""  # the frame arrived before workflow_started: no run exists
    assert run.per_node == []
    assert "body.data.0.type Field required" in run.error
    assert run.error.endswith("[invalid_param]")
    assert forwarded[0]["event"] == "error"  # the frontend still receives the frame unchanged
    node_repo.get_executions_by_workflow_run.assert_not_called()  # no run id -> nothing to read


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


def test_an_error_frame_never_overrides_a_terminal_success_frame(mock_session: TrackedPortSession) -> None:
    _configure_default_identity(mock_session)
    chunks = [
        _sse({"event": "workflow_started", "workflow_run_id": "run-3", "data": {"id": "run-3"}}),
        _sse({"event": "error", "workflow_run_id": "run-3", "code": "x", "status": 500, "message": "spurious"}),
        _sse(_FINISHED_CHUNK),
    ]

    run, _, _ = _run_stream(chunks)

    assert run.status == "succeeded"
    assert run.error == ""


def test_no_terminal_frame_and_no_error_frame_is_still_unknown(mock_session: TrackedPortSession) -> None:
    _configure_default_identity(mock_session)

    run, _, _ = _run_stream(["event: ping\n\n", "ping"])

    assert run.status == "running"
    assert run.error == run_mapping.TRUNCATED_STREAM_ERROR


@pytest.mark.parametrize("custom", [{}, {"query": "custom Start query", "file": {"id": "file-1"}}])
def test_chatflow_is_unsupported_even_with_valid_system_message(
    mock_session: TrackedPortSession, custom: Graph
) -> None:
    _configure_session_get(
        mock_session,
        account=_account(id="acc-1"),
        app=_app(id="app-1", tenant_id="tenant-1", mode="advanced-chat"),
    )
    inputs = {**custom, "sys.query": "User system message"}
    with patch("services.dify_builder.dify_port.AppGenerateService") as generate:
        generate.generate.return_value = {"data": dict(_FINISHED_CHUNK["data"])}
        with patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory"):
            run = WorkflowServiceDifyPort().run_draft(
                "app-1", _actor(), inputs, lambda _event: None, session_id="session-1", test_input_id="test-1"
            )
    assert run.execution_refusal is not None
    assert run.execution_refusal.reason_code == "unsupported_workflow"
    assert run.dify_run_id == ""
    generate.generate.assert_not_called()
    assert inputs == {**custom, "sys.query": "User system message"}


@pytest.mark.parametrize(
    "inputs", [{}, {"sys.query": ""}, {"sys.query": "  "}, {"sys.query": 1}, {"query": "only Start query"}]
)
def test_chatflow_rejects_invalid_system_query_before_native_launch(
    mock_session: TrackedPortSession, inputs: Graph
) -> None:
    _configure_session_get(
        mock_session,
        account=_account(id="acc-1"),
        app=_app(id="app-1", tenant_id="tenant-1", mode="advanced-chat"),
    )
    with patch("services.dify_builder.dify_port.AppGenerateService") as generate:
        run = WorkflowServiceDifyPort().run_draft(
            "app-1", _actor(), inputs, lambda _event: None, session_id="session-1", test_input_id="test-1"
        )
        assert run.execution_refusal is not None
    assert run.execution_refusal.reason_code == "unsupported_workflow"
    generate.generate.assert_not_called()


def test_workflow_keeps_query_as_an_ordinary_start_input(mock_session: TrackedPortSession) -> None:
    _configure_session_get(
        mock_session,
        account=_account(id="acc-1"),
        app=_app(id="app-1", tenant_id="tenant-1", mode="workflow"),
    )
    with patch("services.dify_builder.dify_port.AppGenerateService") as generate:
        generate.generate.return_value = {"data": dict(_FINISHED_CHUNK["data"])}
        with patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory"):
            WorkflowServiceDifyPort().run_draft(
                "app-1",
                _actor(),
                {"query": "custom"},
                lambda _event: None,
                session_id="session-1",
                test_input_id="test-1",
            )
    assert generate.generate.call_args.kwargs["args"] == {"inputs": {"query": "custom"}}


def test_get_app_mode_reads_persisted_tenant_scoped_app(mock_session: TrackedPortSession) -> None:
    _configure_session_get(mock_session, app=_app(tenant_id="tenant-1", mode="advanced-chat"))
    assert WorkflowServiceDifyPort().get_app_mode("app-1", _actor()) == "advanced-chat"
    _configure_session_get(mock_session, app=_app(tenant_id="other-tenant", mode="workflow"))
    from core.dify_builder.errors import NotFoundError

    with pytest.raises(NotFoundError):
        WorkflowServiceDifyPort().get_app_mode("app-1", _actor())


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
        workflow.graph_dict
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
    mock_session.commit.reset_mock()
    expected = execution_revision(draft)
    expected_graph = executable_graph_revision(dict(draft.graph_dict))

    def refresh(row: Workflow, *, with_for_update: bool) -> None:
        assert row.id == draft.id
        assert with_for_update
        if stale:
            with Session(mock_session.get_bind()) as writer, writer.begin():
                writer.execute(
                    update(Workflow).where(Workflow.id == draft.id).values(_features=json.dumps({"changed": True}))
                )
        Session.refresh(mock_session, row, with_for_update=with_for_update)

    mock_session.refresh.side_effect = refresh
    with patch("services.dify_builder.dify_port.WorkflowService") as ws:
        ws.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(Workflow, draft.id)
        ws.return_value.publish_workflow.return_value = _published_workflow(id="published", marked_name="v1")
        if stale:
            with pytest.raises(HashMismatchError):
                WorkflowServiceDifyPort().publish(
                    "app-1", _actor(), expected_revision=expected, expected_graph_revision=expected_graph
                )
            ws.return_value.publish_workflow.assert_not_called()
            mock_session.commit.assert_not_called()
            assert app.workflow_id == "old"
        else:
            WorkflowServiceDifyPort().publish(
                "app-1", _actor(), expected_revision=expected, expected_graph_revision=expected_graph
            )
            assert ws.return_value.publish_workflow.call_args.kwargs["expected_draft_id"] == "locked-draft"
            assert mock_session.get(App, app.id).workflow_id == "published"
            mock_session.commit.assert_called_once()
    assert mock_session.refresh.call_count == 1
    assert mock_session.refresh.call_args.args[0].id == draft.id
    assert mock_session.refresh.call_args.kwargs == {"with_for_update": True}


@pytest.mark.parametrize(
    ("consent_id", "command_id"), [("consent-1", None), (None, "command-1"), ("", None), ("consent-1", "")]
)
def test_confirmed_run_requires_both_server_reserved_identifiers_together(
    mock_session: TrackedPortSession, consent_id: str | None, command_id: str | None
) -> None:
    with patch("services.dify_builder.dify_port.AppGenerateService.generate") as generate:
        run = WorkflowServiceDifyPort().run_draft(
            "app-1",
            _actor(),
            {},
            lambda _event: None,
            session_id="session-1",
            test_input_id="input-1",
            confirmed_consent_id=consent_id,
            command_id=command_id,
        )
    generate.assert_not_called()
    mock_session.get.assert_not_called()
    assert run.status == "failed"
    assert run.execution_refusal is not None
    assert run.execution_refusal.reason_code == "confirmed_launch_incomplete"
    assert run.dify_run_id == ""


def test_port_protocol_declares_the_optional_confirmed_pair() -> None:
    import inspect

    for owner in (DifyPort, WorkflowServiceDifyPort):
        parameters = inspect.signature(owner.run_draft).parameters
        for name in ("confirmed_consent_id", "command_id"):
            assert parameters[name].kind is inspect.Parameter.KEYWORD_ONLY
            assert parameters[name].default is None
