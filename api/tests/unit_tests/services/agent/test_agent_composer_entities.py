import pytest

from models.agent_config_entities import AgentKnowledgeQueryMode, AgentSoulModelConfig, DeclaredOutputType
from services.agent.composer_service import AgentComposerService
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.errors import AgentSoulLockedError, PlaintextSecretNotAllowedError
from services.entities.agent_entities import (
    AgentSoulConfig,
    ComposerSavePayload,
    ComposerSaveStrategy,
    ComposerVariant,
    WorkflowNodeJobConfig,
)


def test_workflow_variant_rejects_agent_app_only_fields():
    with pytest.raises(ValueError):
        ComposerSavePayload.model_validate(
            {
                "variant": ComposerVariant.WORKFLOW,
                "save_strategy": ComposerSaveStrategy.NODE_JOB_ONLY,
                "agent_soul": {
                    "app_variables": [{"name": "company_name", "type": "string"}],
                },
            }
        )


def test_agent_app_variant_rejects_workflow_node_job():
    with pytest.raises(ValueError):
        ComposerSavePayload.model_validate(
            {
                "variant": ComposerVariant.AGENT_APP,
                "save_strategy": ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION,
                "node_job": {"workflow_prompt": "Use the previous node output."},
            }
        )


def test_locked_workflow_soul_rejects_soul_changes():
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.WORKFLOW,
            "save_strategy": ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION,
            "soul_lock": {"locked": True},
            "agent_soul": {"prompt": {"system_prompt": "changed"}},
        }
    )

    with pytest.raises(AgentSoulLockedError):
        ComposerConfigValidator.validate_save_payload(payload)


def test_locked_workflow_node_job_only_allows_inline_soul_payload():
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.WORKFLOW,
            "save_strategy": ComposerSaveStrategy.NODE_JOB_ONLY,
            "soul_lock": {"locked": True},
            "agent_soul": {"prompt": {"system_prompt": "changed"}},
        }
    )

    ComposerConfigValidator.validate_save_payload(payload)


def test_agent_app_soul_allows_app_features_and_variables():
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.AGENT_APP,
            "save_strategy": ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION,
            "agent_soul": {
                "app_features": {
                    "conversation_opener": {},
                    "follow_up": {},
                    "citations_and_attributions": {},
                    "content_moderation": {},
                    "annotation_reply": {},
                },
                "app_variables": [{"name": "company_name", "type": "string", "required": True}],
            },
        }
    )

    ComposerConfigValidator.validate_save_payload(payload)
    assert payload.agent_soul is not None
    assert payload.agent_soul.app_variables[0].name == "company_name"


def test_knowledge_query_mode_uses_stable_backend_enums():
    config = AgentSoulConfig.model_validate(
        {
            "knowledge": {
                "datasets": [{"dataset_id": "dataset-1"}],
                "query_mode": "generated_query",
                "query_config": {"generation_prompt": "Create a retrieval query."},
            }
        }
    )

    assert config.knowledge.query_mode == AgentKnowledgeQueryMode.GENERATED_QUERY


def test_agent_soul_model_config_is_first_class_without_credentials():
    config = AgentSoulConfig(
        model=AgentSoulModelConfig(
            plugin_id="langgenius/openai",
            model_provider="openai",
            model="gpt-test",
            credential_ref={"type": "provider", "id": "credential-1"},
            model_settings={"temperature": 0},
        )
    )

    dumped = config.model_dump(mode="json")
    assert dumped["model"]["plugin_id"] == "langgenius/openai"
    assert dumped["model"]["credential_ref"] == {"type": "provider", "id": "credential-1", "provider": None}


def test_declared_outputs_support_file_check_and_failure_strategy():
    """Stage 4 §4.3 + §4.4: file output may carry a single ``check`` plus a
    full LLM-node-parity ``failure_strategy``."""
    node_job = WorkflowNodeJobConfig.model_validate(
        {
            "declared_outputs": [
                {
                    "name": "analysis_report",
                    "type": "file",
                    "file": {"extensions": [".pdf"], "mime_types": ["application/pdf"]},
                    "check": {
                        "enabled": True,
                        "prompt": "Report must include risk summary.",
                        "benchmark_file_ref": {"upload_file_id": "file-1"},
                    },
                    "failure_strategy": {
                        "retry": {"enabled": True, "max_retries": 1, "retry_interval_ms": 500},
                        "on_failure": "fail_branch",
                    },
                }
            ]
        }
    )

    output = node_job.declared_outputs[0]
    assert output.type == DeclaredOutputType.FILE
    assert output.file is not None
    assert output.file.extensions == [".pdf"]
    assert output.check is not None
    assert output.check.enabled is True
    assert output.check.prompt == "Report must include risk summary."
    assert output.failure_strategy.retry.enabled is True
    assert output.failure_strategy.retry.max_retries == 1
    assert output.failure_strategy.on_failure.value == "fail_branch"


def test_plaintext_secrets_are_rejected():
    config = AgentSoulConfig.model_validate({"env": {"variables": [{"name": "OPENAI_API_KEY", "api_key": "secret"}]}})

    with pytest.raises(PlaintextSecretNotAllowedError):
        ComposerConfigValidator.validate_agent_soul(config)


def test_workflow_agent_soul_config_strips_agent_app_only_fields():
    config = AgentComposerService._workflow_agent_soul_config(
        {
            "prompt": {"system_prompt": "answer carefully"},
            "app_features": {"conversation_opener": {"enabled": True}},
            "app_variables": [{"name": "company_name", "type": "string"}],
        }
    )

    assert config["prompt"]["system_prompt"] == "answer carefully"
    assert config["app_features"] == {}
    assert config["app_variables"] == []
