"""Adapter DTOs preserve durable execution state without granting authority."""

import ast
import inspect
from pathlib import Path

import pytest
from pydantic import ValidationError

from services.dify_builder.native_testing import runtime_contracts
from services.dify_builder.native_testing.runtime_contracts import (
    ChildInvocationPort,
    NativeBuilderProjection,
    NativeCheckpointPayload,
    NativeNodeCoverage,
    NativeStatePort,
    NativeWorkflowOutcome,
    NodeJournalState,
    ResolvedNativeTestContext,
)

REF_DATA = {
    "policy_version": "builder-native-test-v1",
    "request_id": "f8e67cb1-6451-4c33-85d5-0f32768f1844",
    "invocation_id": "25d69d99-d42b-4c50-a2f7-c2a69580d6ed",
    "context_digest": "a" * 64,
}
KEY = {"invocation_id": REF_DATA["invocation_id"], "occurrence_path": ["loop", "0", "tool"], "cursor": 0}
CONTEXT = {
    "ref": REF_DATA,
    "tenant_id": "tenant-1",
    "actor_id": "actor-1",
    "app_id": "app-1",
    "workflow_id": "workflow-1",
    "graph": {"nodes": [{"id": "tool", "enabled": True}]},
    "inputs": {"prompt": "hello", "file": {"ref": "file-1"}},
    "graph_revision": "graph-v1",
    "input_revision": "input-v1",
    "resource_manifest": [{"resource_ref": "tool-1"}],
    "generation": 0,
    "root_native_run_id": "run-1",
    "native_run_id": "run-1",
    "parent_invocation_id": None,
    "call_depth": 0,
    "budget_ref": "budget-1",
    "cancellation_ref": "cancel-1",
    "execution_mode": "native",
}
JOURNAL = {
    "invocation_id": REF_DATA["invocation_id"],
    "occurrence_path": ["loop", "0", "tool"],
    "input_result_ref": "inputs-1",
    "input_digest": "b" * 64,
    "cursor": 1,
    "operation_keys": [KEY],
    "result_refs": ["result-1"],
}
CHECKPOINT = {
    "schema_version": "1",
    "native_run_id": "run-1",
    "generation": 0,
    "generate_entity_json": '{"inputs":{"file":{"ref":"file-1"}}}',
    "graph_runtime_state_json": '{"cursor":1,"outputs":[true,null,1.5]}',
    "response_stream_filter_json": '{"buffer":[]}',
    "node_journals": [JOURNAL],
    "child_refs": [REF_DATA],
    "input_result_refs": ["inputs-1"],
}
WAITING = {
    "status": "waiting",
    "ref": REF_DATA,
    "native_run_id": "run-1",
    "checkpoint_ref": {"checkpoint_id": "checkpoint-1", "payload_digest": "c" * 64},
    "pending_operation_ids": ["operation-1"],
    "reason_code": None,
    "wait_reason": "approval",
    "native_status": None,
    "output_result_ref": None,
}
PROJECTION = {
    "route": "waiting",
    "native_run_id": "run-1",
    "public_receipt_ref": "receipt-1",
    "wait_reason": "approval",
    "can_diagnose": False,
    "can_start_new_run": False,
}
COVERAGE = {
    "mode": "native",
    "node_type": "tool",
    "node_version": "1",
    "implementation": "tool_adapter",
    "schema_fixture": "tool-v1.json",
    "effect_owners": ["tool"],
    "test_ids": ["test_tool_authorization"],
    "limitation_reason": None,
}


def test_checkpoint_roundtrip_preserves_recovery_state_and_input_references():
    checkpoint = NativeCheckpointPayload.model_validate(CHECKPOINT)
    restored = NativeCheckpointPayload.model_validate_json(checkpoint.model_dump_json())
    expected = {
        **CHECKPOINT,
        "approval_proposals": [],
        "node_journals": [{**journal, "intents": []} for journal in CHECKPOINT["node_journals"]],
    }
    assert restored.model_dump(mode="json") == expected
    assert restored.node_journals[0].operation_keys[0].cursor == 0
    assert restored.input_result_refs == ("inputs-1",)


