from __future__ import annotations

import pytest
from pydantic import SecretStr, ValidationError

from configs.extra.knowledge_fs_config import KnowledgeFSConfig


def test_knowledge_fs_config_normalizes_complete_connection() -> None:
    config = KnowledgeFSConfig(
        KNOWLEDGE_FS_BASE_URL="  https://knowledge-fs.test/  ",
        KNOWLEDGE_FS_API_TOKEN="  server-token  ",
        KNOWLEDGE_FS_STATIC_TENANT_ID="  tenant-dev  ",
    )

    assert config.KNOWLEDGE_FS_BASE_URL == "https://knowledge-fs.test"
    assert isinstance(config.KNOWLEDGE_FS_API_TOKEN, SecretStr)
    assert config.KNOWLEDGE_FS_API_TOKEN.get_secret_value() == "server-token"
    assert config.KNOWLEDGE_FS_STATIC_TENANT_ID == "tenant-dev"
    assert "server-token" not in repr(config)
    assert "server-token" not in config.model_dump_json()


def test_knowledge_fs_config_accepts_production_jwt_connection() -> None:
    config = KnowledgeFSConfig(
        KNOWLEDGE_FS_BASE_URL="https://knowledge-fs.test/gateway",
        KNOWLEDGE_FS_JWT_AUDIENCE=" knowledge-fs ",
        KNOWLEDGE_FS_JWT_ISSUER=" dify ",
        KNOWLEDGE_FS_JWT_SECRET="production-secret-with-at-least-32-bytes",
    )

    assert config.KNOWLEDGE_FS_JWT_SECRET is not None
    assert config.KNOWLEDGE_FS_JWT_ISSUER == "dify"
    assert config.KNOWLEDGE_FS_JWT_AUDIENCE == "knowledge-fs"
    assert config.KNOWLEDGE_FS_JWT_TTL_SECONDS == 60
    assert "production-secret" not in repr(config)
    assert "production-secret" not in config.model_dump_json()


def test_knowledge_fs_config_treats_blank_connection_as_disabled() -> None:
    config = KnowledgeFSConfig(
        KNOWLEDGE_FS_BASE_URL=" ",
        KNOWLEDGE_FS_API_TOKEN="",
        KNOWLEDGE_FS_STATIC_TENANT_ID="\t",
    )

    assert config.KNOWLEDGE_FS_BASE_URL is None
    assert config.KNOWLEDGE_FS_API_TOKEN is None
    assert config.KNOWLEDGE_FS_STATIC_TENANT_ID is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"KNOWLEDGE_FS_BASE_URL": "https://knowledge-fs.test"},
        {
            "KNOWLEDGE_FS_BASE_URL": "https://knowledge-fs.test",
            "KNOWLEDGE_FS_API_TOKEN": "server-token",
        },
        {
            "KNOWLEDGE_FS_API_TOKEN": "server-token",
            "KNOWLEDGE_FS_STATIC_TENANT_ID": "tenant-dev",
        },
    ],
)
def test_knowledge_fs_config_rejects_partial_connection(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError, match="must be configured together"):
        KnowledgeFSConfig(**overrides)


@pytest.mark.parametrize("base_url", ["knowledge-fs.test", "ftp://knowledge-fs.test", "http:///missing-host"])
def test_knowledge_fs_config_rejects_non_http_absolute_urls(base_url: str) -> None:
    with pytest.raises(ValidationError, match="absolute HTTP\\(S\\) URL"):
        KnowledgeFSConfig(
            KNOWLEDGE_FS_BASE_URL=base_url,
            KNOWLEDGE_FS_API_TOKEN="server-token",
            KNOWLEDGE_FS_STATIC_TENANT_ID="tenant-dev",
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
            KNOWLEDGE_FS_API_TOKEN="server-token",
            KNOWLEDGE_FS_STATIC_TENANT_ID="tenant-dev",
        )


def test_knowledge_fs_config_rejects_ambiguous_authentication() -> None:
    with pytest.raises(ValidationError, match="authentication modes must not be configured together"):
        KnowledgeFSConfig(
            KNOWLEDGE_FS_BASE_URL="https://knowledge-fs.test",
            KNOWLEDGE_FS_API_TOKEN="server-token",
            KNOWLEDGE_FS_STATIC_TENANT_ID="tenant-dev",
            KNOWLEDGE_FS_JWT_SECRET="production-secret-with-at-least-32-bytes",
        )


@pytest.mark.parametrize("timeout_seconds", [float("inf"), float("nan"), 60.0001])
def test_knowledge_fs_config_rejects_unbounded_timeouts(timeout_seconds: float) -> None:
    with pytest.raises(ValidationError):
        KnowledgeFSConfig(KNOWLEDGE_FS_TIMEOUT_SECONDS=timeout_seconds)
