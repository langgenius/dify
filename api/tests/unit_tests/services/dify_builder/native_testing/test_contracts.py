"""Native protocol boundaries preserve typed identity and reject authority injection."""

import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from runtime_contracts.builder.execution import (
    BuilderExecutionPolicyError,
    canonical_digest,
    validate_execution_context,
)
from runtime_contracts.builder.native.contracts import (
    ApprovalWait,
    CancellationReceipt,
    CheckpointRef,
    DispatchPermit,
    EffectDecision,
    EffectIntent,
    EffectReceipt,
    NativeTestContextRef,
    OperationKey,
    PolicyStop,
    RecordedResult,
    ResumeReceipt,
    WaitingReceipt,
    decode_native_ref,
    operation_digest,
)

REF = {"request_id": "req-1", "invocation_id": "inv-1", "context_digest": "a" * 64}
KEY = {"invocation_id": "inv-1", "occurrence_path": ("iteration-1", "0", "tool-1"), "cursor": 0}
INTENT = {
    "key": KEY,
    "kind": "tool",
    "resource_ref": "resource-1",
    "implementation_revision": "revision-1",
    "account_ref": None,
    "target": {"file": {"id": "file-1"}},
    "parameters": {"enabled": True, "items": [1, 2]},
    "input_digest": "b" * 64,
    "capability_digest": "c" * 64,
}


def test_operation_identity_survives_json_roundtrip_and_distinguishes_occurrences():
    key = OperationKey(**KEY)
    assert operation_digest(key) == operation_digest(OperationKey.model_validate_json(key.model_dump_json()))
    for changes in ({"cursor": 1}, {"invocation_id": "inv-2"}, {"occurrence_path": ("iteration-1", "1", "tool-1")}):
        assert operation_digest(key) != operation_digest(OperationKey(**{**KEY, **changes}))


@pytest.mark.parametrize(
    ("typed", "string"), [(True, "true"), ([1, 2], "[1,2]"), ({"file": {"id": "f"}}, '{"file":{"id":"f"}}')]
)
def test_effect_parameters_preserve_json_types(typed, string):
    actual = EffectIntent(**{**INTENT, "parameters": typed})
    text = EffectIntent(**{**INTENT, "parameters": string})
    assert canonical_digest(actual.model_dump(mode="json")) != canonical_digest(text.model_dump(mode="json"))
    assert EffectIntent.model_validate_json(actual.model_dump_json()).parameters == typed


@pytest.mark.parametrize("field", ["target", "parameters"])
@pytest.mark.parametrize(
    "bad", [float("nan"), float("inf"), float("-inf"), {"nested": [float("nan")]}, {"x": "\ud800"}, (1, 2), {1: "key"}]
)
def test_effect_rejects_non_json_or_non_finite_values(field, bad):
    with pytest.raises(ValidationError):
        EffectIntent(**{**INTENT, field: bad})


@pytest.mark.parametrize("bad", [True, -1, 1.0, "1", 2**63])
def test_operation_cursor_rejects_coercion_and_out_of_range(bad):
    with pytest.raises(ValidationError):
        OperationKey(**{**KEY, "cursor": bad})


@pytest.mark.parametrize(
    "changes",
    [
        {"invocation_id": ""},
        {"invocation_id": "x" * 129},
        {"invocation_id": 12},
        {"invocation_id": "\ud800"},
        {"occurrence_path": ()},
        {"occurrence_path": ("",)},
        {"occurrence_path": ("\ud800",)},
        {"occurrence_path": ("x",) * 129},
    ],
)
def test_operation_rejects_unbounded_or_invalid_identity(changes):
    with pytest.raises(ValidationError):
        OperationKey(**{**KEY, **changes})


def test_native_decode_only_structurally_validates_reference():
    decoded = decode_native_ref(REF)
    assert decoded.model_dump(mode="json") == {"policy_version": "builder-native-test-v1", **REF}
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_execution_context"):
        validate_execution_context(decoded.model_dump(mode="json"))


@pytest.mark.parametrize(
    "changes",
    [
        {"actor": "admin"},
        {"grant": True},
        {"secret": "sensitive-value"},
        {"policy_version": "builder-unknown-v9"},
        {"context_digest": "a" * 63},
        {"context_digest": "A" * 64},
        {"request_id": ""},
        {"request_id": "x" * 129},
        {"request_id": "\ud800"},
    ],
)
def test_decode_rejects_invalid_ref_and_client_authority(changes):
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_native_test_ref") as error:
        decode_native_ref({**REF, **changes})
    assert "sensitive-value" not in str(error.value)


