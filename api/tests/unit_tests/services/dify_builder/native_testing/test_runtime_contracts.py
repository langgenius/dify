"""Adapter DTOs preserve durable execution state without granting authority."""

import ast
from pathlib import Path

import pytest
from pydantic import ValidationError

from runtime_contracts.builder.native import runtime_contracts
from runtime_contracts.builder.native.runtime_contracts import (
    NativeBuilderProjection,
    NativeCheckpointPayload,
    NativeWorkflowOutcome,
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


def test_checkpoint_roundtrip_preserves_recovery_state_and_input_references() -> None:
    checkpoint = NativeCheckpointPayload.model_validate(CHECKPOINT)
    restored = NativeCheckpointPayload.model_validate_json(checkpoint.model_dump_json())
    expected = {
        **CHECKPOINT,
        "approval_proposals": list[object](),
        "agent_associations": list[object](),
        "node_journals": [{**journal, "intents": list[object]()} for journal in CHECKPOINT["node_journals"]],
    }
    assert restored.model_dump(mode="json") == expected
    assert restored.node_journals[0].operation_keys[0].cursor == 0
    assert restored.input_result_refs == ("inputs-1",)


@pytest.mark.parametrize("field", ["graph", "inputs", "resource_manifest"])
@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf"), b"file bytes"])
def test_context_rejects_nonfinite_or_binary_json(field: str, bad: object) -> None:
    value = [{"nested": bad}] if field == "resource_manifest" else {"nested": [bad]}
    with pytest.raises(ValidationError):
        ResolvedNativeTestContext.model_validate({**CONTEXT, field: value})


@pytest.mark.parametrize("field", ["generate_entity_json", "graph_runtime_state_json", "response_stream_filter_json"])
@pytest.mark.parametrize("bad", ['{"broken":', '{"value":NaN}', '{"value":Infinity}', '{"value":-Infinity}'])
def test_checkpoint_rejects_invalid_or_nonfinite_json_strings(field: str, bad: str) -> None:
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
def test_waiting_requires_durable_checkpoint_run_pending_operations_and_reason(field: str, bad: object) -> None:
    with pytest.raises(ValidationError, match=field.removesuffix("_ref")):
        NativeWorkflowOutcome.model_validate({**WAITING, field: bad})


@pytest.mark.parametrize("native_status", ["succeeded", "failed", "partial-succeeded", "stopped"])
def test_native_terminal_states_are_completed_including_actual_failure(native_status: str) -> None:
    data = {
        **WAITING,
        "status": "completed",
        "wait_reason": None,
        "native_status": native_status,
        "checkpoint_ref": None,
        "pending_operation_ids": list[str](),
        "output_result_ref": "output-1",
    }
    outcome = NativeWorkflowOutcome.model_validate(data)
    assert outcome.status == "completed"
    assert outcome.native_status == native_status
    assert outcome.output_result_ref == "output-1"


@pytest.mark.parametrize("field", ["native_run_id", "native_status"])
def test_completed_requires_native_run_and_terminal_state(field: str) -> None:
    data = {**WAITING, "status": "completed", "wait_reason": None, "native_status": "failed", field: None}
    with pytest.raises(ValidationError, match=field):
        NativeWorkflowOutcome.model_validate(data)


@pytest.mark.parametrize("status", ["completed", "stopped", "unknown"])
def test_nonwaiting_outcome_rejects_wait_reason(status: str) -> None:
    with pytest.raises(ValidationError, match="wait_reason"):
        NativeWorkflowOutcome.model_validate({**WAITING, "status": status, "native_status": "failed"})


@pytest.mark.parametrize("status", ["waiting", "stopped", "unknown"])
def test_noncompleted_outcome_rejects_success_output(status: str) -> None:
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
def test_projection_disallows_diagnosis_and_new_run_for_control_routes(route: str, flag: str) -> None:
    data = {**PROJECTION, "route": route, "wait_reason": "approval" if route == "waiting" else None, flag: True}
    with pytest.raises(ValidationError, match=flag):
        NativeBuilderProjection.model_validate(data)


def test_runtime_contract_import_boundary_excludes_runtime_core_and_database_dependencies() -> None:
    tree = ast.parse(Path(runtime_contracts.__file__).read_text())
    imports: list[str] = []
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
        "runtime_contracts.builder.native.contracts",
        "runtime_contracts.builder.native.approval_contracts",
        "runtime_contracts.builder.native.agent_contracts",
        "runtime_contracts.builder.string_enum",
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
def test_context_rejects_manifest_generators_before_tuple_coercion(resource: dict[str, object]) -> None:
    manifest = (entry for entry in [resource])
    with pytest.raises(ValidationError, match="resource_manifest"):
        ResolvedNativeTestContext.model_validate({**CONTEXT, "resource_manifest": manifest})