def test_context_preserves_distinct_tenants_without_claiming_to_authorize_them():
    first = ResolvedNativeTestContext.model_validate(CONTEXT)
    second = ResolvedNativeTestContext.model_validate({**CONTEXT, "tenant_id": "tenant-2"})
    assert first.tenant_id == "tenant-1"
    assert second.tenant_id == "tenant-2"
    assert first.ref == second.ref  # C03 must authorize scope; DTO decoding cannot do so.
    assert first.model_dump(mode="json") == CONTEXT


@pytest.mark.parametrize(
    ("model", "data"),
    [
        (ResolvedNativeTestContext, CONTEXT),
        (NodeJournalState, JOURNAL),
        (NativeCheckpointPayload, CHECKPOINT),
        (NativeWorkflowOutcome, WAITING),
        (NativeBuilderProjection, PROJECTION),
        (NativeNodeCoverage, COVERAGE),
    ],
)
def test_models_reject_extra_fields_and_field_reassignment(model, data):
    with pytest.raises(ValidationError, match="extra_forbidden"):
        model.model_validate({**data, "granted": True})
    instance = model.model_validate(data)
    with pytest.raises(ValidationError, match="frozen_instance"):
        setattr(instance, next(iter(data)), "changed")


@pytest.mark.parametrize("field", ["generation", "call_depth"])
def test_context_rejects_negative_counters(field):
    with pytest.raises(ValidationError):
        ResolvedNativeTestContext.model_validate({**CONTEXT, field: -1})


@pytest.mark.parametrize(
    ("model", "data", "field"),
    [(NodeJournalState, JOURNAL, "cursor"), (NativeCheckpointPayload, CHECKPOINT, "generation")],
)
def test_checkpoint_rejects_negative_counters(model, data, field):
    with pytest.raises(ValidationError):
        model.model_validate({**data, field: -1})


@pytest.mark.parametrize("field", ["graph", "inputs", "resource_manifest"])
@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf"), b"file bytes"])
def test_context_rejects_nonfinite_or_binary_json(field, bad):
    value = [{"nested": bad}] if field == "resource_manifest" else {"nested": [bad]}
    with pytest.raises(ValidationError):
        ResolvedNativeTestContext.model_validate({**CONTEXT, field: value})


@pytest.mark.parametrize("field", ["generate_entity_json", "graph_runtime_state_json", "response_stream_filter_json"])
@pytest.mark.parametrize("bad", ['{"broken":', '{"value":NaN}', '{"value":Infinity}', '{"value":-Infinity}'])
def test_checkpoint_rejects_invalid_or_nonfinite_json_strings(field, bad):
    with pytest.raises(ValidationError):
        NativeCheckpointPayload.model_validate({**CHECKPOINT, field: bad})


@pytest.mark.parametrize(
    ("field", "bad"),
    [
        ("checkpoint_ref", None),
        ("native_run_id", None),
        ("native_run_id", ""),
        ("pending_operation_ids", []),
        ("wait_reason", None),
    ],
)
def test_waiting_requires_durable_checkpoint_run_pending_operations_and_reason(field, bad):
    with pytest.raises(ValidationError, match=field.removesuffix("_ref")):
        NativeWorkflowOutcome.model_validate({**WAITING, field: bad})


@pytest.mark.parametrize("reason", ["approval", "configuration", "interaction"])
def test_wait_categories_survive_outcome_and_projection_roundtrip(reason):
    outcome = NativeWorkflowOutcome.model_validate({**WAITING, "wait_reason": reason})
    projection = NativeBuilderProjection.model_validate({**PROJECTION, "wait_reason": reason})
    assert NativeWorkflowOutcome.model_validate_json(outcome.model_dump_json()).wait_reason == reason
    assert NativeBuilderProjection.model_validate_json(projection.model_dump_json()).wait_reason == reason


@pytest.mark.parametrize("native_status", ["succeeded", "failed", "partial-succeeded", "stopped"])
def test_native_terminal_states_are_completed_including_actual_failure(native_status):
    data = {
        **WAITING,
        "status": "completed",
        "wait_reason": None,
        "native_status": native_status,
        "checkpoint_ref": None,
        "pending_operation_ids": [],
        "output_result_ref": "output-1",
    }
    outcome = NativeWorkflowOutcome.model_validate(data)
    assert outcome.status == "completed"
    assert outcome.native_status == native_status
    assert outcome.output_result_ref == "output-1"


