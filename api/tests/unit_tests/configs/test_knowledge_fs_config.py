from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from configs.extra.knowledge_fs_config import KnowledgeFSConfig


class _DeployedKnowledgeFSConfig(KnowledgeFSConfig):
    DEPLOY_ENV: str = "PRODUCTION"


_REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
_KNOWLEDGE_FS_DOCKER_VARIABLES = (
    "KNOWLEDGE_FS_ENABLED",
    "KNOWLEDGE_FS_BASE_URL",
    "KNOWLEDGE_FS_DIRECT_ORIGIN",
    "KNOWLEDGE_FS_LIFECYCLE_WORKER_ENABLED",
    "KNOWLEDGE_FS_INTEGRATED_PROVISION_READY",
    "KNOWLEDGE_FS_LEGACY_ACL_FREEZE_READY",
    "KNOWLEDGE_FS_LIFECYCLE_POLL_INTERVAL_SECONDS",
    "KNOWLEDGE_FS_LIFECYCLE_LEASE_SECONDS",
    "KNOWLEDGE_FS_LIFECYCLE_BATCH_SIZE",
    "KNOWLEDGE_FS_CAPABILITY_V2_ENABLED",
    "KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID",
    "KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM",
    "KNOWLEDGE_FS_CAPABILITY_V2_PREVIOUS_PUBLIC_JWKS",
    "KNOWLEDGE_FS_CAPABILITY_V2_ISSUER",
    "KNOWLEDGE_FS_CAPABILITY_V2_AUDIENCE",
    "KNOWLEDGE_FS_CAPABILITY_V2_MAX_TTL_SECONDS",
    "KNOWLEDGE_FS_JWKS_CACHE_MAX_AGE_SECONDS",
    "KNOWLEDGE_FS_PRODUCT_MAX_RESPONSE_BYTES",
    "KNOWLEDGE_FS_TIMEOUT_SECONDS",
)


def test_knowledge_fs_config_normalizes_complete_connection() -> None:
    config = KnowledgeFSConfig(
        KNOWLEDGE_FS_ENABLED=True,
        KNOWLEDGE_FS_BASE_URL="  https://knowledge-fs.test/  ",
        KNOWLEDGE_FS_CAPABILITY_V2_ENABLED=True,
        KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID=" current-key ",
        KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM=" test-only-private-key ",
    )

    assert config.KNOWLEDGE_FS_BASE_URL == "https://knowledge-fs.test"
    assert config.KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID == "current-key"
    assert "test-only-private-key" not in repr(config)
    assert "test-only-private-key" not in config.model_dump_json()
    assert config.KNOWLEDGE_FS_TIMEOUT_SECONDS == 10.0


def test_knowledge_fs_config_treats_blank_connection_as_disabled() -> None:
    config = KnowledgeFSConfig(
        KNOWLEDGE_FS_BASE_URL=" ",
    )

    assert config.KNOWLEDGE_FS_BASE_URL is None
    assert config.KNOWLEDGE_FS_ENABLED is False


def test_knowledge_fs_lifecycle_worker_is_disabled_by_default() -> None:
    config = KnowledgeFSConfig()

    assert config.KNOWLEDGE_FS_LIFECYCLE_WORKER_ENABLED is False
    assert config.KNOWLEDGE_FS_INTEGRATED_PROVISION_READY is False
    assert config.KNOWLEDGE_FS_LEGACY_ACL_FREEZE_READY is False
    assert config.KNOWLEDGE_FS_CAPABILITY_V2_ENABLED is False


def test_capability_v2_requires_private_signing_configuration_when_enabled() -> None:
    with pytest.raises(ValidationError, match="signing kid and private key"):
        KnowledgeFSConfig(KNOWLEDGE_FS_CAPABILITY_V2_ENABLED=True)


def test_enabled_product_runtime_accepts_capability_v2_without_the_legacy_hmac_secret() -> None:
    config = KnowledgeFSConfig(
        KNOWLEDGE_FS_ENABLED=True,
        KNOWLEDGE_FS_BASE_URL="https://knowledge-fs.test",
        KNOWLEDGE_FS_CAPABILITY_V2_ENABLED=True,
        KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID="current-key",
        KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM="test-only-private-key",
    )

    assert config.KNOWLEDGE_FS_CAPABILITY_V2_ENABLED is True


