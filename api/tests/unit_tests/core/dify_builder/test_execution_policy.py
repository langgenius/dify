"""Contracts for persisted execution records and fixtures."""

from typing import TYPE_CHECKING

import pytest
from pydantic import ValidationError

from runtime_contracts.builder import execution
from runtime_contracts.builder.execution import HttpResponseFixtureV1

if TYPE_CHECKING:
    from runtime_contracts.builder.execution import ExecutionEvidenceSummary


def fixture(**overrides: object) -> HttpResponseFixtureV1:
    return execution.HttpResponseFixtureV1(
        **{
            "node_id": "http",
            "source": "user_sample",
            "status_code": 201,
            "content_type": "text/plain",
            "body": "sample",
            **overrides,
        }
    )


def test_fixture_strict_integer_and_immutable() -> None:
    value = fixture()
    assert value.model_dump(mode="json")["status_code"] == 201
    with pytest.raises(ValidationError):
        fixture(status_code=True)
    mutate = value.__setattr__
    with pytest.raises(ValidationError):
        mutate("body", "changed")


@pytest.mark.parametrize(
    "overrides",
    [
        {"body": "\ud800"},
        {"body": "x" * 65537},
        {"body": "NaN", "content_type": "application/json"},
        {"body": '{"n":1e999}', "content_type": "application/json"},
        {"headers": {}},
        {"node_version": "latest"},
        {"node_id": ""},
        {"schema_version": True},
    ],
)
def test_invalid_fixture_rejected(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        fixture(**overrides)


def test_untrusted_fixture_decoder_is_strict_and_sanitized() -> None:
    sample = fixture().model_dump(mode="json")
    sample.pop("source")
    assert execution.decode_http_fixture_submission([sample])[0].source == "user_sample"
    invalid_cases: tuple[object, ...] = (
        None,
        {},
        [dict(sample, source="generated_sample")],
        [dict(sample, body="private", status_code=True)],
    )
    for raw in invalid_cases:
        with pytest.raises(execution.BuilderExecutionPolicyError) as error:
            execution.decode_http_fixture_submission(raw)
        assert "private" not in str(error.value)
    with pytest.raises(execution.BuilderExecutionPolicyError):
        execution.decode_http_fixture_submission([sample, sample])


def test_canonical_digests_reject_nonfinite_and_surrogates_preserve_array_order() -> None:
    assert execution.canonical_digest({"a": 1, "b": 2}) == execution.canonical_digest({"b": 2, "a": 1})
    assert execution.canonical_digest([1, 2]) != execution.canonical_digest([2, 1])
    for raw in (float("nan"), float("inf"), "\ud800", object(), {1: "x"}):
        with pytest.raises(execution.BuilderExecutionPolicyError):
            execution.canonical_digest(raw)


def _confirmed_summary(**changes: object) -> "ExecutionEvidenceSummary":
    values: dict[str, object] = {
        "request_id": "request-1",
        "policy_version": "builder-confirmed-gmail-read-v1",
        "mode": "confirmed_tool",
        "sealed": True,
        "safety_outcome": "confirmed_tool_completed",
        "sandbox_profile": "disabled",
        "native_run_id": "native-1",
        "consent_id": "consent-1",
        "action_state": "completed",
        "action_reason_code": "message_returned",
        **changes,
    }
    return execution.ExecutionEvidenceSummary.model_validate(values)


def test_confirmed_evidence_literals_and_sanitized_action_metadata() -> None:
    summary = _confirmed_summary()
    assert (summary.mode, summary.safety_outcome, summary.fixture_digest) == (
        "confirmed_tool",
        "confirmed_tool_completed",
        None,
    )
    unknown = _confirmed_summary(safety_outcome="execution_evidence_unknown", action_state=None, native_run_id=None)
    assert unknown.consent_id == "consent-1"


@pytest.mark.parametrize(
    "changes",
    [
        {"policy_version": "builder-restricted-v1"},
        {"mode": "restricted"},
        {"consent_id": None},
        {"action_state": "unknown"},
        {"native_run_id": None},
        {"sealed": False},
        {"fixture_digest": "a" * 64},
        {"action_reason_code": "Provider said: invalid_grant"},
        {"safety_outcome": "restricted_execution_completed"},
    ],
)
def test_confirmed_completion_cannot_be_constructed_without_complete_confirmed_shape(
    changes: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        _confirmed_summary(**changes)


@pytest.mark.parametrize(
    "changes",
    [
        {"consent_id": "consent-1"},
        {"action_state": "completed"},
        {"safety_outcome": "confirmed_tool_completed"},
        {"fixture_digest": None},
        {"mode": "confirmed_tool"},
    ],
)
def test_restricted_summary_cannot_carry_confirmed_metadata(changes: dict[str, object]) -> None:
    values: dict[str, object] = {
        "request_id": "request-1",
        "mode": "restricted",
        "sealed": True,
        "safety_outcome": "restricted_execution_completed",
        "sandbox_profile": "disabled",
        "fixture_digest": "a" * 64,
        **changes,
    }
    with pytest.raises(ValidationError):
        execution.ExecutionEvidenceSummary.model_validate(values)


def test_json_evidence_summary_is_strict() -> None:
    summary = execution.ExecutionEvidenceSummary(
        request_id="request-1",
        policy_version="builder-json-parse-v1",
        mode="restricted",
        sealed=True,
        safety_outcome="restricted_execution_completed",
        sandbox_profile="disabled",
        native_run_id="run-1",
    )
    assert summary.policy_version == "builder-json-parse-v1"
    mutations: tuple[dict[str, object], ...] = (
        {"fixture_digest": "a" * 64},
        {"consent_id": "consent-1"},
        {"mode": "mock"},
        {"sandbox_profile": "network-disabled-v1"},
        {"native_run_id": None},
    )
    for mutation in mutations:
        with pytest.raises(ValidationError):
            execution.ExecutionEvidenceSummary.model_validate({**summary.model_dump(mode="json"), **mutation})


@pytest.mark.parametrize(
    ("sealed", "admitted"),
    [(True, True), (False, False), (1, False), ("true", False), (None, False)],
    ids=["true", "false", "integer-one", "string-true", "null"],
)
def test_json_success_evidence_requires_raw_boolean_seal(sealed: bool | int | str | None, admitted: bool) -> None:
    values = {
        "request_id": "request-1",
        "policy_version": "builder-json-parse-v1",
        "mode": "restricted",
        "sealed": sealed,
        "safety_outcome": "restricted_execution_completed",
        "sandbox_profile": "disabled",
        "native_run_id": "run-1",
    }
    if admitted:
        assert execution.ExecutionEvidenceSummary.model_validate(values).sealed is True
    else:
        with pytest.raises(ValidationError):
            execution.ExecutionEvidenceSummary.model_validate(values)


def test_json_non_success_evidence_allows_exact_false_seal_and_legacy_coercion_is_unchanged() -> None:
    json_values = {
        "request_id": "request-1",
        "policy_version": "builder-json-parse-v1",
        "mode": "restricted",
        "sealed": False,
        "safety_outcome": "execution_evidence_unknown",
        "sandbox_profile": "disabled",
    }
    assert execution.ExecutionEvidenceSummary.model_validate(json_values).sealed is False
    for legacy_seal in (1, "true"):
        restricted = {
            **json_values,
            "policy_version": "builder-restricted-v1",
            "fixture_digest": "a" * 64,
            "sealed": legacy_seal,
        }
        confirmed = {
            **json_values,
            "policy_version": "builder-confirmed-gmail-read-v1",
            "mode": "confirmed_tool",
            "consent_id": "consent-1",
            "sealed": legacy_seal,
        }
        assert execution.ExecutionEvidenceSummary.model_validate(restricted).sealed is True
        assert execution.ExecutionEvidenceSummary.model_validate(confirmed).sealed is True
