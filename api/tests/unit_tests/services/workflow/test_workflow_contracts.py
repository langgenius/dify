import json

import pytest

from errors.workflow import WorkflowDataError
from graphon.entities.graph_config import NodeConfigDictAdapter
from services.workflow.contracts import WorkflowBindingScope, WorkflowSnapshot, WorkflowTriggerError


def test_binding_scope_graph_dict_returns_independent_parsed_data() -> None:
    edges: list[dict[str, str]] = []
    source_graph = {
        "nodes": [{"id": "start", "data": {"title": "Original"}}],
        "edges": edges,
    }
    scope = WorkflowBindingScope(
        id="workflow-1",
        tenant_id="tenant-1",
        app_id="app-1",
        version="draft",
        graph=json.dumps(source_graph),
    )

    first = scope.graph_dict
    first_node = first["nodes"][0]
    first_node["data"]["title"] = "Mutated"

    assert scope.graph_dict == source_graph


def test_binding_scope_graph_dict_propagates_invalid_json() -> None:
    scope = WorkflowBindingScope(
        id="workflow-1",
        tenant_id="tenant-1",
        app_id="app-1",
        version="draft",
        graph="{not-json",
    )

    with pytest.raises(json.JSONDecodeError):
        _ = scope.graph_dict


@pytest.mark.parametrize("node_type", ["start", "custom-node"])
def test_workflow_snapshot_node_type_from_raw_graph(node_type: str) -> None:
    assert WorkflowSnapshot.get_node_type_from_node_config({"data": {"type": node_type}}) == node_type


@pytest.mark.parametrize("node_type", ["start", "custom-node"])
def test_workflow_snapshot_node_type_from_validated_graph(node_type: str) -> None:
    node_config = NodeConfigDictAdapter.validate_python({"id": "node-1", "data": {"type": node_type}})

    assert WorkflowSnapshot.get_node_type_from_node_config(node_config) == node_type


@pytest.mark.parametrize("node_data", [None, {}, {"type": None}, {"type": 123}, "start"])
def test_workflow_snapshot_rejects_missing_or_invalid_node_type(node_data: object) -> None:
    with pytest.raises(WorkflowDataError, match="node type not found in workflow graph"):
        WorkflowSnapshot.get_node_type_from_node_config({"data": node_data})


def test_workflow_trigger_error_preserves_message() -> None:
    error = WorkflowTriggerError("Workflow trigger is unavailable")

    assert error.message == "Workflow trigger is unavailable"
    assert str(error) == "Workflow trigger is unavailable"
    assert error.args == ("Workflow trigger is unavailable",)
