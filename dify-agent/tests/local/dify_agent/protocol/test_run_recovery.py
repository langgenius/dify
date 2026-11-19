"""Complete create identity and bounded recovery DTO contract."""

import importlib

import pytest
from pydantic import ValidationError

from dify_agent.protocol.schemas import CreateRunRequest


def request(**changes):
    return CreateRunRequest.model_validate(
        {"composition": {"layers": [{"name": "prompt", "config": {"user": "hello"}}]}, **changes}
    )


def test_fingerprint_binds_metadata_and_snapshot_but_not_key_or_object_order():
    recovery = importlib.import_module("dify_agent.protocol.run_recovery")
    original = request(idempotency_key="first", metadata={"a": 1, "b": 2})
    same = request(idempotency_key="second", metadata={"b": 2, "a": 1})
    assert recovery.create_run_fingerprint(original) == recovery.create_run_fingerprint(same)
    assert recovery.create_run_fingerprint(original) != recovery.create_run_fingerprint(
        request(metadata={"a": 2, "b": 2})
    )
    assert recovery.create_run_fingerprint(original) != recovery.create_run_fingerprint(
        request(metadata={"a": 1, "b": 2}, session_snapshot={"schema_version": 2, "layers": {}})
    )


def test_fingerprint_keeps_the_stored_admission_encoding_for_non_ascii_requests():
    # Fixed digests from the pre-native scheduler fingerprint (main 74dc472fff,
    # run_scheduler._create_run_fingerprint). Records it stored replay after an
    # upgrade only if ordinary requests hash the same field set and encoding.
    recovery = importlib.import_module("dify_agent.protocol.run_recovery")
    non_ascii = request(idempotency_key="node-exec-1", metadata={"title": "季度报告", "a": 1})
    with_snapshot = request(idempotency_key="k", session_snapshot={"schema_version": 2, "layers": {}})
    assert (
        recovery.create_run_fingerprint(non_ascii) == "1d9159796da8f1aa207fdc56bc9acfd6232db3ee8e4e7c8de742df9e7bbe7284"
    )
    assert (
        recovery.create_run_fingerprint(with_snapshot)
        == "0e2266e1e1961a05d486881e6f86985d707f4b9a1359e7f76fd8b4a5b45cbe0b"
    )


def test_builder_test_fingerprint_binds_native_fields():
    recovery = importlib.import_module("dify_agent.protocol.run_recovery")
    ref = {
        "policy_version": "builder-native-test-v1",
        "request_id": "req",
        "invocation_id": "inv",
        "context_digest": "a" * 64,
    }
    parent = {
        "ref": ref,
        "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
        "input_result_ref": "input",
        "input_digest": "b" * 64,
    }
    native = {
        "execution_mode": "builder_test",
        "native_test_ref": ref,
        "native_test_protocol_version": 1,
        "native_parent_node": parent,
        "idempotency_key": "key",
    }
    isolated = request(**native)
    confirmed = request(**native, native_test_profile="confirmed")
    other_parent = request(**(native | {"native_parent_node": parent | {"input_digest": "c" * 64}}))
    ordinary = request(idempotency_key="key")
    fingerprints = {recovery.create_run_fingerprint(item) for item in (isolated, confirmed, other_parent, ordinary)}
    assert len(fingerprints) == 4


@pytest.mark.parametrize(
    "changes",
    [
        {"idempotency_key": ""},
        {"idempotency_key": "k" * 257},
        {"request_digest": "A" * 64},
        {"request_digest": "f" * 65},
        {"composition": {}},
    ],
)
def test_lookup_refuses_unbounded_or_configuration_payload(changes):
    recovery = importlib.import_module("dify_agent.protocol.run_recovery")
    with pytest.raises(ValidationError):
        recovery.LookupRunRequest.model_validate({"idempotency_key": "key", "request_digest": "a" * 64, **changes})