@pytest.mark.parametrize("field", ["native_run_id", "native_status"])
def test_completed_requires_native_run_and_terminal_state(field):
    data = {**WAITING, "status": "completed", "wait_reason": None, "native_status": "failed", field: None}
    with pytest.raises(ValidationError, match=field):
        NativeWorkflowOutcome.model_validate(data)


@pytest.mark.parametrize("status", ["completed", "stopped", "unknown"])
def test_nonwaiting_outcome_rejects_wait_reason(status):
    with pytest.raises(ValidationError, match="wait_reason"):
        NativeWorkflowOutcome.model_validate({**WAITING, "status": status, "native_status": "failed"})


@pytest.mark.parametrize("status", ["waiting", "stopped", "unknown"])
def test_noncompleted_outcome_rejects_success_output(status):
    data = {
        **WAITING,
        "status": status,
        "wait_reason": "approval" if status == "waiting" else None,
        "output_result_ref": "success-output",
    }
    with pytest.raises(ValidationError, match="output_result_ref"):
        NativeWorkflowOutcome.model_validate(data)


@pytest.mark.parametrize("route", ["waiting", "stopped", "unknown"])
@pytest.mark.parametrize("flag", ["can_diagnose", "can_start_new_run"])
def test_projection_disallows_diagnosis_and_new_run_for_control_routes(route, flag):
    data = {**PROJECTION, "route": route, "wait_reason": "approval" if route == "waiting" else None, flag: True}
    with pytest.raises(ValidationError, match=flag):
        NativeBuilderProjection.model_validate(data)


@pytest.mark.parametrize("field", list(WAITING))
def test_outcome_fields_are_required_even_when_nullable(field):
    data = {key: value for key, value in WAITING.items() if key != field}
    with pytest.raises(ValidationError, match=field):
        NativeWorkflowOutcome.model_validate(data)


def test_ports_expose_keyword_only_persistence_and_child_invocation_inputs():
    expected = {
        NativeStatePort: {
            "load_context": ("ref",),
            "commit_checkpoint": ("ref", "generation", "payload"),
            "read_checkpoint": ("ref", "checkpoint"),
            "store_result": ("ref", "key", "result"),
            "load_result": ("ref", "result_ref"),
        },
        ChildInvocationPort: {
            "get_or_create": (
                "parent_ref",
                "key",
                "child_app_id",
                "child_workflow_revision",
                "input_digest",
                "input_result_ref",
            ),
            "complete": ("child_ref", "outcome"),
        },
    }
    for port, methods in expected.items():
        for name, names in methods.items():
            params = list(inspect.signature(getattr(port, name)).parameters.values())[1:]
            assert tuple(param.name for param in params) == names
            assert all(param.kind == inspect.Parameter.KEYWORD_ONLY for param in params)


def test_runtime_contract_import_boundary_excludes_runtime_core_and_database_dependencies():
    tree = ast.parse(Path(runtime_contracts.__file__).read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert set(imports) <= {
        "__future__",
        "json",
        "typing",
        "pydantic",
        "services.dify_builder.native_testing.contracts",
        "services.dify_builder.native_testing.approval_contracts",
    }


@pytest.mark.parametrize(
    "resource",
    [
        {"value": float("nan")},
        {"value": float("inf")},
        {"value": float("-inf")},
        {"value": {"nested": [float("nan")]}},
        {"value": b"file bytes"},
        {"value": (1, 2)},
        {"value": {1: "non-JSON key"}},
        {"resource_ref": "valid-resource"},
    ],
)
def test_context_rejects_manifest_generators_before_tuple_coercion(resource):
    manifest = (entry for entry in [resource])
    with pytest.raises(ValidationError, match="resource_manifest"):
        ResolvedNativeTestContext.model_validate({**CONTEXT, "resource_manifest": manifest})


@pytest.mark.parametrize("manifest", [[], (), [{"resource_ref": "resource-1"}], ({"resource_ref": "resource-1"},)])
def test_context_manifest_accepts_lists_and_tuples_with_public_json_roundtrip(manifest):
    context = ResolvedNativeTestContext.model_validate({**CONTEXT, "resource_manifest": manifest})
    assert isinstance(context.resource_manifest, tuple)
    assert context.model_dump(mode="json")["resource_manifest"] == list(manifest)
    restored = ResolvedNativeTestContext.model_validate_json(context.model_dump_json())
    assert restored.resource_manifest == context.resource_manifest
