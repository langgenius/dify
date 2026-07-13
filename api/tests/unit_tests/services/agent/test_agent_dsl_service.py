from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from models.agent import Agent, AgentIconType, AgentScope, AgentSource, AgentStatus
from models.agent_config_entities import AgentSoulConfig
from services.agent.dsl_service import AgentDslService, AgentPackage, make_portable_agent_package


def _agent() -> Agent:
    return Agent(
        tenant_id="tenant-1",
        name="Portable Agent",
        description="description",
        role="researcher",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        icon_type=AgentIconType.EMOJI,
        icon="R",
    )


def test_make_portable_agent_package_strips_workspace_credentials_and_assets() -> None:
    soul = AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "langgenius/openai/openai",
                "model": "gpt-test",
                "credential_ref": {"type": "provider", "id": "model-secret"},
            },
            "tools": {
                "dify_tools": [
                    {
                        "provider_id": "langgenius/google/google",
                        "tool_name": "search",
                        "credential_type": "api-key",
                        "credential_ref": {"type": "tool", "id": "tool-secret"},
                        "runtime_parameters": {
                            "query": "hello",
                            "upload_file_id": "upload-1",
                            "api_key": "plain-secret",
                        },
                    }
                ],
                "cli_tools": [
                    {
                        "name": "cli",
                        "env": {
                            "secret_refs": [
                                {
                                    "name": "TOKEN",
                                    "value": "plain-secret",
                                    "credential_id": "credential-1",
                                }
                            ]
                        },
                    }
                ],
            },
            "env": {"secret_refs": [{"name": "GLOBAL_TOKEN", "value": "plain-secret", "id": "secret-1"}]},
            "config_skills": [{"name": "research", "file_kind": "tool_file", "file_id": "skill-file"}],
            "config_files": [{"name": "guide.md", "file_kind": "upload_file", "file_id": "config-file"}],
            "human": {
                "contacts": [
                    {
                        "id": "human-1",
                        "tenant_id": "tenant-1",
                        "name": "Reviewer",
                        "email": "reviewer@example.com",
                    }
                ]
            },
        }
    )

    package = make_portable_agent_package(_agent(), soul)
    serialized = package.model_dump(mode="json")

    assert package.soul.model is not None
    assert package.soul.model.credential_ref is None
    assert package.soul.tools.dify_tools[0].credential_type == "unauthorized"
    assert package.soul.tools.dify_tools[0].credential_ref is None
    assert package.soul.tools.dify_tools[0].runtime_parameters["upload_file_id"] is None
    assert package.soul.tools.dify_tools[0].runtime_parameters["api_key"] is None
    assert package.soul.config_skills == []
    assert package.soul.config_files == []
    assert [asset.kind for asset in package.omitted_assets] == ["skill", "file"]
    assert "plain-secret" not in str(serialized)
    assert "model-secret" not in str(serialized)
    assert "tool-secret" not in str(serialized)
    assert "skill-file" not in str(serialized)
    assert "config-file" not in str(serialized)
    assert package.soul.human.contacts[0].id is None
    assert package.soul.human.contacts[0].name == "Reviewer"


def test_agent_package_round_trips_as_strict_dsl_dto() -> None:
    package = make_portable_agent_package(_agent(), AgentSoulConfig())

    restored = AgentPackage.model_validate(package.model_dump(mode="json"))

    assert restored == package


def test_import_warnings_cover_runtime_setup_removed_from_package(monkeypatch) -> None:
    soul = AgentSoulConfig.model_validate(
        {
            "tools": {
                "dify_tools": [
                    {
                        "provider_id": "langgenius/google/google",
                        "tool_name": "search",
                        "credential_type": "unauthorized",
                    }
                ],
                "cli_tools": [{"name": "cli", "env": {"secret_refs": [{"name": "CLI_TOKEN"}]}}],
            },
            "env": {"secret_refs": [{"name": "GLOBAL_TOKEN"}]},
            "human": {"contacts": [{"name": "Reviewer", "email": "reviewer@example.com"}]},
        }
    )
    monkeypatch.setattr("services.agent.dsl_service.get_tenant_knowledge_dataset_rows", Mock(return_value={}))

    _, warnings = AgentDslService(Mock())._resolve_package_soul(
        tenant_id="tenant-1",
        package=make_portable_agent_package(_agent(), soul),
        package_path="agent_packages.agent_1",
    )

    codes = [warning.code for warning in warnings]
    assert codes.count("agent_tool_authorization_required") == 1
    assert codes.count("agent_secret_required") == 2
    assert codes.count("agent_human_contact_unresolved") == 1


def test_agent_package_rejects_unknown_schema_version() -> None:
    package = make_portable_agent_package(_agent(), AgentSoulConfig()).model_dump(mode="json")
    package["schema_version"] = 2

    with pytest.raises(ValidationError):
        AgentPackage.model_validate(package)
