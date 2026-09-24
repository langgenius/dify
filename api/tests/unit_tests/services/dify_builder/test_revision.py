import json
from copy import deepcopy
from unittest.mock import MagicMock, patch

import pytest

from core.dify_builder.errors import ConflictError
from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Graph, Session
from core.dify_builder.ports import Repository
from core.dify_builder.state import PcState
from graphon.variables import SecretVariable, StringVariable
from models.workflow import Workflow
from services.dify_builder.graph_ops import apply_connect, apply_create_node
from services.dify_builder.revision import execution_revision, merge_canvas_presentation
from services.dify_builder.service import DifyBuilderService, SessionLock


@pytest.fixture
def workflow() -> Workflow:
    return Workflow(
        tenant_id="tenant-1",
        graph=json.dumps(
            {
                "nodes": [
                    {
                        "id": "llm",
                        "position": {"x": 10, "y": 20},
                        "data": {"type": "llm", "prompt_template": [{"text": "Original"}], "selected": False},
                    },
                    {"id": "end", "data": {"type": "end"}},
                ],
                "edges": [{"source": "llm", "target": "end", "sourceHandle": "source"}],
                "viewport": {"x": 0, "y": 0, "zoom": 1},
            }
        ),
        features="{}",
        environment_variables=[],
        conversation_variables=[],
    )


def test_canvas_changes_preserve_execution_revision_but_change_persistence_hash(workflow: Workflow) -> None:
    revision = execution_revision(workflow)
    storage_hash = workflow.unique_hash
    graph = deepcopy(dict(workflow.graph_dict))
    graph["viewport"] = {"x": 100, "y": 100, "zoom": 2}
    graph["nodes"][0].update(position={"x": 300, "y": 400}, width=200, height=100, selected=True)
    graph["nodes"][0]["data"]["selected"] = True
    graph["edges"][0]["selected"] = True
    workflow.graph = json.dumps(graph)

    assert execution_revision(workflow) == revision
    assert workflow.unique_hash != storage_hash


def test_repair_preserves_concurrent_canvas_presentation(workflow: Workflow) -> None:
    before = deepcopy(workflow.graph_dict)
    after = deepcopy(before)
    after["nodes"][0]["data"]["prompt_template"][0]["text"] = "Builder edit"
    latest = deepcopy(before)
    latest["nodes"][0].update(position={"x": 900, "y": 500}, selected=True)
    latest["nodes"][0]["data"].update(selected=True, _runningStatus="succeeded")
    latest["edges"][0]["data"] = {"sourceType": "llm", "_waitingRun": True}
    latest["viewport"] = {"x": 50, "y": 70, "zoom": 2}
    latest["nodes"].append({"id": "note-1", "type": "custom-note", "data": {"text": "Keep me"}})

    merged = merge_canvas_presentation(before, after, latest)

    assert merged["nodes"][0]["data"]["prompt_template"][0]["text"] == "Builder edit"
    assert merged["nodes"][0]["position"] == {"x": 900, "y": 500}
    assert merged["nodes"][0]["data"]["_runningStatus"] == "succeeded"
    assert merged["edges"][0]["data"] == {"sourceType": "llm", "_waitingRun": True}
    assert merged["viewport"] == latest["viewport"]
    assert merged["nodes"][-1] == latest["nodes"][-1]


def test_repair_keeps_builder_layout_when_canvas_did_not_change_it(workflow: Workflow) -> None:
    before = deepcopy(workflow.graph_dict)
    after = deepcopy(before)
    after["nodes"][0]["position"] = {"x": 300, "y": 400}
    after["viewport"] = {"x": 10, "y": 20, "zoom": 1.5}
    latest = deepcopy(before)
    latest["nodes"][0]["data"]["selected"] = True

    merged = merge_canvas_presentation(before, after, latest)

    assert merged["nodes"][0]["position"] == {"x": 300, "y": 400}
    assert merged["nodes"][0]["data"]["selected"] is True
    assert merged["viewport"] == {"x": 10, "y": 20, "zoom": 1.5}


def test_repair_does_not_add_empty_edge_data(workflow: Workflow) -> None:
    before = deepcopy(workflow.graph_dict)
    after = deepcopy(before)
    latest = deepcopy(before)

    merged = merge_canvas_presentation(before, after, latest)

    assert merged == after


