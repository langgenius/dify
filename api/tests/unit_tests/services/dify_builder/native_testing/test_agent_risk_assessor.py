from collections.abc import Callable

import pytest

from core.tools.entities.tool_entities import ToolEntity
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import JsonValue
from services.dify_builder.native_testing.agent_operations import AgentCallAssessment, AgentResolvedTool
from services.dify_builder.native_testing.agent_risk_assessor import assess_call
from services.dify_builder.native_testing.agent_tool_declarations import AgentToolMetadata


def call(reason: Callable[[dict[str, JsonValue]], object]) -> AgentCallAssessment:
    return assess_call(
        goal="Summarize one test message",
        tool=AgentResolvedTool(
            provider_type="builtin",
            credential_id="account-1",
            credential_version="v1",
            runtime_parameters={},
            verified_plugin=True,
            tool_name="read_message",
            provider_id="official/mail/mail",
            account_ref="account-1",
            account_label="Test mailbox",
            metadata=AgentToolMetadata(
                entity=ToolEntity.model_validate(
                    {
                        "identity": {
                            "name": "read_message",
                            "author": "test",
                            "provider": "official/mail/mail",
                            "label": {"en_US": "Read message"},
                        },
                        "description": {"human": {"en_US": "Read message"}, "llm": "Read one message by ID"},
                    }
                ),
                implementation_revision="test-v1",
                requires_credentials=True,
            ),
        ),
        target={"mailbox": "test"},
        parameters={"message_id": "message-1", "token": "private-value"},
        reason=reason,
    )


def test_reasoning_sees_exact_business_arguments_without_secret_fields() -> None:
    seen: list[dict[str, JsonValue]] = []
    result = call(
        lambda data: seen.append(data) or {"risk_notice": "Reads the selected message.", "destructive": False}
    )
    assert "private-value" not in str(seen)
    parameters = seen[0]["parameters"]
    assert isinstance(parameters, dict)
    assert parameters["message_id"] == "message-1"
    assert seen[0]["declared_capability"] == "Read one message by ID"
    assert result.target_summary == {"mailbox": "test"}
    assert isinstance(result.parameters_summary, dict)
    assert result.parameters_summary["token"] != "private-value"
    assert result.account_label == "Test mailbox"


def test_model_failure_refuses_without_disclosing_provider_error_or_inventing_risk() -> None:
    def unavailable(_data: object) -> None:
        raise RuntimeError("private provider failure")

    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_risk_assessment_unavailable") as error:
        call(unavailable)
    assert "private provider failure" not in str(error.value)


def test_model_cannot_replace_displayed_target_or_grant_permission() -> None:
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_risk_assessment_unavailable"):
        call(
            lambda _data: {
                "risk_notice": "No risk",
                "destructive": False,
                "approved": True,
                "target_summary": "different mailbox",
            }
        )


def test_shell_assessment_uses_configured_assets_and_actual_script() -> None:
    from services.dify_builder.native_testing.agent_operations import AgentShellCapability

    seen: list[dict[str, JsonValue]] = []
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


@pytest.mark.parametrize("destructive", [False, True])
def test_shell_reasoning_receives_owner_scope_and_preserves_unknown_risk_and_model_verdict(
    destructive: bool,
) -> None:
    from services.dify_builder.native_testing.agent_operations import AgentShellCapability

    seen: list[dict[str, JsonValue]] = []
    scope: dict[str, JsonValue] = {
        "initial_working_directory": "request_owned_agent_workspace",
        "may_contain_cloned_files": True,
        "filesystem_confinement_guaranteed": False,
    }
    result = assess_call(
        goal="Materialize configured synthetic assets in this run workspace; preserve user artifacts.",
        task={"workflow_prompt": "Permit controlled configured-asset copies; never delete or replace user documents."},
        tool=AgentShellCapability(
            "config_pull", "workspace-shell", "Configured synthetic assets", execution_context=scope
        ),
        target={"shell": "shell", "kind": "skill"},
        parameters={"script": "dify-agent config skills pull --json proof"},
        reason=lambda facts: (
            seen.append(facts)
            or {
                "risk_notice": "May overwrite the asset copy; archive contents and path behavior remain uncertain.",
                "destructive": destructive,
            }
        ),
    )
    assert seen[0]["execution_context"] == scope
    assert result.destructive is destructive
    assert "uncertain" in result.risk_notice
    assert result.parameters_summary == {"script": "dify-agent config skills pull --json proof"}
