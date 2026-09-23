"""Tests for the real ``DifyPort`` adapter -- ``WorkflowServiceDifyPort``.

These mock every OSS service the adapter touches (``WorkflowService``,
``AppGenerateService``, ``DifyAPIRepositoryFactory``, and the
``sessionmaker``/``db`` plumbing) -- no real DB, no real workflow execution.
The goal is to pin the adapter's ORCHESTRATION and the P2 plan's OSS gotchas:

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
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.dify_builder.models import Actor, ChangedNode, MutationIntent, NodeEvent
from core.dify_builder.ports import DifyPort
from models.account import Account
from models.model import App
from models.workflow import Workflow
from services.dify_builder import run_mapping
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.errors import HashMismatchError, WorkflowNotInitializedError
from services.dify_builder.revision import execution_revision
from services.errors.app import WorkflowHashNotEqualError
from tests.unit_tests.services.dify_builder.workflow_stream_fixtures import (
    native_chatflow_payloads,
    native_workflow_payloads,
)


def _workflow(*, graph_dict: dict | None = None, features_dict: dict | None = None) -> Workflow:
    return Workflow(
        tenant_id="tenant-1",
        graph=json.dumps(graph_dict or {"nodes": [], "edges": []}),
        features=json.dumps(features_dict or {}),
        environment_variables=[],
        conversation_variables=[],
    )


def _actor() -> Actor:
    return Actor(account_id="acc-1", tenant_id="tenant-1")


def _configure_session_get(session: MagicMock, *, account=None, app=None) -> None:
    def _get(model, _id):
        if model is Account:
            return account
        if model is App:
            return app
        return None

    session.get.side_effect = _get


@pytest.fixture
def mock_session() -> MagicMock:
    """A ``MagicMock`` usable as a ``with session_factory() as session:`` context manager."""
    session = MagicMock()
    session.__enter__.return_value = session
    session.__exit__.return_value = False
    return session


@pytest.fixture(autouse=True)
def _mock_db():
    with patch("services.dify_builder.dify_port.db"), patch("services.dify_builder.dify_port.set_login_user"):
        yield


@pytest.fixture(autouse=True)
def _skip_preflight():
    """``apply_repair`` dry-validates the mutated graph
    (``new_preflight_problems``). The ``apply_repair`` tests in THIS module build
    nodes from bare ``config={}`` stand-ins that are not valid node data, so the
    check is bypassed here; ``test_dify_port_preflight.py`` exercises the real
    one."""
    with patch("services.dify_builder.dify_port.new_preflight_problems", return_value=[]):
        yield


@pytest.fixture(autouse=True)
def _mock_sessionmaker(mock_session: MagicMock):
    """Every ``sessionmaker(...)`` call in the adapter yields ``mock_session``."""
    with patch("services.dify_builder.dify_port.sessionmaker") as mock_sessionmaker_ctor:
        mock_sessionmaker_ctor.return_value = MagicMock(return_value=mock_session)
        yield mock_sessionmaker_ctor


# ---- read_graph --------------------------------------------------------------


def test_read_graph_returns_graph_and_execution_revision(mock_session: MagicMock):
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, app=app)
    workflow = _workflow(graph_dict={"nodes": [], "edges": []})

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow

        graph, unique_hash = WorkflowServiceDifyPort().read_graph("app-1", _actor())

    assert graph == {"nodes": [], "edges": []}
    assert unique_hash == execution_revision(workflow)
    assert unique_hash != workflow.unique_hash
    mock_ws_cls.return_value.get_draft_workflow.assert_called_once_with(app, session=mock_session)


def test_read_graph_raises_when_no_draft_workflow(mock_session: MagicMock):
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, app=app)

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = None

        with pytest.raises(WorkflowNotInitializedError):
            WorkflowServiceDifyPort().read_graph("app-1", _actor())


# ---- node_outputs --------------------------------------------------------------


def test_node_outputs_maps_executions_and_falls_back_to_empty_dicts(mock_session: MagicMock):
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, app=app)

    node_exec_with_io = SimpleNamespace(
        node_id="node-1",
        node_type="code",
        title="Code",
        status="succeeded",
        error=None,
        inputs_dict={"x": 1},
        outputs_dict={"y": 2},
    )
    node_exec_without_io = SimpleNamespace(
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


def test_apply_repair_syncs_mutated_graph_with_graph_only_and_no_agent_binding_sync(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    original_graph = {"nodes": [{"id": "node-1", "data": {"code": "old"}}], "edges": []}
    workflow = _workflow(
        graph_dict=original_graph,
        features_dict={"feature": True},
    )
    updated_workflow = _workflow()
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "new"})]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
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
    assert kwargs["account"] is account
    assert kwargs["app_model"] is app
    assert kwargs["session"] is mock_session

    mutated_node = next(n for n in kwargs["graph"]["nodes"] if n["id"] == "node-1")
    assert mutated_node["data"]["code"] == "new"
    # The workflow's own graph_dict is untouched -- apply_set_node_config deep-copies.
    assert original_graph["nodes"][0]["data"]["code"] == "old"


def test_apply_repair_ignores_unknown_op_intents(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        graph_dict={"nodes": [{"id": "node-1", "data": {}}], "edges": []},
        features_dict={},
    )
    # Ops the dispatch table doesn't recognize are silently skipped -- this
    # is forward-compat for future verbs, distinct from a *recognized* op
    # with bad args (which raises, see test_apply_repair_dispatches_connect_
    # and_reports_dangling_ref_as_value_error below).
    intents = [MutationIntent(op="some_future_verb", args={"from": "node-1", "to": "node-2"})]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow

        result = WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
        )

    assert result.changed_nodes == []
    # No node changed -> no reason to write the draft back: sync_draft_workflow must not
    # be called at all (avoids a wasteful no-op DB write + signal), and the hash returned
    # is simply the one that was read.
    mock_ws_cls.return_value.sync_draft_workflow.assert_not_called()
    assert result.new_hash == execution_revision(workflow)


def test_apply_repair_maps_hash_mismatch_to_domain_error(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        graph_dict={"nodes": [{"id": "node-1", "data": {}}], "edges": []},
        features_dict={},
    )
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "x"})]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.side_effect = WorkflowHashNotEqualError()

        with pytest.raises(HashMismatchError):
            WorkflowServiceDifyPort().apply_repair(
                "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
            )


def test_apply_repair_dispatches_create_node(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        graph_dict={"nodes": [], "edges": []},
        features_dict={},
    )
    updated_workflow = _workflow()
    intents = [MutationIntent(op="create_node", args={"node_type": "llm", "config": {}})]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        result = WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
        )

    assert len(result.changed_nodes) == 1
    _, kwargs = mock_ws_cls.return_value.sync_draft_workflow.call_args
    assert len(kwargs["graph"]["nodes"]) == 1
    assert kwargs["graph"]["nodes"][0]["data"]["type"] == "llm"


def test_apply_repair_dispatches_connect_and_reports_dangling_ref_as_value_error(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        graph_dict={"nodes": [{"id": "a", "data": {}}], "edges": []},
        features_dict={},
    )
    intents = [MutationIntent(op="connect", args={"from_node": "a", "to_node": "missing"})]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow

        with pytest.raises(ValueError):
            WorkflowServiceDifyPort().apply_repair(
                "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
            )


def test_apply_repair_computes_real_diff_changes_and_scope_for_structural_edit(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        graph_dict={"nodes": [{"id": "a", "data": {}}], "edges": []},
        features_dict={},
    )
    updated_workflow = _workflow()
    intents = [
        MutationIntent(op="create_node", args={"node_type": "llm", "config": {}, "node_id": "llm-1"}),
        MutationIntent(op="connect", args={"from_node": "a", "to_node": "llm-1"}),
    ]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        result = WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
        )

    assert result.scope == "structure"
    assert "added node llm-1" in result.changes
    assert "added a → llm-1" in result.changes
    assert result.nodes == [ChangedNode(node_id="llm-1", title="llm-1"), ChangedNode(node_id="a")]


def test_apply_repair_computes_configuration_scope_for_set_node_config(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        graph_dict={"nodes": [{"id": "node-1", "data": {"code": "old"}}], "edges": []},
        features_dict={},
    )
    updated_workflow = _workflow()
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "new"})]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        result = WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
        )

    assert result.scope == "configuration"
    assert result.changes == ["node-1: code updated"]
    assert result.nodes == [ChangedNode(node_id="node-1")]


def test_apply_repair_invokes_on_canvas_once_per_applied_intent(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        graph_dict={"nodes": [{"id": "node-1", "data": {}}], "edges": []},
        features_dict={},
    )
    updated_workflow = _workflow()
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "x"})]
    events: list[dict] = []

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, on_canvas=events.append, expected_revision=execution_revision(workflow)
        )

    assert events == [{"event": "apply_error_fix", "node_id": "node-1"}]


@pytest.mark.parametrize(
    ("node_type", "expected_event"),
    [
        ("start", "add_start_node"),
        ("knowledge-retrieval", "add_knowledge_node"),
        ("llm", "add_llm_node"),
        ("end", "add_output_node"),
        ("code", "apply_edit_plan"),  # unmapped node type falls back to the generic batch-mutate event
    ],
)
def test_apply_repair_maps_create_node_by_node_type_to_the_right_add_node_event(
    mock_session: MagicMock, node_type, expected_event
):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        graph_dict={"nodes": [], "edges": []},
        features_dict={},
    )
    updated_workflow = _workflow()
    intents = [MutationIntent(op="create_node", args={"node_type": node_type, "config": {}})]
    events: list[dict] = []

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, on_canvas=events.append, expected_revision=execution_revision(workflow)
        )

    assert events[0]["event"] == expected_event


def test_apply_repair_skips_on_canvas_when_not_provided(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = _workflow(
        graph_dict={"nodes": [{"id": "node-1", "data": {}}], "edges": []},
        features_dict={},
    )
    updated_workflow = _workflow()
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "x"})]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        # must not raise even though on_canvas is omitted (default None)
        WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
        )


def test_apply_repair_skips_already_present_create_and_connect(mock_session: MagicMock):
    """A fix.apply Retry re-applies the SAME intents against an already-mutated
    draft. create_node for a present id and connect for a present edge must be
    dropped (no duplicate, no ValueError); set_node_config still applies."""
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
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
        graph_dict=existing_graph,
        features_dict={},
    )
    intents = [
        MutationIntent(op="create_node", args={"node_type": "llm", "node_id": "llm_1", "config": {"title": "new"}}),
        MutationIntent(op="connect", args={"from_node": "start_1", "to_node": "llm_1"}),
    ]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow

        result = WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
        )

    # Both intents were already present -> filtered -> no changes -> no-op ApplyResult, no ValueError.
    assert result.changed_nodes == []
    assert result.new_hash == execution_revision(workflow)
    mock_ws_cls.return_value.sync_draft_workflow.assert_not_called()


def test_apply_repair_survives_delete_and_recreate_of_same_id_in_one_batch(mock_session: MagicMock):
    """A from-scratch build (handlers_build.handle_plan_approval) sends
    delete_node(placeholder_start) + create_node(same id) in ONE batch, to
    replace the canvas's default placeholder start with the generator's own
    start node of the same id. The already-present filter above must NOT
    treat "start" as already-present just because it's in before_graph --
    that would drop the create_node while the delete_node still runs,
    deleting the start node with no re-create, and the subsequent connect
    would then raise ValueError('node not found: start')."""
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    # Draft has only the canvas's default placeholder start node "start".
    existing_graph = {
        "nodes": [{"id": "start", "data": {"type": "start"}}],
        "edges": [],
    }
    workflow = _workflow(
        graph_dict=existing_graph,
        features_dict={},
    )
    updated_workflow = _workflow()
    intents = [
        MutationIntent(op="delete_node", args={"node_id": "start"}),
        MutationIntent(op="create_node", args={"node_type": "start", "node_id": "start", "config": {}}),
        MutationIntent(op="create_node", args={"node_type": "llm", "node_id": "llm_1", "config": {}}),
        MutationIntent(op="connect", args={"from_node": "start", "to_node": "llm_1"}),
    ]

    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
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


@pytest.mark.parametrize("operation", ["apply", "restore"])
def test_mutations_recheck_execution_revision_after_locking(mock_session: MagicMock, operation: str):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)
    workflow = _workflow(graph_dict={"nodes": [{"id": "node-1", "data": {"code": "old"}}], "edges": []})
    expected = execution_revision(workflow)

    def concurrent_edit(_workflow, *, with_for_update):
        assert with_for_update is True
        workflow.graph = json.dumps({"nodes": [{"id": "node-1", "data": {"code": "human edit"}}], "edges": []})

    mock_session.refresh.side_effect = concurrent_edit
    events = []
    with patch("services.dify_builder.dify_port.WorkflowService") as service:
        service.return_value.get_draft_workflow.return_value = workflow
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
        else:
            with pytest.raises(HashMismatchError, match="execution configuration changed"):
                port.restore_graph("app-1", _actor(), {"nodes": [], "edges": []}, expected_revision=expected)
        service.return_value.sync_draft_workflow.assert_not_called()
    assert events == []
    assert workflow.graph_dict["nodes"][0]["data"]["code"] == "human edit"


def test_repair_preserves_layout_committed_while_builder_was_planning(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)
    workflow = _workflow(
        graph_dict={
            "nodes": [
                {"id": "node-1", "type": "custom", "data": {"type": "code", "code": "old"}},
                {"id": "end", "type": "custom", "data": {"type": "end"}},
            ],
            "edges": [{"id": "node-1-end", "source": "node-1", "target": "end", "type": "custom"}],
        }
    )
    expected = execution_revision(workflow)

    def move_node(_workflow, *, with_for_update):
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

    mock_session.refresh.side_effect = move_node
    with patch("services.dify_builder.dify_port.WorkflowService") as service:
        service.return_value.get_draft_workflow.return_value = workflow

        def sync_graph(**kwargs):
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

    assert workflow.graph_dict["nodes"][0]["position"] == {"x": 900, "y": 500}
    assert workflow.graph_dict["nodes"][0]["data"]["code"] == "AI edit"
    assert workflow.graph_dict["edges"][0]["data"]["sourceType"] == "code"
    assert workflow.graph_dict["viewport"]["zoom"] == 2
    assert result.new_hash == execution_revision(workflow)
    assert result.new_hash != expected


# ---- run_draft --------------------------------------------------------------


def _sse(chunk: dict) -> str:
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


def _configure_default_identity(session: MagicMock) -> None:
    _configure_session_get(
        session, account=SimpleNamespace(id="acc-1"), app=SimpleNamespace(id="app-1", tenant_id="tenant-1")
    )


def _node_exec() -> SimpleNamespace:
    return SimpleNamespace(
        node_id="node-1",
        node_type="code",
        title="Code",
        status="succeeded",
        error=None,
        inputs_dict={},
        outputs_dict={"x": 1},
    )


def test_run_draft_streams_node_events_while_the_run_is_still_going(mock_session: MagicMock):
    """In-process streaming emits each event while the workflow is running,
    without waiting for a second Celery task or replaying completed rows."""
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
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

        run = WorkflowServiceDifyPort().run_draft("app-1", _actor(), {"q": "hi"}, events.append)

    _, kwargs = mock_ags.generate.call_args
    assert kwargs["app_model"] is app
    assert kwargs["user"] is account
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

    # The node-execution read stays: map_run_result needs it for per_node outputs.
    mock_node_exec_repo.get_executions_by_workflow_run.assert_called_once_with("tenant-1", "app-1", "run-1")
    assert run.status == "succeeded"
    assert run.dify_run_id == "run-1"
    assert run.per_node[0].node_id == "node-1"
    assert run.per_node[0].outputs == {"x": 1}


def test_run_draft_consumes_the_stream_after_the_session_is_closed(mock_session: MagicMock):
    """``generate`` needs the Session eagerly; iterating the stream does not.

    Pulling chunks inside the ``with`` block would pin a DB connection for the
    whole workflow run, so the loop must sit outside it.
    """
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    session_open_at_pull: list[bool] = []

    def _stream():
        for chunk in (
            _sse({"event": "node_started", "data": {"node_id": "node-1", "title": "Code"}}),
            _sse(_FINISHED_CHUNK),
        ):
            session_open_at_pull.append(not mock_session.__exit__.called)
            yield chunk

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = _stream()
        repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        repo.get_executions_by_workflow_run.return_value = []

        WorkflowServiceDifyPort().run_draft("app-1", _actor(), {}, lambda _e: None)

    # generate() itself was called while the session was open...
    assert mock_ags.generate.call_args.kwargs["session"] is mock_session
    # ...but every chunk was pulled after it closed.
    assert session_open_at_pull == [False, False]


def test_run_draft_accepts_raw_mapping_chunks(mock_session: MagicMock):
    """Defensive: the SSE wrapping layer is not the only shape we tolerate."""
    _configure_default_identity(mock_session)
    seen: list[str] = []

    chunks = [
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
        repo.get_executions_by_workflow_run.return_value = []

        run = WorkflowServiceDifyPort().run_draft("app-1", _actor(), {}, lambda e: seen.append(e.status))

    assert seen == ["running", "succeeded"]
    assert run.status == "succeeded"
    assert run.dify_run_id == "run-1"


@pytest.mark.parametrize("wire_format", ["mapping", "sse"])
@pytest.mark.parametrize("payload_factory", [native_workflow_payloads, native_chatflow_payloads])
def test_run_draft_forwards_full_payloads_synchronously_without_reconstruction(
    mock_session: MagicMock, wire_format, payload_factory
):
    _configure_default_identity(mock_session)
    payloads = payload_factory()
    received = []
    summaries = []

    def stream():
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
        node_repo.get_executions_by_workflow_run.return_value = []
        WorkflowServiceDifyPort().run_draft("app-1", _actor(), {}, summaries.append, on_workflow_event=received.append)

    assert received == payloads
    assert summaries  # Backend progress and diagnosis still receive node summaries.


def test_run_draft_maps_a_paused_stream_to_a_failed_run(mock_session: MagicMock):
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
        repo.get_executions_by_workflow_run.return_value = []

        run = WorkflowServiceDifyPort().run_draft("app-1", _actor(), {}, lambda _e: None)

    repo.get_executions_by_workflow_run.assert_called_once_with("tenant-1", "app-1", "run-9")
    assert run.status == "failed"
    assert run.dify_run_id == "run-9"


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


def test_a_truncated_stream_reports_the_runs_real_status_from_the_database(mock_session: MagicMock):
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
        run_repo.get_workflow_run_by_id.return_value = SimpleNamespace(
            id="run-1", status="succeeded", error=None, elapsed_time=361.0, total_tokens=99
        )

        run = WorkflowServiceDifyPort().run_draft("app-1", _actor(), {}, lambda _e: None)

    # The run id came off a non-terminal frame, so both reads could still happen.
    node_repo.get_executions_by_workflow_run.assert_called_once_with("tenant-1", "app-1", "run-1")
    run_repo.get_workflow_run_by_id.assert_called_once_with(tenant_id="tenant-1", app_id="app-1", run_id="run-1")
    assert run.status == "succeeded"
    assert run.error == ""
    assert run.dify_run_id == "run-1"
    assert run.tokens == 99
    assert run.per_node[0].node_id == "node-1"


def test_a_truncated_stream_reports_a_real_database_failure_as_failed(mock_session: MagicMock):
    """The flip side: a genuine failure recovered from the row still reads failed."""
    _configure_default_identity(mock_session)

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = iter(_truncated_stream())
        node_repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        node_repo.get_executions_by_workflow_run.return_value = []
        run_repo = mock_repo_factory.create_api_workflow_run_repository.return_value
        run_repo.get_workflow_run_by_id.return_value = SimpleNamespace(
            id="run-1", status="failed", error="node blew up", elapsed_time=1.0, total_tokens=1
        )

        run = WorkflowServiceDifyPort().run_draft("app-1", _actor(), {}, lambda _e: None)

    assert run.status == "failed"
    assert run.dify_run_id == "run-1"


def test_a_truncated_stream_over_a_still_running_run_is_unknown_not_failed(mock_session: MagicMock):
    """Outcome genuinely unknown -> "running" + a visible reason, never "failed"."""
    _configure_default_identity(mock_session)

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = iter(_truncated_stream())
        node_repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        node_repo.get_executions_by_workflow_run.return_value = []
        run_repo = mock_repo_factory.create_api_workflow_run_repository.return_value
        run_repo.get_workflow_run_by_id.return_value = SimpleNamespace(
            id="run-1", status="running", error=None, elapsed_time=300.0, total_tokens=5
        )

        run = WorkflowServiceDifyPort().run_draft("app-1", _actor(), {}, lambda _e: None)

    assert run.status == "running"
    assert run.status != "failed"
    assert run.error == run_mapping.TRUNCATED_STREAM_ERROR
    assert run.dify_run_id == "run-1"


def test_a_truncated_stream_with_no_run_row_is_unknown_not_failed(mock_session: MagicMock):
    _configure_default_identity(mock_session)

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = iter(_truncated_stream())
        node_repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        node_repo.get_executions_by_workflow_run.return_value = []
        run_repo = mock_repo_factory.create_api_workflow_run_repository.return_value
        run_repo.get_workflow_run_by_id.return_value = None

        run = WorkflowServiceDifyPort().run_draft("app-1", _actor(), {}, lambda _e: None)

    assert run.status == "running"
    assert run.error == run_mapping.TRUNCATED_STREAM_ERROR


def test_a_stream_of_nothing_but_keep_alives_is_unknown_not_failed(mock_session: MagicMock):
    """No frame ever carried a run id, so there is nothing to look up."""
    _configure_default_identity(mock_session)

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = iter(["event: ping\n\n"])
        node_repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        run_repo = mock_repo_factory.create_api_workflow_run_repository.return_value

        run = WorkflowServiceDifyPort().run_draft("app-1", _actor(), {}, lambda _e: None)

    node_repo.get_executions_by_workflow_run.assert_not_called()
    run_repo.get_workflow_run_by_id.assert_not_called()
    assert run.status == "running"
    assert run.status != "failed"
    assert run.error == run_mapping.TRUNCATED_STREAM_ERROR
    assert run.dify_run_id == ""


def test_run_draft_closes_the_stream_when_the_callback_raises(mock_session: MagicMock):
    """Streaming only releases the app's rate-limit slot on close()."""
    _configure_default_identity(mock_session)

    response = MagicMock()
    response.__iter__ = lambda _self: iter([_sse({"event": "node_started", "data": {"node_id": "n1", "title": "S"}})])

    def _boom(_event: NodeEvent) -> None:
        raise RuntimeError("callback exploded")

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory"),
    ):
        mock_ags.generate.return_value = response
        with pytest.raises(RuntimeError, match="callback exploded"):
            WorkflowServiceDifyPort().run_draft("app-1", _actor(), {}, _boom)

    response.close.assert_called_once_with()


