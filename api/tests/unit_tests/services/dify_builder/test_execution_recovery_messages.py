import pytest

from runtime_contracts.builder.presentation import BuilderCopy
from services.dify_builder.execution_messages import execution_refusal_message


@pytest.mark.parametrize(
    ("reason", "copy_id"),
    [
        ("execution_permission_denied", "test.permissionDenied"),
        ("execution_owner_mismatch", "test.permissionDenied"),
        ("stale_execution_revision", "test.contextChanged"),
        ("test_input_binding_mismatch", "test.contextChanged"),
        ("effective_input_binding_mismatch", "test.contextChanged"),
        ("code_risk_assessment_stale", "test.policyReview"),
        ("installed_tool_unavailable", "resources.catalogueUnavailable"),
    ],
)
def test_known_recovery_reason_is_not_generic_safety(reason: str, copy_id: str) -> None:
    message = execution_refusal_message(reason)
    assert isinstance(message, BuilderCopy)
    assert message.id == copy_id


def test_known_model_failure_does_not_ask_user_to_change_requirements() -> None:
    from services.dify_builder.execution_messages import cognition_failure_message

    message = cognition_failure_message(
        [{"code": "provider_invocation_failed", "reason": "connection_refused", "message": "private secret"}],
        "change the goal",
    )
    assert isinstance(message, BuilderCopy)
    assert message.id == "operation.modelFailed"
    assert message.params == {"reason": "connection refused"}
    assert cognition_failure_message([], "fallback") == "fallback"


@pytest.mark.parametrize("known_terminal", [True, False])
def test_tool_configuration_error_is_distinct_from_unknown_execution(known_terminal: bool) -> None:
    from core.dify_builder.models import Run, RunVerification
    from runtime_contracts.builder.execution import ExecutionEvidenceSummary
    from services.dify_builder.application.verification import is_execution_policy_blocker, result_card
    from tests.unit_tests.services.dify_builder.presentation_helpers import english_text

    error = "JSON Parse: required content is empty"
    summary = ExecutionEvidenceSummary(
        request_id="request",
        policy_version="builder-confirmed-run-v1",
        mode="confirmed_run",
        sealed=known_terminal,
        safety_outcome="native_failed" if known_terminal else "execution_evidence_unknown",
        native_run_id="native" if known_terminal else None,
        sandbox_profile="native",
    )
    run = Run(
        status="failed" if known_terminal else "unknown",
        kind="verify",
        error=error,
        dify_run_id="native" if known_terminal else "",
        verification=RunVerification(
            execution_revision="rev",
            executed_graph_revision="graph",
            terminal_outputs=None,
            output_findings=[],
            executed_node_ids=[],
            no_output_dead_branch=False,
            execution_evidence=summary,
        ),
    )
    card = result_card(run)
    assert card.outcome == ("execution_failed" if known_terminal else "execution_unknown")
    assert is_execution_policy_blocker(run) is not known_terminal
    if known_terminal:
        assert english_text(card.failure_reason) == error
    else:
        assert error not in english_text(card.failure_reason)


@pytest.mark.parametrize(("language", "expected"), [("zh-Hans", "连接被拒绝"), ("en-US", "connection refused")])
def test_diagnostic_reason_uses_reply_language_without_echoing_provider_text(language: str, expected: str) -> None:
    from services.dify_builder.execution_messages import cognition_failure_message

    message = cognition_failure_message(
        [{"code": "provider_invocation_failed", "reason": "connection_refused", "message": "secret-token"}],
        "fallback",
        reply_language=language,
    )
    assert isinstance(message, BuilderCopy)
    assert message.params == {"reason": expected}


@pytest.mark.parametrize(("scope", "expected"), [("structure", "结构"), ("configuration", "配置")])
def test_change_scope_localizes_display_only(scope: str, expected: str) -> None:
    from services.dify_builder.execution_messages import change_scope_label

    assert change_scope_label(scope, "zh-Hans") == expected
    assert change_scope_label(scope, "en-US") == scope
    assert change_scope_label("future_scope", "zh-Hans") == "future_scope"


def test_preparation_failure_localizes_reason_and_retains_machine_evidence() -> None:
    from core.dify_builder.models import Run, RunVerification
    from runtime_contracts.builder.execution import ExecutionEvidenceSummary
    from services.dify_builder.application.verification import result_card

    summary = ExecutionEvidenceSummary(
        request_id="request",
        policy_version="builder-confirmed-run-v1",
        mode="confirmed_run",
        sealed=True,
        safety_outcome="preparation_failed",
        sandbox_profile="native",
        failure_phase="preparation",
        failure_reason="connection_refused",
    )
    before = summary.model_dump()
    run = Run(
        status="failed",
        kind="verify",
        verification=RunVerification(
            execution_revision="rev",
            executed_graph_revision="graph",
            terminal_outputs=None,
            output_findings=[],
            executed_node_ids=[],
            no_output_dead_branch=False,
            execution_evidence=summary,
        ),
    )
    card = result_card(run, reply_language="zh-Hans")
    assert isinstance(card.failure_reason, BuilderCopy)
    assert card.failure_reason.params == {"reason": "连接被拒绝"}
    assert card.failure_code == "connection_refused"
    assert summary.model_dump() == before
