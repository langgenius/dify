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