@pytest.fixture
def builder_workflow() -> Workflow:
    graph: Graph = {"nodes": [], "edges": []}
    for node_type in ("start", "code", "end"):
        config = {"code": "def main(): return {'result': 'original'}"} if node_type == "code" else {}
        graph, _ = apply_create_node(graph, node_type, config, node_id=node_type)
    graph, _ = apply_connect(graph, "start", "code")
    graph, _ = apply_connect(graph, "code", "end")
    return Workflow(
        tenant_id="tenant-1",
        graph=json.dumps(graph),
        features="{}",
        environment_variables=[],
        conversation_variables=[],
    )


def _save_canvas_layout(workflow: Workflow) -> None:
    """Persist the renderer metadata added by initialNodes/initialEdges on refresh."""
    graph = dict(workflow.graph_dict)
    for node in graph["nodes"]:
        node.update(width=240, height=100, zIndex=0, positionAbsolute=node["position"])
        node["data"]["selected"] = node["id"] == "code"
    graph["nodes"][1]["position"] = {"x": 900, "y": 500}
    for edge in graph["edges"]:
        edge.update(
            zIndex=0,
            data={
                "sourceType": edge["source"],
                "targetType": edge["target"],
                "isInIteration": False,
                "isInLoop": False,
            },
        )
    graph["viewport"] = {"x": 50, "y": 70, "zoom": 2}
    workflow.graph = json.dumps(graph)


@pytest.mark.parametrize(
    ("state", "kind"),
    [(PcState.FIX_AWAIT_APPROVAL, "approve_repair"), (PcState.FIX_AWAIT_VERIFY, "run_verify")],
)
def test_actions_accept_canvas_save_after_builder_writes_graph(
    builder_workflow: Workflow, state: PcState, kind: str
) -> None:
    session = Session(
        id="session-1",
        app_id="app-1",
        tenant_id="tenant-1",
        owner_account_id="account-1",
        entry_mode=EntryMode.FIX,
        current_state=state,
        version=1,
    )
    repo = MagicMock(spec=Repository)
    repo.get_session.return_value = (
        session,
        DifyBuilderContext(last_snapshot_hash=execution_revision(builder_workflow)),
    )
    repo.get_latest_conversation_item.return_value = None
    lock = MagicMock(spec=SessionLock)
    lock.exists.return_value = False
    enqueued = MagicMock()
    service = DifyBuilderService(
        repo,
        lock,
        enqueued,
        get_app_revision_fn=lambda _app_id, _actor: execution_revision(builder_workflow),
    )
    actor = Actor(account_id=session.owner_account_id, tenant_id=session.tenant_id)
    view = service.get_session_view(session.id, actor)
    assert view.app_revision is not None
    action = Action(kind=kind, base_version=view.version, base_app_revision=view.app_revision.current)
    storage_hash = builder_workflow.unique_hash

    # Clicking the action flushes the refreshed canvas before sending its
    # previously rendered revision. Neither the view nor the action may drift.
    _save_canvas_layout(builder_workflow)
    assert builder_workflow.unique_hash != storage_hash
    result = service.submit_action(session.id, actor, action)

    assert result.app_revision is not None
    assert result.app_revision.conflicted is False
    assert result.app_revision.current == view.app_revision.current
    enqueued.assert_called_once_with(session.id, action, actor, lock.acquire.return_value)

    # Even if the client fetches the latest revision, an actual code edit must
    # still conflict with the configuration that Builder planned against.
    graph = builder_workflow.graph_dict
    graph["nodes"][1]["data"]["code"] = "def main(): return {'result': 'changed'}"
    builder_workflow.graph = json.dumps(graph)
    with pytest.raises(ConflictError, match="stale app revision"):
        service.submit_action(session.id, actor, action)
    action.base_app_revision = execution_revision(builder_workflow)
    with pytest.raises(ConflictError, match="draft changed outside Builder"):
        service.submit_action(session.id, actor, action)
    assert enqueued.call_count == 1


def test_canvas_hydration_and_transient_state_preserve_revision(workflow: Workflow) -> None:
    revision = execution_revision(workflow)
    graph = workflow.graph_dict
    for node in graph["nodes"]:
        node["type"] = "custom"
        node["data"]["_connectedSourceHandleIds"] = ["source"]
        node["data"]["_runningStatus"] = "succeeded"
    graph["edges"][0].update(
        type="custom",
        targetHandle="target",
        data={"sourceType": "llm", "targetType": "end", "_connectedNodeIsSelected": True},
    )
    workflow.graph = json.dumps(graph)

    assert execution_revision(workflow) == revision