def test_disabled_capability_v2_allows_unassembled_rotation_configuration() -> None:
    config = KnowledgeFSConfig(
        KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID=" future-key ",
        KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM=" future-pem ",
    )

    assert config.KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID == "future-key"
    assert config.KNOWLEDGE_FS_CAPABILITY_V2_ENABLED is False


def test_knowledge_fs_config_requires_connection_when_enabled() -> None:
    with pytest.raises(ValidationError, match="base URL"):
        KnowledgeFSConfig(KNOWLEDGE_FS_ENABLED=True)


def test_disabled_knowledge_fs_config_allows_partial_connection() -> None:
    config = KnowledgeFSConfig(
        KNOWLEDGE_FS_ENABLED=False,
        KNOWLEDGE_FS_BASE_URL="https://knowledge-fs.test",
    )

    assert config.KNOWLEDGE_FS_ENABLED is False


def test_knowledge_fs_docker_config_is_not_shadowed_by_root_env() -> None:
    root_env_example = (_REPOSITORY_ROOT / "docker/.env.example").read_text(encoding="utf-8")
    api_env_example = (_REPOSITORY_ROOT / "docker/envs/core-services/api.env.example").read_text(encoding="utf-8")

    for variable in _KNOWLEDGE_FS_DOCKER_VARIABLES:
        assert f"{variable}=" not in root_env_example
        assert f"{variable}=" in api_env_example


def test_enabled_knowledge_fs_config_requires_capability_v2() -> None:
    with pytest.raises(ValidationError, match="Capability v2"):
        KnowledgeFSConfig(
            KNOWLEDGE_FS_ENABLED=True,
            KNOWLEDGE_FS_BASE_URL="https://knowledge-fs.test",
        )


@pytest.mark.parametrize("base_url", ["knowledge-fs.test", "ftp://knowledge-fs.test", "http:///missing-host"])
def test_knowledge_fs_config_rejects_non_http_absolute_urls(base_url: str) -> None:
    with pytest.raises(ValidationError, match="absolute HTTP\\(S\\) URL"):
        KnowledgeFSConfig(
            KNOWLEDGE_FS_BASE_URL=base_url,
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
    with pytest.raises(ValidationError, match="origin without credentials, path, query, or fragment"):
        KnowledgeFSConfig(
            KNOWLEDGE_FS_BASE_URL=base_url,
        )


@pytest.mark.parametrize("timeout_seconds", [float("inf"), float("nan"), 60.0001])
def test_knowledge_fs_config_rejects_unbounded_timeouts(timeout_seconds: float) -> None:
    with pytest.raises(ValidationError):
        KnowledgeFSConfig(KNOWLEDGE_FS_TIMEOUT_SECONDS=timeout_seconds)


def test_knowledge_fs_direct_origin_is_normalized_and_rejects_paths() -> None:
    config = KnowledgeFSConfig(KNOWLEDGE_FS_DIRECT_ORIGIN=" https://uploads.knowledge-fs.test/ ")

    assert config.KNOWLEDGE_FS_DIRECT_ORIGIN == "https://uploads.knowledge-fs.test"
    with pytest.raises(ValidationError, match="origin without"):
        KnowledgeFSConfig(KNOWLEDGE_FS_DIRECT_ORIGIN="https://uploads.knowledge-fs.test/api")


@pytest.mark.parametrize("field", ["KNOWLEDGE_FS_BASE_URL", "KNOWLEDGE_FS_DIRECT_ORIGIN"])
def test_production_knowledge_fs_transport_requires_https(field: str) -> None:
    with pytest.raises(ValidationError, match="HTTPS in production"):
        _DeployedKnowledgeFSConfig(**{field: "http://knowledge-fs.test"})


@pytest.mark.parametrize("field", ["KNOWLEDGE_FS_BASE_URL", "KNOWLEDGE_FS_DIRECT_ORIGIN"])
def test_nonproduction_or_loopback_knowledge_fs_transport_allows_http(field: str) -> None:
    development = _DeployedKnowledgeFSConfig(
        DEPLOY_ENV="DEVELOPMENT",
        **{field: "http://knowledge-fs.test"},
    )
    loopback = _DeployedKnowledgeFSConfig(**{field: "http://127.0.0.1:8788"})

    assert getattr(development, field) == "http://knowledge-fs.test"
    assert getattr(loopback, field) == "http://127.0.0.1:8788"
