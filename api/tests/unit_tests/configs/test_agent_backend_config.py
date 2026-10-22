from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from configs.extra.agent_backend_config import AgentBackendConfig

_REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
_API_TIMEOUT_ENV = "AGENT_BACKEND_BINDING_FILE_DOWNLOAD_TIMEOUT_SECONDS"
_AGENT_TIMEOUT_ENV = "DIFY_AGENT_BINDING_FILE_DOWNLOAD_COMMAND_TIMEOUT_SECONDS"


def test_binding_file_download_timeout_defaults_to_240_seconds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(_API_TIMEOUT_ENV, raising=False)

    assert AgentBackendConfig().AGENT_BACKEND_BINDING_FILE_DOWNLOAD_TIMEOUT_SECONDS == 240.0


def test_binding_file_download_timeout_rejects_non_positive_values() -> None:
    with pytest.raises(ValidationError):
        AgentBackendConfig(AGENT_BACKEND_BINDING_FILE_DOWNLOAD_TIMEOUT_SECONDS=0)


def test_binding_file_timeout_docker_settings_use_their_service_env_files() -> None:
    root_env_example = (_REPOSITORY_ROOT / "docker/.env.example").read_text(encoding="utf-8")
    api_env_example = (_REPOSITORY_ROOT / "docker/envs/core-services/api.env.example").read_text(encoding="utf-8")
    agent_env_example = (_REPOSITORY_ROOT / "docker/envs/core-services/dify-agent.env.example").read_text(
        encoding="utf-8"
    )
    compose_template = (_REPOSITORY_ROOT / "docker/docker-compose-template.yaml").read_text(encoding="utf-8")

    assert f"{_API_TIMEOUT_ENV}=" not in root_env_example
    assert f"{_AGENT_TIMEOUT_ENV}=" not in root_env_example
    assert f"{_API_TIMEOUT_ENV}=" in api_env_example
    assert f"{_AGENT_TIMEOUT_ENV}=" not in api_env_example
    assert f"{_API_TIMEOUT_ENV}=" not in agent_env_example
    assert f"{_AGENT_TIMEOUT_ENV}=" in agent_env_example
    assert f"{_API_TIMEOUT_ENV}:" not in compose_template
    assert f"{_AGENT_TIMEOUT_ENV}:" not in compose_template


def test_knowledge_limits_default_to_existing_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGENT_KNOWLEDGE_MAX_RESULT_CONTENT_CHARS", raising=False)
    monkeypatch.delenv("AGENT_KNOWLEDGE_MAX_OBSERVATION_CHARS", raising=False)
    settings = AgentBackendConfig()
    assert settings.AGENT_KNOWLEDGE_MAX_RESULT_CONTENT_CHARS == 2000
    assert settings.AGENT_KNOWLEDGE_MAX_OBSERVATION_CHARS == 12000


@pytest.mark.parametrize(("content_limit", "observation_limit"), [(0, 12000), (-1, 12000), (2000, 0), (2000, 1999)])
def test_knowledge_limits_reject_invalid_env_values(
    monkeypatch: pytest.MonkeyPatch, content_limit: int, observation_limit: int
) -> None:
    monkeypatch.setenv("AGENT_KNOWLEDGE_MAX_RESULT_CONTENT_CHARS", str(content_limit))
    monkeypatch.setenv("AGENT_KNOWLEDGE_MAX_OBSERVATION_CHARS", str(observation_limit))
    with pytest.raises(ValidationError):
        AgentBackendConfig()
