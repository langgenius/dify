"""Pure private recovery records fence attempts without executing lifecycle work."""

import pytest
from pydantic import ValidationError

from services.dify_builder.native_testing import agent_recovery_state as state


def record_payload() -> dict[str, object]:
    identity = state.AgentRecoveryAttemptIdentity(
        invocation_id="inv",
        parent_execution_id="exec",
        predecessor_binding_id="old-b",
        predecessor_checkpoint_digest="a" * 64,
        predecessor_workspace_generation=0,
    )
    return {
        "protocol_version": 1,
        "identity": identity.model_dump(),
        "attempt_id": state.recovery_attempt_id(identity),
        "predecessor": {
            "binding_id": "old-b",
            "workspace_id": "old-w",
            "binding_ref": "old-b:old-w",
            "workspace_ref": "old-w",
            "workspace_generation": 0,
            "association_object_ref": "association",
            "config_ref": "config",
            "config_digest": "b" * 64,
        },
        "predecessor_checkpoint": {"checkpoint_id": "cp", "payload_digest": "a" * 64},
        "parent_generation": 1,
        "agent_generation": 2,
        "reserved_binding_id": "new-b",
        "reserved_workspace_id": "new-w",
        "next_workspace_generation": 1,
        "input_digest": "c" * 64,
        "definition_digest": "d" * 64,
        "home_snapshot_id": None,
        "home_snapshot_digest": None,
        "interaction_idempotency_digest": "e" * 64,
        "phase": "reserved",
        "evidence_object_ref": "evidence",
        "allocation_receipt_ref": None,
        "successor_object_ref": None,
        "successor_digest": None,
        "sdk_receipt_ref": None,
        "successor_wait_ref": None,
    }


def test_attempt_identity_coalesces_interactions_but_changes_with_predecessor() -> None:
    payload = record_payload()
    record = state.AgentRecoveryRecord.model_validate(payload)
    other = {**payload, "interaction_idempotency_digest": "f" * 64}
    assert state.AgentRecoveryRecord.model_validate(other).attempt_id == record.attempt_id
    changed = state.AgentRecoveryAttemptIdentity.model_validate(
        {**record.identity.model_dump(), "predecessor_workspace_generation": 1}
    )
    assert state.recovery_attempt_id(changed) != record.attempt_id
    assert state.AgentRecoveryRecord.model_validate_json(record.model_dump_json()) == record


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("protocol_version", 2),
        ("phase", "retry"),
        ("attempt_id", "0" * 64),
        ("next_workspace_generation", 0),
        ("allocation_receipt_ref", ""),
        ("secret", "private"),
        ("phase", "allocated"),
    ],
)
def test_record_rejects_invalid_refs_versions_phases_and_identity(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        state.AgentRecoveryRecord.model_validate({**record_payload(), field: value})


def test_phase_transition_is_pure_and_never_retries_unknown_or_changes_immutable_args() -> None:
    current = state.AgentRecoveryRecord.model_validate(record_payload())
    creating = state.AgentRecoveryRecord.model_validate({**current.model_dump(), "phase": "creating"})
    assert state.advance_recovery_record(current, creating) == creating
    unknown = state.AgentRecoveryRecord.model_validate({**creating.model_dump(), "phase": "unknown"})
    assert state.advance_recovery_record(creating, unknown) == unknown
    with pytest.raises(ValueError, match="invalid recovery phase"):
        state.advance_recovery_record(unknown, creating)
    conflicting = state.AgentRecoveryRecord.model_validate(
        {**creating.model_dump(), "reserved_binding_id": "different"}
    )
    with pytest.raises(ValueError, match="conflicting immutable"):
        state.advance_recovery_record(current, conflicting)
    allocated = state.AgentRecoveryRecord.model_validate(
        {**creating.model_dump(), "phase": "allocated", "allocation_receipt_ref": "ack"}
    )
    assert state.advance_recovery_record(creating, allocated) == allocated
    with pytest.raises(ValueError, match="conflicting acknowledged"):
        state.advance_recovery_record(
            allocated,
            state.AgentRecoveryRecord.model_validate({**allocated.model_dump(), "allocation_receipt_ref": "conflict"}),
        )


def test_sql_ready_preserves_separate_sdk_receipt_and_wait_acknowledgements() -> None:
    allocated = state.AgentRecoveryRecord.model_validate(
        {**record_payload(), "phase": "allocated", "allocation_receipt_ref": "allocation-ack"}
    )
    ready = state.AgentRecoveryRecord.model_validate(
        {**allocated.model_dump(), "phase": "ready", "successor_object_ref": "relation", "successor_digest": "f" * 64}
    )
    assert state.advance_recovery_record(allocated, ready) == ready
    receipt = state.AgentRecoveryRecord.model_validate({**ready.model_dump(), "sdk_receipt_ref": "sdk-ack"})
    assert state.advance_recovery_record(ready, receipt).successor_wait_ref is None
    refreshed = state.AgentRecoveryRecord.model_validate({**receipt.model_dump(), "successor_wait_ref": "new-wait"})
    assert state.advance_recovery_record(receipt, refreshed).successor_wait_ref == "new-wait"
    with pytest.raises(ValidationError):
        state.AgentRecoveryRecord.model_validate({**ready.model_dump(), "successor_wait_ref": "new-wait"})
