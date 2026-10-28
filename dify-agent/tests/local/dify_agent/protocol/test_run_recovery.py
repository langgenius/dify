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
