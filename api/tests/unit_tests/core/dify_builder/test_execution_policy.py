"""Contracts for persisted execution records and fixtures."""

import importlib
from types import ModuleType
from typing import TYPE_CHECKING

import pytest
from pydantic import ValidationError

from services.dify_builder.application.execution_policy import HttpResponseFixtureV1

if TYPE_CHECKING:
    from services.dify_builder.application.execution_policy import ExecutionEvidenceSummary


def policy() -> ModuleType:
    return importlib.import_module("services.dify_builder.application.execution_policy")


def fixture(**overrides: object) -> HttpResponseFixtureV1:
    return policy().HttpResponseFixtureV1(
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
    p = policy()
    sample = fixture().model_dump(mode="json")
    sample.pop("source")
    assert p.decode_http_fixture_submission([sample])[0].source == "user_sample"
    invalid_cases: tuple[object, ...] = (
        None,
        {},
        [dict(sample, source="generated_sample")],
        [dict(sample, body="private", status_code=True)],
    )
    for raw in invalid_cases:
        with pytest.raises(p.BuilderExecutionPolicyError) as error:
            p.decode_http_fixture_submission(raw)
        assert "private" not in str(error.value)
    with pytest.raises(p.BuilderExecutionPolicyError):
        p.decode_http_fixture_submission([sample, sample])


def test_canonical_digests_reject_nonfinite_and_surrogates_preserve_array_order() -> None:
    p = policy()
    assert p.canonical_digest({"a": 1, "b": 2}) == p.canonical_digest({"b": 2, "a": 1})
    assert p.canonical_digest([1, 2]) != p.canonical_digest([2, 1])
    for raw in (float("nan"), float("inf"), "\ud800", object(), {1: "x"}):
        with pytest.raises(p.BuilderExecutionPolicyError):
            p.canonical_digest(raw)


@pytest.mark.parametrize("values", [{"extra": []}, {"extra": {}}, {"extra": float("inf")}, {"extra": "\ud800"}])
def test_all_submitted_values_must_be_scalars(values: dict[str, object]) -> None:
    with pytest.raises(policy().BuilderExecutionPolicyError):
        policy().scalar_inputs_digest(values)


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
    return policy().ExecutionEvidenceSummary.model_validate(values)


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
        policy().ExecutionEvidenceSummary.model_validate(values)


def test_trusted_completion_accepts_either_context_variant_and_rejects_unknown_tags() -> None:
    p = policy()
    values: dict[str, object] = {
        "request_id": "request-1",
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "workflow_id": "workflow-1",
        "actor_id": "actor-1",
        "session_id": "session-1",
        "test_input_id": "input-1",
        "execution_revision": "a" * 64,
        "graph_revision": "b" * 64,
        "submitted_inputs_digest": "c" * 64,
        "effective_inputs_digest": "d" * 64,
        "mode": "confirmed_tool",
        "sandbox_profile": "disabled",
        "admitted_nodes": (),
        "consent_id": "consent-1",
        "scope_digest": "e" * 64,
        "command_id": "command-1",
        "policy_version": "builder-confirmed-gmail-read-v1",
    }
    initial = p.ConfirmedToolExecutionContext.model_validate({**values, "context_digest": "0" * 64})
    context = initial.model_copy(update={"context_digest": p.context_digest(initial)})
    completion = p.TrustedExecutionCompletion(
        context=context,
        native_run_id="native-1",
        task_id="task-1",
        worker_finished=True,
        worker_exit="returned",
        recorder_healthy=True,
        response_completed=True,
    )
    decoded = p.TrustedExecutionCompletion.model_validate(completion.model_dump(mode="json"))
    assert isinstance(decoded.context, p.ConfirmedToolExecutionContext)
    raw = completion.model_dump(mode="json")
    raw["context"]["policy_version"] = "builder-unknown-v9"
    with pytest.raises(ValidationError):
        p.TrustedExecutionCompletion.model_validate(raw)


def test_json_evidence_variant_and_receipt_are_strict() -> None:
    p = policy()
    summary = p.ExecutionEvidenceSummary(
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
            p.ExecutionEvidenceSummary.model_validate({**summary.model_dump(mode="json"), **mutation})

    receipt = p.BuilderExecutionObservation(
        observation_id="receipt-1",
        invocation_id="invocation-1",
        request_id="request-1",
        node_id="node2",
        kind="qualified_json_completed",
        implementation_version="graphon.nodes.tool.tool_node.ToolNode:1",
        reason_code="json_parse_completed",
        native_node_execution_id="execution-1",
        qualification_digest="a" * 64,
        installed_binding_digest="b" * 64,
        final_parameters_digest="c" * 64,
        pre_binding_digest="b" * 64,
        post_binding_digest="b" * 64,
        native_text_output_digest="d" * 64,
        text_bytes=65536,
        text_messages=8,
    )
    assert receipt.kind == "qualified_json_completed"
    mutations: tuple[dict[str, object], ...] = (
        {"text_bytes": 65537},
        {"text_messages": 9},
        {"fixture_digest": "e" * 64},
        {"native_node_execution_id": None},
        {"kind": "fixture_served"},
    )
    for mutation in mutations:
        with pytest.raises(ValidationError):
            p.BuilderExecutionObservation.model_validate({**receipt.model_dump(mode="json"), **mutation})


@pytest.mark.parametrize(
    ("sealed", "admitted"),
    [(True, True), (False, False), (1, False), ("true", False), (None, False)],
    ids=["true", "false", "integer-one", "string-true", "null"],
)
def test_json_success_evidence_requires_raw_boolean_seal(sealed: bool | int | str | None, admitted: bool) -> None:
    p = policy()
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
        assert p.ExecutionEvidenceSummary.model_validate(values).sealed is True
    else:
        with pytest.raises(ValidationError):
            p.ExecutionEvidenceSummary.model_validate(values)


def test_json_non_success_evidence_allows_exact_false_seal_and_legacy_coercion_is_unchanged() -> None:
    p = policy()
    json_values = {
        "request_id": "request-1",
        "policy_version": "builder-json-parse-v1",
        "mode": "restricted",
        "sealed": False,
        "safety_outcome": "execution_evidence_unknown",
        "sandbox_profile": "disabled",
    }
    assert p.ExecutionEvidenceSummary.model_validate(json_values).sealed is False
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
        assert p.ExecutionEvidenceSummary.model_validate(restricted).sealed is True
        assert p.ExecutionEvidenceSummary.model_validate(confirmed).sealed is True
