import json
from dataclasses import replace

import pytest

from errors.workflow import WorkflowDataError
from graphon.entities.graph_config import NodeConfigDictAdapter
from models.workflow import WorkflowKind
from repositories.workflow.definition_repository import workflow_snapshot
from services.workflow.contracts import WorkflowBindingScope, WorkflowSnapshot, WorkflowTriggerError
from tests.unit_tests.model_factories import make_workflow


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


def test_workflow_snapshot_preserves_empty_graph_semantics() -> None:
    workflow = make_workflow(graph="")
    snapshot = workflow_snapshot(workflow)

    assert snapshot.graph_dict == workflow.graph_dict == {}


def test_workflow_snapshot_matches_legacy_image_feature_normalization_without_mutating_source() -> None:
    raw_features = {
        "file_upload": {
            "image": {
                "enabled": True,
                "number_limits": 7,
                "transfer_methods": ["local_file"],
            },
            "allowed_file_types": ["document"],
        },
        "opening_statement": "hello",
    }
    workflow = make_workflow(features=raw_features)
    snapshot = workflow_snapshot(workflow)
    serialized = snapshot.features

    assert snapshot.features_dict == workflow.features_dict
    assert snapshot.features == serialized


@pytest.mark.parametrize("invalid_kind", ["", "unknown"])
def test_workflow_snapshot_kind_validation_matches_workflow_model(invalid_kind: str) -> None:
    workflow = make_workflow(kind=WorkflowKind.STANDARD)
    workflow.kind = invalid_kind  # type: ignore[assignment]
    snapshot = replace(workflow_snapshot(make_workflow()), kind=invalid_kind)

    with pytest.raises(ValueError, match=f"invalid workflow kind value {invalid_kind}"):
        _ = workflow.kind_or_standard
    with pytest.raises(ValueError, match=f"invalid workflow kind value {invalid_kind}"):
        _ = snapshot.kind_or_standard


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