# ---- publish --------------------------------------------------------------


def test_publish_publishes_workflow_updates_app_workflow_id_and_commits(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(
        id="app-1",
        tenant_id="tenant-1",
        workflow_id="old-wf-id",
        updated_by="old-updater",
        updated_at=None,
    )
    _configure_session_get(mock_session, account=account, app=app)
    published_workflow = SimpleNamespace(id="new-wf-id")

    with (
        patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls,
        patch("services.dify_builder.dify_port.naive_utc_now") as mock_naive_utc_now,
    ):
        # WorkflowService.publish_workflow returns a single Workflow (-> Workflow),
        # NOT a (workflow, retirement_candidates) tuple. Mock the real signature so
        # this test catches the tuple-unpack regression that crashed the publish step.
        mock_ws_cls.return_value.publish_workflow.return_value = published_workflow
        mock_naive_utc_now.return_value = "the-now"

        WorkflowServiceDifyPort().publish("app-1", _actor())

    mock_ws_cls.return_value.publish_workflow.assert_called_once_with(
        session=mock_session, app_model=app, account=account
    )
    assert app.workflow_id == "new-wf-id"
    # Publish must also advance the app's audit fields -- mirrors the console idiom at
    # controllers/console/app/workflow.py (~1315) so publishing via the dify_builder leaves the
    # same trail as publishing via the console UI.
    assert app.updated_by == "acc-1"
    assert app.updated_at == "the-now"
    mock_session.commit.assert_called_once()


# ---- Protocol conformance --------------------------------------------------


def test_workflow_service_dify_port_conforms_to_dify_port_protocol():
    assert isinstance(WorkflowServiceDifyPort(), DifyPort)


def test_run_draft_reads_a_blocking_dict_response(mock_session: MagicMock):
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
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
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

        run = WorkflowServiceDifyPort().run_draft("app-1", _actor(), {"q": "hi"}, events.append)

    assert run.status == "succeeded"
    assert run.dify_run_id == "run-1"
    assert run.per_node[0].outputs == {"x": 1}


def test_run_draft_does_not_enqueue_a_second_celery_task(mock_session: MagicMock):
    """The Builder owns a Celery slot, so it must request in-process streaming.
    Default streaming dispatches a child task and deadlocks when all slots are
    occupied by Builder tasks waiting for their children."""
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = iter([_sse(_FINISHED_CHUNK)])
        node_repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        node_repo.get_executions_by_workflow_run.return_value = []
        WorkflowServiceDifyPort().run_draft("app-1", _actor(), {}, lambda _e: None)

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


def _run_stream(chunks: list, *, node_execs: list | None = None, run_row=None):
    """Drive ``run_draft`` over ``chunks`` with the repositories stubbed; returns
    ``(run, forwarded_frames, node_exec_repo)``."""
    forwarded: list = []
    with (
        patch("services.dify_builder.dify_port.AppGenerateService") as mock_ags,
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = iter(chunks)
        node_repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        node_repo.get_executions_by_workflow_run.return_value = node_execs or []
        run_repo = mock_repo_factory.create_api_workflow_run_repository.return_value
        run_repo.get_workflow_run_by_id.return_value = run_row
        run = WorkflowServiceDifyPort().run_draft(
            "app-1", _actor(), {}, lambda _e: None, on_workflow_event=forwarded.append
        )
    return run, forwarded, node_repo


def test_the_esq1_302_launch_error_frame_is_a_failed_run_carrying_the_message(mock_session: MagicMock):
    _configure_default_identity(mock_session)

    run, forwarded, node_repo = _run_stream([_sse(ESQ1_302_ERROR_FRAME)])

    assert run.status == "failed"
    assert run.dify_run_id == ""  # the frame arrived before workflow_started: no run exists
    assert run.per_node == []
    assert "body.data.0.type Field required" in run.error
    assert run.error.endswith("[invalid_param]")
    assert forwarded[0]["event"] == "error"  # the frontend still receives the frame unchanged
    node_repo.get_executions_by_workflow_run.assert_not_called()  # no run id -> nothing to read


def test_an_error_frame_after_workflow_started_keeps_the_run_id_and_its_rows(mock_session: MagicMock):
    _configure_default_identity(mock_session)
    chunks = [
        _sse({"event": "workflow_started", "workflow_run_id": "run-9", "data": {"id": "run-9"}}),
        _sse({"event": "node_started", "workflow_run_id": "run-9", "data": {"node_id": "node-1", "title": "Code"}}),
        _sse({"event": "error", "workflow_run_id": "run-9", "code": "internal", "status": 500, "message": "boom"}),
    ]
    failed_row = SimpleNamespace(
        node_id="node-1", node_type="code", title="Code", status="failed", error="boom", inputs_dict={}, outputs_dict={}
    )

    run, _, node_repo = _run_stream(chunks, node_execs=[failed_row])

    assert run.status == "failed"
    assert run.dify_run_id == "run-9"
    assert [n.node_id for n in run.per_node] == ["node-1"]
    assert run.culprit_node_id == "node-1"
    assert run.error == "boom [internal]"
    node_repo.get_executions_by_workflow_run.assert_called_once_with("tenant-1", "app-1", "run-9")


def test_chatflow_ordering_finished_failed_then_error_prefers_the_terminal_frame(mock_session: MagicMock):
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


def test_an_error_frame_never_overrides_a_terminal_success_frame(mock_session: MagicMock):
    _configure_default_identity(mock_session)
    chunks = [
        _sse({"event": "workflow_started", "workflow_run_id": "run-3", "data": {"id": "run-3"}}),
        _sse({"event": "error", "workflow_run_id": "run-3", "code": "x", "status": 500, "message": "spurious"}),
        _sse(_FINISHED_CHUNK),
    ]

    run, _, _ = _run_stream(chunks)

    assert run.status == "succeeded"
    assert run.error == ""


def test_no_terminal_frame_and_no_error_frame_is_still_unknown(mock_session: MagicMock):
    _configure_default_identity(mock_session)

    run, _, _ = _run_stream(["event: ping\n\n", "ping"])

    assert run.status == "running"
    assert run.error == run_mapping.TRUNCATED_STREAM_ERROR
