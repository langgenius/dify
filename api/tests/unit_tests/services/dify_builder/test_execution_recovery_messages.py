import pytest

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
def test_known_recovery_reason_is_not_generic_safety(reason, copy_id):
    assert execution_refusal_message(reason).id == copy_id


def test_known_model_failure_does_not_ask_user_to_change_requirements():
    from services.dify_builder.execution_messages import cognition_failure_message

    message = cognition_failure_message(
        [{"code": "provider_invocation_failed", "reason": "connection_refused", "message": "private secret"}],
        "change the goal",
    )
    assert message.id == "operation.modelFailed"
    assert message.params == {"reason": "connection_refused"}
    assert cognition_failure_message([], "fallback") == "fallback"
