"""Unit boundary failures; SQL lifecycle behavior is covered in normal CI."""

import pytest
from pydantic import ValidationError


def test_pending_resolution_cannot_claim_configuration_without_account():
    from services.dify_builder.native_testing.lifecycle import NativePendingResolution

    with pytest.raises(ValidationError):
        NativePendingResolution(
            category="configuration",
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
    raw, digest = encode_payload(tenant_id="t", request_id="r", invocation_id="i", kind="result", payload=payload)
    payload["inputs"].clear()
    assert decode_payload(raw, tenant_id="t", request_id="r", invocation_id="i", kind="result", digest=digest) == {
        "inputs": [True, 1, "1"]
    }
