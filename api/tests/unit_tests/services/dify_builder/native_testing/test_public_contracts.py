"""Public native test boundaries reject caller authority and coercion."""

import importlib.util

import pytest
from pydantic import ValidationError


def contracts():
    name = "services.dify_builder.native_testing.public_contracts"
    assert importlib.util.find_spec(name) is not None, "native public DTO owner is missing"
    return __import__(name, fromlist=["NativeTestStartPayload"])


def start():
    return dict(schema_version="builder-native-test-v1", test_input_id="input", expected_version=1,
                mode="native", idempotency_key="start-1")


def decision():
    return dict(schema_version="builder-native-test-v1", pending_operation_id="pending", decision="confirm",
                scope_digest="a" * 64, expected_version=1, idempotency_key="decision-1")


@pytest.mark.parametrize("extra", ["actor", "tenant_id", "ref", "permit", "graph", "parameters", "result", "budget"])
def test_start_rejects_caller_authority(extra):
    model = contracts().NativeTestStartPayload
    with pytest.raises(ValidationError):
        model.model_validate({**start(), extra: {"secret": "never-disclose"}})


@pytest.mark.parametrize("version", [True, "1", 1.0, -1, 2**63])
def test_start_version_is_strict_bounded_integer(version):
    model = contracts().NativeTestStartPayload
    with pytest.raises(ValidationError):
        model.model_validate({**start(), "expected_version": version})


@pytest.mark.parametrize("value", ["", "a" * 129, 1, "\ud800"])
def test_public_ids_use_shared_strict_utf8_bounds(value):
    model = contracts().NativeTestStartPayload
    with pytest.raises((ValidationError, ValueError)):
        model.model_validate({**start(), "idempotency_key": value})


@pytest.mark.parametrize("extra", ["parameters", "target", "account_ref", "max_calls", "permit", "intent"])
def test_decision_cannot_replace_parameters_or_expand_grant(extra):
    model = contracts().NativeTestDecisionPayload
    with pytest.raises(ValidationError):
        model.model_validate({**decision(), extra: {"secret": "never-disclose"}})


def test_each_public_command_roundtrips_only_its_contract():
    c = contracts()
    for model, body in ((c.NativeTestStartPayload, start()), (c.NativeTestDecisionPayload, decision()),
                        (c.NativeTestResumePayload, dict(schema_version="builder-native-test-v1", expected_generation=0,
                                                        idempotency_key="resume-1")),
                        (c.NativeTestCancelPayload, dict(schema_version="builder-native-test-v1", idempotency_key="cancel-1"))):
        assert model.model_validate(body).model_dump(mode="json") == body
        with pytest.raises(ValidationError):
            model.model_validate({**body, "context_digest": "b" * 64})


def test_public_receipt_has_no_private_execution_fields():
    c = contracts()
    schema = c.NativeTestPublicReceipt.model_json_schema()
    assert set(schema["properties"]) == {
        "schema_version", "request_id", "generation", "version", "status", "wait_reason", "native_run_id",
        "native_status", "pending", "outcome", "evidence_refs",
    }
    assert schema["additionalProperties"] is False
