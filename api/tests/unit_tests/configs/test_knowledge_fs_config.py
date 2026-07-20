from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import SecretStr, ValidationError

from configs.extra.knowledge_fs_config import KnowledgeFSConfig

_REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
_KNOWLEDGE_FS_DOCKER_VARIABLES = (
    "KNOWLEDGE_FS_ENABLED",
    "KNOWLEDGE_FS_BASE_URL",
    "KNOWLEDGE_FS_JWT_SECRET",
    "KNOWLEDGE_FS_SSE_READ_TIMEOUT_SECONDS",
    "KNOWLEDGE_FS_TIMEOUT_SECONDS",
)


def test_knowledge_fs_config_normalizes_complete_connection() -> None:
    config = KnowledgeFSConfig(
        KNOWLEDGE_FS_ENABLED=True,
        KNOWLEDGE_FS_BASE_URL="  https://knowledge-fs.test/  ",
        KNOWLEDGE_FS_JWT_SECRET="  production-secret-with-at-least-32-bytes  ",
    )

    assert config.KNOWLEDGE_FS_BASE_URL == "https://knowledge-fs.test"
    assert isinstance(config.KNOWLEDGE_FS_JWT_SECRET, SecretStr)
    assert config.KNOWLEDGE_FS_JWT_SECRET.get_secret_value() == "production-secret-with-at-least-32-bytes"
    assert "production-secret" not in repr(config)
    assert "production-secret" not in config.model_dump_json()
    assert config.KNOWLEDGE_FS_SSE_READ_TIMEOUT_SECONDS == 300.0


def test_knowledge_fs_config_treats_blank_connection_as_disabled() -> None:
    config = KnowledgeFSConfig(
        KNOWLEDGE_FS_BASE_URL=" ",
        KNOWLEDGE_FS_JWT_SECRET="",
    )

    assert config.KNOWLEDGE_FS_BASE_URL is None
    assert config.KNOWLEDGE_FS_JWT_SECRET is None
    assert config.KNOWLEDGE_FS_ENABLED is False


def test_knowledge_fs_config_requires_connection_when_enabled() -> None:
    with pytest.raises(ValidationError, match="connection settings are required"):
        KnowledgeFSConfig(KNOWLEDGE_FS_ENABLED=True)


def test_knowledge_fs_docker_config_is_not_shadowed_by_root_env() -> None:
    root_env_example = (_REPOSITORY_ROOT / "docker/.env.example").read_text(encoding="utf-8")
    api_env_example = (_REPOSITORY_ROOT / "docker/envs/core-services/api.env.example").read_text(encoding="utf-8")

    for variable in _KNOWLEDGE_FS_DOCKER_VARIABLES:
        assert f"{variable}=" not in root_env_example
        assert f"{variable}=" in api_env_example


@pytest.mark.parametrize(
    ("base_url", "jwt_secret"),
    [
        ("https://knowledge-fs.test", None),
        (None, "production-secret-with-at-least-32-bytes"),
    ],
)
def test_knowledge_fs_config_rejects_partial_connection(base_url: str | None, jwt_secret: str | None) -> None:
    with pytest.raises(ValidationError, match="must be configured together"):
        KnowledgeFSConfig(
            KNOWLEDGE_FS_BASE_URL=base_url,
            KNOWLEDGE_FS_JWT_SECRET=jwt_secret,
        )


@pytest.mark.parametrize("base_url", ["knowledge-fs.test", "ftp://knowledge-fs.test", "http:///missing-host"])
def test_knowledge_fs_config_rejects_non_http_absolute_urls(base_url: str) -> None:
    with pytest.raises(ValidationError, match="absolute HTTP\\(S\\) URL"):
        KnowledgeFSConfig(
            KNOWLEDGE_FS_BASE_URL=base_url,
            KNOWLEDGE_FS_JWT_SECRET="production-secret-with-at-least-32-bytes",
        )


@pytest.mark.parametrize(
    "base_url",
    [
        "https://knowledge-fs.test:notaport",
        "https://knowledge-fs.test:65536",
    ],
)
def test_knowledge_fs_config_rejects_invalid_ports(base_url: str) -> None:
    with pytest.raises(ValidationError, match="valid port"):
        KnowledgeFSConfig(
            KNOWLEDGE_FS_BASE_URL=base_url,
            KNOWLEDGE_FS_JWT_SECRET="production-secret-with-at-least-32-bytes",
        )


@pytest.mark.parametrize(
    "base_url",
    [
        "https://user:password@knowledge-fs.test",
        "https://knowledge-fs.test?region=us",
        "https://knowledge-fs.test#gateway",
    ],
)
def test_knowledge_fs_config_rejects_unsafe_base_url_components(base_url: str) -> None:
    with pytest.raises(ValidationError, match="must not include credentials, query, or fragment"):
        KnowledgeFSConfig(
            KNOWLEDGE_FS_BASE_URL=base_url,
            KNOWLEDGE_FS_JWT_SECRET="production-secret-with-at-least-32-bytes",
        )


@pytest.mark.parametrize("timeout_seconds", [float("inf"), float("nan"), 60.0001])
def test_knowledge_fs_config_rejects_unbounded_timeouts(timeout_seconds: float) -> None:
    with pytest.raises(ValidationError):
        KnowledgeFSConfig(KNOWLEDGE_FS_TIMEOUT_SECONDS=timeout_seconds)


@pytest.mark.parametrize("timeout_seconds", [float("inf"), float("nan"), 3600.0001])
def test_knowledge_fs_config_rejects_unbounded_sse_read_timeouts(timeout_seconds: float) -> None:
    with pytest.raises(ValidationError):
        KnowledgeFSConfig(KNOWLEDGE_FS_SSE_READ_TIMEOUT_SECONDS=timeout_seconds)
