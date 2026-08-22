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
  ``invoke_from=InvokeFrom.DEBUGGER`` and ``streaming=False``, emits an
  ``on_event`` per node execution, and returns the ``run_mapping``-mapped
  ``Run``.
- ``publish`` calls ``publish_workflow`` AND sets ``app.workflow_id`` AND
  commits -- omitting the ``workflow_id`` update makes publish a silent
  no-op, so all three are asserted together.

The genuine red -> green -> publish end-to-end against a running local stack
is Task 5's runbook, not this suite.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow_copilot.models import Actor, MutationIntent, NodeEvent
from core.workflow_copilot.ports import DifyPort
from models.account import Account
from models.model import App
from services.errors.app import WorkflowHashNotEqualError
from services.workflow_copilot.dify_port import WorkflowServiceDifyPort
from services.workflow_copilot.errors import HashMismatchError, WorkflowNotInitializedError


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
    with patch("services.workflow_copilot.dify_port.db"):
        yield


@pytest.fixture(autouse=True)
def _mock_sessionmaker(mock_session: MagicMock):
    """Every ``sessionmaker(...)`` call in the adapter yields ``mock_session``."""
    with patch("services.workflow_copilot.dify_port.sessionmaker") as mock_sessionmaker_ctor:
        mock_sessionmaker_ctor.return_value = MagicMock(return_value=mock_session)
        yield mock_sessionmaker_ctor


# ---- read_graph --------------------------------------------------------------