@pytest.mark.parametrize("raw", [None, [], "ref", 1, True])
def test_decode_rejects_non_object(raw):
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_native_test_ref"):
        decode_native_ref(raw)


@pytest.mark.parametrize("timestamp", ["2026-10-14T10:00:00Z", "2026-10-14T10:00:00.123456+00:00"])
def test_dispatch_utc_timestamp_roundtrips(timestamp):
    permit = DispatchPermit(permit_id="p", attempt_id="a", operation_id="o", expires_at=timestamp)
    assert DispatchPermit.model_validate_json(permit.model_dump_json()).expires_at == timestamp


@pytest.mark.parametrize(
    "bad", ["2026-10-14T10:00:00", "2026-10-14", "2026-10-14T10:00:00+01:00", "2026-02-30T10:00:00Z", 1234]
)
def test_dispatch_rejects_non_utc_or_invalid_time(bad):
    with pytest.raises(ValidationError):
        DispatchPermit(permit_id="p", attempt_id="a", operation_id="o", expires_at=bad)


@pytest.mark.parametrize(
    "decision",
    [
        DispatchPermit(permit_id="p", attempt_id="a", operation_id="o", expires_at="2026-10-14T10:00:00Z"),
        ApprovalWait(pending_operation_id="o", wait_reason="configuration"),
        RecordedResult(operation_id="o", result_ref="r"),
        PolicyStop(reason_code="budget_exhausted"),
    ],
)
def test_decisions_decode_by_tag_without_losing_variant(decision):
    adapter = TypeAdapter(EffectDecision)
    assert adapter.validate_json(decision.model_dump_json()) == decision
    with pytest.raises(ValidationError):
        adapter.validate_python({**decision.model_dump(), "kind": "unknown"})


@pytest.mark.parametrize(
    ("model", "raw"),
    [
        (NativeTestContextRef, REF),
        (OperationKey, KEY),
        (EffectIntent, INTENT),
        (CheckpointRef, {"checkpoint_id": "c", "payload_digest": "a" * 64}),
        (EffectReceipt, {"operation_id": "o", "attempt_id": "a", "outcome": "unknown", "result_ref": None}),
    ],
)
def test_domain_dtos_reject_secret_fields(model, raw):
    with pytest.raises(ValidationError) as error:
        model.model_validate({**raw, "secret": "sensitive-value"})
    assert "sensitive-value" not in str(error.value)


@pytest.mark.parametrize("bad", [True, -1, "1", 2**63])
def test_lifecycle_generation_is_strict_nonnegative(bad):
    with pytest.raises(ValidationError):
        ResumeReceipt(request_id="r", generation=bad, dispatch_id="d", status="queued")


def test_lifecycle_receipts_preserve_wait_and_cancellation_outcomes():
    wait = WaitingReceipt(
        request_id="r",
        invocation_id="i",
        generation=0,
        checkpoint=CheckpointRef(checkpoint_id="c", payload_digest="a" * 64),
        pending_operation_ids=("o",),
        wait_reason="interaction",
    )
    assert WaitingReceipt.model_validate_json(wait.model_dump_json()).wait_reason == "interaction"
    cancellation = CancellationReceipt(
        request_id="r", generation=1, status="unknown", operation_states={"o": "unknown"}
    )
    assert CancellationReceipt.model_validate_json(cancellation.model_dump_json()).operation_states == {"o": "unknown"}
    with pytest.raises(ValidationError):
        CancellationReceipt(request_id="r", generation=1, status="cancelled", operation_states={"": "completed"})


def test_saved_legacy_contexts_still_roundtrip_and_are_not_native_refs():
    path = (
        Path(__file__).resolve().parents[4] / "fixtures/workflow/builder_restricted/pre_extraction_context_goldens.json"
    )
    for golden in json.loads(path.read_text())["cases"].values():
        decoded = validate_execution_context(golden["raw"])
        assert decoded.model_dump(mode="json") == golden["normalized"]
        with pytest.raises(BuilderExecutionPolicyError, match="invalid_native_test_ref"):
            decode_native_ref(golden["raw"])
