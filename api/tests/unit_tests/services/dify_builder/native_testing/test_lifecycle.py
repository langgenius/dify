"""Unit boundary failures; SQL lifecycle behavior is covered in normal CI."""

from typing import cast

import pytest
from pydantic import ValidationError
from services.dify_builder.native_testing.contracts import JsonValue


def test_pending_resolution_cannot_claim_configuration_without_account():
    from services.dify_builder.native_testing.lifecycle import NativePendingResolution

    with pytest.raises(ValidationError):
        NativePendingResolution(
            category="configuration",
            invocation_id="inv",
            pending_action_id="pending",
            owner_ref="owner",
            reference="config",
            resolved=True,
            account_ref=None,
            answer_result_ref=None,
        )


def test_pending_resolution_cannot_replace_form_answer_with_account():
    from services.dify_builder.native_testing.lifecycle import NativePendingResolution

    with pytest.raises(ValidationError):
        NativePendingResolution(
            category="interaction",
            invocation_id="inv",
            pending_action_id="pending",
            owner_ref="owner",
            reference="form",
            resolved=True,
            account_ref="account",
            answer_result_ref=None,
        )


def test_pending_resolution_never_coerces_client_boolean():
    from services.dify_builder.native_testing.lifecycle import NativePendingResolution

    with pytest.raises(ValidationError):
        NativePendingResolution(
            category="configuration",
            invocation_id="inv",
            pending_action_id="pending",
            owner_ref="owner",
            reference="config",
            resolved="true",
            account_ref="account",
            answer_result_ref=None,
        )


def test_payload_codec_rejects_cross_owner_and_changed_typed_payload():
    from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.state_store import decode_payload, encode_payload

    raw, digest = encode_payload(tenant_id="t", request_id="r", invocation_id="i", kind="result", payload={"x": True})
    assert decode_payload(raw, tenant_id="t", request_id="r", invocation_id="i", kind="result", digest=digest) == {
        "x": True
    }
    with pytest.raises(BuilderExecutionPolicyError):
        decode_payload(raw, tenant_id="other", request_id="r", invocation_id="i", kind="result", digest=digest)
    with pytest.raises(BuilderExecutionPolicyError):
        decode_payload(
            raw.replace("true", '"true"'),
            tenant_id="t",
            request_id="r",
            invocation_id="i",
            kind="result",
            digest=digest,
        )


def test_payload_codec_snapshots_caller_mutation():
    from services.dify_builder.native_testing.state_store import decode_payload, encode_payload

    payload = {"inputs": [True, 1, "1"]}
    raw, digest = encode_payload(
        tenant_id="t", request_id="r", invocation_id="i", kind="result", payload=cast(JsonValue, payload)
    )
    payload["inputs"].clear()
    assert decode_payload(raw, tenant_id="t", request_id="r", invocation_id="i", kind="result", digest=digest) == {
        "inputs": [True, 1, "1"]
    }


def test_controlling_proof_keeps_independently_unknown_and_completed_branches_inactive():
    from types import SimpleNamespace

    from services.dify_builder.native_testing.transitions import recoverable_invocation_ids

    def state(identity, parent, status):
        return SimpleNamespace(invocation_id=identity, parent_invocation_id=parent, state=status)

    # Descendants precede parents deliberately; topology, not row order, decides.
    states = [
        state("unknown-leaf", "unknown-child", "running"),
        state("live-leaf", "live-child", "waiting"),
        state("completed-leaf", "completed-child", "queued"),
        state("unknown-child", "root", "unknown"),
        state("completed-child", "root", "completed"),
        state("live-child", "root", "running"),
        state("root", None, "queued"),
    ]
    assert recoverable_invocation_ids(states, "root") == {"root", "live-child", "live-leaf"}