def test_read_graph_returns_graph_dict_and_unique_hash(mock_session: MagicMock):
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, app=app)
    workflow = SimpleNamespace(graph_dict={"nodes": [], "edges": []}, unique_hash="hash-1")

    with patch("services.workflow_copilot.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow

        graph, unique_hash = WorkflowServiceDifyPort().read_graph("app-1", _actor())

    assert graph == {"nodes": [], "edges": []}
    assert unique_hash == "hash-1"
    mock_ws_cls.return_value.get_draft_workflow.assert_called_once_with(app, session=mock_session)


def test_read_graph_raises_when_no_draft_workflow(mock_session: MagicMock):
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, app=app)

    with patch("services.workflow_copilot.dify_port.WorkflowService") as mock_ws_cls:
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

    with patch("services.workflow_copilot.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory:
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
    workflow = SimpleNamespace(
        graph_dict=original_graph,
        unique_hash="hash-1",
        features_dict={"feature": True},
        conversation_variables=["conv-var"],
    )
    updated_workflow = SimpleNamespace(unique_hash="hash-2")
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "new"})]

    with patch("services.workflow_copilot.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        result = WorkflowServiceDifyPort().apply_repair("app-1", _actor(), intents)

    assert result.changed_nodes == ["node-1"]
    assert result.new_hash == "hash-2"

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
    assert kwargs["unique_hash"] == "hash-1"
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

    workflow = SimpleNamespace(
        graph_dict={"nodes": [{"id": "node-1", "data": {}}], "edges": []},
        unique_hash="hash-1",
        features_dict={},
        conversation_variables=[],
    )
    # Ops the dispatch table doesn't recognize are silently skipped -- this
    # is forward-compat for future verbs, distinct from a *recognized* op
    # with bad args (which raises, see test_apply_repair_dispatches_connect_
    # and_reports_dangling_ref_as_value_error below).
    intents = [MutationIntent(op="some_future_verb", args={"from": "node-1", "to": "node-2"})]

    with patch("services.workflow_copilot.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow

        result = WorkflowServiceDifyPort().apply_repair("app-1", _actor(), intents)

    assert result.changed_nodes == []
    # No node changed -> no reason to write the draft back: sync_draft_workflow must not
    # be called at all (avoids a wasteful no-op DB write + signal), and the hash returned
    # is simply the one that was read.
    mock_ws_cls.return_value.sync_draft_workflow.assert_not_called()
    assert result.new_hash == "hash-1"


def test_apply_repair_maps_hash_mismatch_to_domain_error(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = SimpleNamespace(
        graph_dict={"nodes": [{"id": "node-1", "data": {}}], "edges": []},
        unique_hash="hash-1",
        features_dict={},
        conversation_variables=[],
    )
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "x"})]

    with patch("services.workflow_copilot.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.side_effect = WorkflowHashNotEqualError()

        with pytest.raises(HashMismatchError):
            WorkflowServiceDifyPort().apply_repair("app-1", _actor(), intents)


def test_apply_repair_dispatches_create_node(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = SimpleNamespace(
        graph_dict={"nodes": [], "edges": []},
        unique_hash="hash-1",
        features_dict={},
        conversation_variables=[],
    )
    updated_workflow = SimpleNamespace(unique_hash="hash-2")
    intents = [MutationIntent(op="create_node", args={"node_type": "llm", "config": {}})]

    with patch("services.workflow_copilot.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        result = WorkflowServiceDifyPort().apply_repair("app-1", _actor(), intents)

    assert len(result.changed_nodes) == 1
    _, kwargs = mock_ws_cls.return_value.sync_draft_workflow.call_args
    assert len(kwargs["graph"]["nodes"]) == 1
    assert kwargs["graph"]["nodes"][0]["data"]["type"] == "llm"


def test_apply_repair_dispatches_connect_and_reports_dangling_ref_as_value_error(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = SimpleNamespace(
        graph_dict={"nodes": [{"id": "a", "data": {}}], "edges": []},
        unique_hash="hash-1",
        features_dict={},
        conversation_variables=[],
    )
    intents = [MutationIntent(op="connect", args={"from_node": "a", "to_node": "missing"})]

    with patch("services.workflow_copilot.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow

        with pytest.raises(ValueError):
            WorkflowServiceDifyPort().apply_repair("app-1", _actor(), intents)


def test_apply_repair_computes_real_diff_changes_and_scope_for_structural_edit(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = SimpleNamespace(
        graph_dict={"nodes": [{"id": "a", "data": {}}], "edges": []},
        unique_hash="hash-1",
        features_dict={},
        conversation_variables=[],
    )
    updated_workflow = SimpleNamespace(unique_hash="hash-2")
    intents = [
        MutationIntent(op="create_node", args={"node_type": "llm", "config": {}, "node_id": "llm-1"}),
        MutationIntent(op="connect", args={"from_node": "a", "to_node": "llm-1"}),
    ]

    with patch("services.workflow_copilot.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        result = WorkflowServiceDifyPort().apply_repair("app-1", _actor(), intents)

    assert result.scope == "structure"
    assert "added node llm-1" in result.changes
    assert "added a → llm-1" in result.changes


def test_apply_repair_computes_configuration_scope_for_set_node_config(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = SimpleNamespace(
        graph_dict={"nodes": [{"id": "node-1", "data": {"code": "old"}}], "edges": []},
        unique_hash="hash-1",
        features_dict={},
        conversation_variables=[],
    )
    updated_workflow = SimpleNamespace(unique_hash="hash-2")
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "new"})]

    with patch("services.workflow_copilot.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        result = WorkflowServiceDifyPort().apply_repair("app-1", _actor(), intents)

    assert result.scope == "configuration"
    assert result.changes == ["node-1: code updated"]


def test_apply_repair_invokes_on_canvas_once_per_applied_intent(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = SimpleNamespace(
        graph_dict={"nodes": [{"id": "node-1", "data": {}}], "edges": []},
        unique_hash="hash-1",
        features_dict={},
        conversation_variables=[],
    )
    updated_workflow = SimpleNamespace(unique_hash="hash-2")
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "x"})]
    events: list[dict] = []

    with patch("services.workflow_copilot.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        WorkflowServiceDifyPort().apply_repair("app-1", _actor(), intents, on_canvas=events.append)

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

    workflow = SimpleNamespace(
        graph_dict={"nodes": [], "edges": []},
        unique_hash="hash-1",
        features_dict={},
        conversation_variables=[],
    )
    updated_workflow = SimpleNamespace(unique_hash="hash-2")
    intents = [MutationIntent(op="create_node", args={"node_type": node_type, "config": {}})]
    events: list[dict] = []

    with patch("services.workflow_copilot.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        WorkflowServiceDifyPort().apply_repair("app-1", _actor(), intents, on_canvas=events.append)

    assert events[0]["event"] == expected_event


def test_apply_repair_skips_on_canvas_when_not_provided(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    workflow = SimpleNamespace(
        graph_dict={"nodes": [{"id": "node-1", "data": {}}], "edges": []},
        unique_hash="hash-1",
        features_dict={},
        conversation_variables=[],
    )
    updated_workflow = SimpleNamespace(unique_hash="hash-2")
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node-1", "path": "code", "value": "x"})]

    with patch("services.workflow_copilot.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.return_value = updated_workflow

        # must not raise even though on_canvas is omitted (default None)
        WorkflowServiceDifyPort().apply_repair("app-1", _actor(), intents)


# ---- run_draft --------------------------------------------------------------


def test_run_draft_invokes_generate_with_debugger_blocking_and_emits_node_events(mock_session: MagicMock):
    account = SimpleNamespace(id="acc-1")
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    _configure_session_get(mock_session, account=account, app=app)

    response = {
        "data": {
            "id": "run-1",
            "workflow_id": "wf-1",
            "status": "succeeded",
            "outputs": {"answer": "42"},
            "error": None,
            "elapsed_time": 1.0,
            "total_tokens": 10,
        }
    }
    node_exec = SimpleNamespace(
        node_id="node-1",
        node_type="code",
        title="Code",
        status="succeeded",
        error=None,
        inputs_dict={},
        outputs_dict={"x": 1},
    )

    events: list[NodeEvent] = []

    with (
        patch("services.workflow_copilot.dify_port.AppGenerateService") as mock_ags,
        patch("services.workflow_copilot.dify_port.DifyAPIRepositoryFactory") as mock_repo_factory,
    ):
        mock_ags.generate.return_value = response
        mock_node_exec_repo = mock_repo_factory.create_api_workflow_node_execution_repository.return_value
        mock_node_exec_repo.get_executions_by_workflow_run.return_value = [node_exec]

        run = WorkflowServiceDifyPort().run_draft("app-1", _actor(), {"q": "hi"}, events.append)

    _, kwargs = mock_ags.generate.call_args
    assert kwargs["app_model"] is app
    assert kwargs["user"] is account
    assert kwargs["args"] == {"inputs": {"q": "hi"}}
    assert kwargs["invoke_from"] == InvokeFrom.DEBUGGER
    assert kwargs["streaming"] is False
    assert kwargs["session"] is mock_session

    mock_node_exec_repo.get_executions_by_workflow_run.assert_called_once_with("tenant-1", "app-1", "run-1")

    assert events == [NodeEvent(node_id="node-1", title="Code", status="succeeded", error="")]
    assert run.status == "succeeded"
    assert run.dify_run_id == "run-1"
    assert run.per_node[0].node_id == "node-1"


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
        patch("services.workflow_copilot.dify_port.WorkflowService") as mock_ws_cls,
        patch("services.workflow_copilot.dify_port.naive_utc_now") as mock_naive_utc_now,
    ):
        mock_ws_cls.return_value.publish_workflow.return_value = (published_workflow, set())
        mock_naive_utc_now.return_value = "the-now"

        WorkflowServiceDifyPort().publish("app-1", _actor())

    mock_ws_cls.return_value.publish_workflow.assert_called_once_with(
        session=mock_session, app_model=app, account=account
    )
    assert app.workflow_id == "new-wf-id"
    # Publish must also advance the app's audit fields -- mirrors the console idiom at
    # controllers/console/app/workflow.py (~1315) so publishing via the copilot leaves the
    # same trail as publishing via the console UI.
    assert app.updated_by == "acc-1"
    assert app.updated_at == "the-now"
    mock_session.commit.assert_called_once()


# ---- Protocol conformance --------------------------------------------------


def test_workflow_service_dify_port_conforms_to_dify_port_protocol():
    assert isinstance(WorkflowServiceDifyPort(), DifyPort)
