import pytest
from pydantic import ValidationError

from clients.agent_backend import (
    CONTRACT_VERSION,
    AgentExecutionContext,
    AgentInvokeFrom,
    AgentLayerType,
    CompositorConfig,
    PromptLayerConfig,
    PromptOrigin,
    PromptRole,
    ReferenceType,
    ResourceRef,
    SecretBinding,
    SecretsLayerConfig,
)


def _execution_context() -> AgentExecutionContext:
    return AgentExecutionContext(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id="workflow-run-1",
        node_id="node-1",
        node_execution_id="node-execution-1",
        invoke_from=AgentInvokeFrom.WORKFLOW_RUN,
    )


def test_compositor_config_serializes_contract_shape():
    config = CompositorConfig(
        execution_context=_execution_context(),
        layers=[
            PromptLayerConfig(
                id="agent-soul-prompt",
                origin=PromptOrigin.AGENT_SOUL,
                role=PromptRole.SYSTEM,
                content="You are a helpful agent.",
            ),
            PromptLayerConfig(
                id="workflow-job-prompt",
                origin=PromptOrigin.WORKFLOW_NODE_JOB,
                role=PromptRole.USER,
                content="Review the previous node output.",
                depends_on=["agent-soul-prompt"],
            ),
        ],
    )

    dumped = config.model_dump(mode="json")

    assert dumped["contract_version"] == CONTRACT_VERSION
    assert dumped["execution_context"]["tenant_id"] == "tenant-1"
    assert dumped["layers"][0]["type"] == AgentLayerType.PROMPT
    assert dumped["layers"][0]["origin"] == PromptOrigin.AGENT_SOUL
    assert dumped["layers"][1]["depends_on"] == ["agent-soul-prompt"]


def test_compositor_config_rejects_duplicate_layer_ids():
    with pytest.raises(ValidationError, match="layer ids must be unique"):
        CompositorConfig(
            execution_context=_execution_context(),
            layers=[
                PromptLayerConfig(
                    id="prompt",
                    origin=PromptOrigin.AGENT_SOUL,
                    role=PromptRole.SYSTEM,
                    content="one",
                ),
                PromptLayerConfig(
                    id="prompt",
                    origin=PromptOrigin.WORKFLOW_NODE_JOB,
                    role=PromptRole.USER,
                    content="two",
                ),
            ],
        )


def test_compositor_config_rejects_unknown_layer_dependency():
    with pytest.raises(ValidationError, match="depends on unknown layer ids"):
        CompositorConfig(
            execution_context=_execution_context(),
            layers=[
                PromptLayerConfig(
                    id="prompt",
                    origin=PromptOrigin.WORKFLOW_NODE_JOB,
                    role=PromptRole.USER,
                    content="two",
                    depends_on=["missing"],
                ),
            ],
        )


def test_secret_binding_rejects_plaintext_secret_payload():
    with pytest.raises(ValidationError):
        SecretBinding.model_validate(
            {
                "secret_ref": {"type": "secret", "id": "secret-1"},
                "env_name": "GITHUB_TOKEN",
                "value": "plaintext-token",
            }
        )


def test_secret_binding_requires_secret_ref_type():
    with pytest.raises(ValidationError, match="secret_ref must reference a secret"):
        SecretBinding(
            secret_ref=ResourceRef(type=ReferenceType.CREDENTIAL, id="credential-1"),
            env_name="GITHUB_TOKEN",
        )


def test_redacted_dump_hides_secret_and_credential_refs():
    config = CompositorConfig(
        execution_context=_execution_context(),
        layers=[
            SecretsLayerConfig(
                id="secrets",
                bindings=[
                    SecretBinding(
                        secret_ref=ResourceRef(type=ReferenceType.SECRET, id="secret-1"),
                        env_name="GITHUB_TOKEN",
                    )
                ],
            )
        ],
    )

    redacted = config.model_dump_redacted()

    assert redacted["layers"][0]["bindings"][0]["secret_ref"] == "[REDACTED]"
