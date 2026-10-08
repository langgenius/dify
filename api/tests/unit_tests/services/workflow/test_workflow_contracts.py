import json

import pytest

from services.workflow.contracts import WorkflowBindingScope, WorkflowTriggerError


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


def test_workflow_trigger_error_preserves_message() -> None:
    error = WorkflowTriggerError("Workflow trigger is unavailable")

    assert error.message == "Workflow trigger is unavailable"
    assert str(error) == "Workflow trigger is unavailable"
    assert error.args == ("Workflow trigger is unavailable",)
