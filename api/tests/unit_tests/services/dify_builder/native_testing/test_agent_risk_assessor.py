from types import SimpleNamespace

import pytest

from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from services.dify_builder.native_testing.agent_risk_assessor import assess_call


def call(reason):
    return assess_call(
        goal="Summarize one test message",
        tool=SimpleNamespace(
            tool_name="read_message",
            provider_id="official/mail/mail",
            account_ref="account-1",
            account_label="Test mailbox",
            metadata=SimpleNamespace(entity=SimpleNamespace(description=SimpleNamespace(llm="Read one message by ID"))),
        ),
        target={"mailbox": "test"},
        parameters={"message_id": "message-1", "token": "private-value"},
        reason=reason,
    )


def test_reasoning_sees_exact_business_arguments_without_secret_fields():
    seen = []
    result = call(
        lambda data: seen.append(data) or {"risk_notice": "Reads the selected message.", "destructive": False}
    )
    assert "private-value" not in str(seen)
    assert seen[0]["parameters"]["message_id"] == "message-1"
    assert seen[0]["declared_capability"] == "Read one message by ID"
    assert result.target_summary == {"mailbox": "test"}
    assert result.parameters_summary["token"] != "private-value"
    assert result.account_label == "Test mailbox"


def test_model_failure_refuses_without_disclosing_provider_error_or_inventing_risk():
    def unavailable(_data):
        raise RuntimeError("private provider failure")

    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_risk_assessment_unavailable") as error:
        call(unavailable)
    assert "private provider failure" not in str(error.value)


def test_model_cannot_replace_displayed_target_or_grant_permission():
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_risk_assessment_unavailable"):
        call(
            lambda _data: {
                "risk_notice": "No risk",
                "destructive": False,
                "approved": True,
                "target_summary": "different mailbox",
            }
        )


def test_shell_assessment_uses_configured_assets_and_actual_script():
    from services.dify_builder.native_testing.agent_operations import AgentShellCapability

    seen = []
    result = assess_call(
        goal="Read the configured Local proof assets",
        tool=AgentShellCapability("config_pull", "workspace-shell", "Declared skill proof and file proof.json"),
        target={"shell": "shell", "kind": "file"},
        parameters={"script": "dify-agent files pull proof.json"},
        reason=lambda facts: (
            seen.append(facts)
            or {"risk_notice": "Reads the selected synthetic file into the workspace.", "destructive": False}
        ),
    )
    assert seen[0]["declared_capability"] == "Declared skill proof and file proof.json"
    assert seen[0]["parameters"] == {"script": "dify-agent files pull proof.json"}
    assert result.account_label is None
    assert result.destructive is False