@pytest.mark.parametrize("field", ["isInIteration", "iteration_id", "isInLoop", "loop_id"])
def test_edge_container_hints_are_presentation_but_node_membership_is_configuration(
    workflow: Workflow, field: str
) -> None:
    revision = execution_revision(workflow)
    graph = workflow.graph_dict
    graph["edges"][0]["data"] = {field: "container" if field.endswith("_id") else True}
    workflow.graph = json.dumps(graph)
    assert execution_revision(workflow) == revision

    graph["nodes"][0]["data"][field] = graph["edges"][0]["data"][field]
    workflow.graph = json.dumps(graph)
    assert execution_revision(workflow) != revision


def test_unknown_edge_configuration_is_not_stripped(workflow: Workflow) -> None:
    revision = execution_revision(workflow)
    graph = workflow.graph_dict
    graph["edges"][0]["data"] = {"new_runtime_option": {"position": 1}}
    workflow.graph = json.dumps(graph)

    assert execution_revision(workflow) != revision


@pytest.mark.parametrize("node_type", ["iteration", "loop"])
def test_container_resizing_and_notes_do_not_invalidate_revision(workflow: Workflow, node_type: str) -> None:
    graph = workflow.graph_dict
    graph["nodes"].append({"id": "container", "data": {"type": node_type, "width": 500, "height": 300}})
    workflow.graph = json.dumps(graph)
    revision = execution_revision(workflow)

    graph["nodes"][-1]["data"].update(width=700, height=400)
    graph["nodes"].append({"id": "note", "type": "custom-note", "data": {"text": "Documentation"}})
    workflow.graph = json.dumps(graph)

    assert execution_revision(workflow) == revision


def test_configuration_dimensions_are_not_treated_as_container_geometry(workflow: Workflow) -> None:
    revision = execution_revision(workflow)
    graph = workflow.graph_dict
    graph["nodes"][0]["data"]["width"] = 100
    workflow.graph = json.dumps(graph)

    assert execution_revision(workflow) != revision


@pytest.mark.parametrize("change", ["prompt", "branch", "parent", "unknown", "nested_position", "order"])
def test_execution_configuration_changes_invalidate_revision(workflow: Workflow, change: str) -> None:
    revision = execution_revision(workflow)
    graph = deepcopy(workflow.graph_dict)
    node = graph["nodes"][0]
    if change == "prompt":
        node["data"]["prompt_template"][0]["text"] = "Changed"
    elif change == "branch":
        graph["edges"][0]["sourceHandle"] = "false"
    elif change == "parent":
        node["parentId"] = "loop"
    elif change == "unknown":
        node["data"]["new_runtime_option"] = True
    elif change == "nested_position":
        node["data"]["position"] = 5
    else:
        node["data"]["prompt_template"].insert(0, {"text": "First"})
    workflow.graph = json.dumps(graph)

    assert execution_revision(workflow) != revision


@pytest.mark.parametrize("field", ["environment_variables", "conversation_variables", "features"])
def test_execution_dependencies_outside_graph_invalidate_revision(workflow: Workflow, field: str) -> None:
    revision = execution_revision(workflow)
    storage_hash = workflow.unique_hash
    if field == "features":
        workflow.features = json.dumps({"file_upload": {"enabled": True}})
    else:
        setattr(workflow, field, [StringVariable(name="input", value="Changed")])

    assert execution_revision(workflow) != revision
    assert workflow.unique_hash == storage_hash


def test_secret_reencryption_preserves_revision_but_a_changed_value_invalidates_it(workflow: Workflow) -> None:
    secret = SecretVariable(name="TOKEN", value="ciphertext-1")
    workflow._environment_variables = json.dumps({secret.id: secret.model_dump(mode="json")})
    with patch("models.workflow.encrypter.decrypt_token", return_value="same-value") as decrypt:
        revision = execution_revision(workflow)
        secret = secret.model_copy(update={"value": "ciphertext-2"})
        workflow._environment_variables = json.dumps({secret.id: secret.model_dump(mode="json")})
        assert execution_revision(workflow) == revision

        decrypt.return_value = "changed-value"
        assert execution_revision(workflow) != revision
