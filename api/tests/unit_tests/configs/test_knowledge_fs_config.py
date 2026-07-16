from __future__ import annotations

import base64

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import SecretStr, ValidationError

from configs.extra.knowledge_fs_config import KnowledgeFSConfig


def _private_key_b64(*, key_size: int = 2048) -> str:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return base64.b64encode(pem).decode()


def test_knowledge_fs_config_normalizes_optional_connection_values() -> None:
    config = KnowledgeFSConfig(
        KNOWLEDGE_FS_AUTH_MODE="dev-static",
        KNOWLEDGE_FS_BASE_URL="  https://knowledge-fs.test/  ",
        KNOWLEDGE_FS_API_TOKEN="  server-token  ",
        KNOWLEDGE_FS_STATIC_TENANT_ID="  tenant-dev  ",
        KNOWLEDGE_FS_ALLOW_SHARED_TENANT_TOKEN=True,
    )

    assert config.KNOWLEDGE_FS_BASE_URL == "https://knowledge-fs.test"
    assert isinstance(config.KNOWLEDGE_FS_API_TOKEN, SecretStr)
    assert config.KNOWLEDGE_FS_API_TOKEN.get_secret_value() == "server-token"
    assert config.KNOWLEDGE_FS_STATIC_TENANT_ID == "tenant-dev"
    assert "server-token" not in repr(config)
    assert "server-token" not in config.model_dump_json()

    disabled = KnowledgeFSConfig(KNOWLEDGE_FS_BASE_URL=" ", KNOWLEDGE_FS_API_TOKEN="")
    assert disabled.KNOWLEDGE_FS_BASE_URL is None
    assert disabled.KNOWLEDGE_FS_API_TOKEN is None


def test_knowledge_fs_config_requires_an_explicit_tenant_for_dev_static_auth() -> None:
    with pytest.raises(ValidationError, match="KNOWLEDGE_FS_STATIC_TENANT_ID"):
        KnowledgeFSConfig(
            KNOWLEDGE_FS_AUTH_MODE="dev-static",
            KNOWLEDGE_FS_BASE_URL="http://localhost:8788",
            KNOWLEDGE_FS_API_TOKEN="dev-token",
            KNOWLEDGE_FS_ALLOW_SHARED_TENANT_TOKEN=True,
        )


def test_knowledge_fs_config_rejects_static_tenant_for_dify_jwt_auth() -> None:
    with pytest.raises(ValidationError, match="KNOWLEDGE_FS_STATIC_TENANT_ID"):
        KnowledgeFSConfig(
            KNOWLEDGE_FS_AUTH_MODE="dify-jwt",
            KNOWLEDGE_FS_BASE_URL="https://knowledge-fs.test",
            KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64=_private_key_b64(),
            KNOWLEDGE_FS_JWT_KEY_ID="k1",
            KNOWLEDGE_FS_JWT_ISSUER="https://dify.test/knowledge-fs",
            KNOWLEDGE_FS_STATIC_TENANT_ID="tenant-dev",
        )


@pytest.mark.parametrize("base_url", ["knowledge-fs.test", "ftp://knowledge-fs.test", "http:///missing-host"])
def test_knowledge_fs_config_rejects_non_http_absolute_urls(base_url: str) -> None:
    with pytest.raises(ValidationError, match="absolute HTTP\\(S\\) URL"):
        KnowledgeFSConfig(KNOWLEDGE_FS_BASE_URL=base_url)


@pytest.mark.parametrize("timeout_seconds", [float("inf"), float("nan"), 60.0001])
def test_knowledge_fs_config_rejects_unbounded_timeouts(timeout_seconds: float) -> None:
    with pytest.raises(ValidationError):
        KnowledgeFSConfig(KNOWLEDGE_FS_TIMEOUT_SECONDS=timeout_seconds)


def test_knowledge_fs_config_accepts_explicit_dify_jwt_profile() -> None:
    config = KnowledgeFSConfig(
        KNOWLEDGE_FS_AUTH_MODE="dify-jwt",
        KNOWLEDGE_FS_BASE_URL="https://knowledge-fs.test/",
        KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64=_private_key_b64(),
        KNOWLEDGE_FS_JWT_KEY_ID="2026-07-k1",
        KNOWLEDGE_FS_JWT_ISSUER="https://dify.test/knowledge-fs",
        KNOWLEDGE_FS_JWT_AUDIENCE="urn:langgenius:knowledge-fs",
        KNOWLEDGE_FS_JWT_TTL_SECONDS=60,
    )

    assert config.KNOWLEDGE_FS_AUTH_MODE == "dify-jwt"
    assert config.KNOWLEDGE_FS_BASE_URL == "https://knowledge-fs.test"
    assert config.KNOWLEDGE_FS_JWT_KEY_ID == "2026-07-k1"


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"KNOWLEDGE_FS_BASE_URL": "https://knowledge-fs.test"}, "AUTH_MODE"),
        (
            {
                "KNOWLEDGE_FS_AUTH_MODE": "dify-jwt",
                "KNOWLEDGE_FS_BASE_URL": "https://knowledge-fs.test",
                "KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64": "",
                "KNOWLEDGE_FS_JWT_KEY_ID": "k1",
                "KNOWLEDGE_FS_JWT_ISSUER": "https://dify.test/knowledge-fs",
            },
            "PRIVATE_KEY",
        ),
        (
            {
                "KNOWLEDGE_FS_AUTH_MODE": "dify-jwt",
                "KNOWLEDGE_FS_BASE_URL": "https://knowledge-fs.test",
                "KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64": _private_key_b64(),
                "KNOWLEDGE_FS_JWT_KEY_ID": "k1",
                "KNOWLEDGE_FS_JWT_ISSUER": "https://dify.test/knowledge-fs",
                "KNOWLEDGE_FS_API_TOKEN": "must-not-mix",
            },
            "API_TOKEN",
        ),
        (
            {
                "KNOWLEDGE_FS_AUTH_MODE": "dev-static",
                "KNOWLEDGE_FS_BASE_URL": "http://localhost:8788",
                "KNOWLEDGE_FS_API_TOKEN": "dev-token",
                "KNOWLEDGE_FS_STATIC_TENANT_ID": "tenant-dev",
            },
            "ALLOW_SHARED_TENANT_TOKEN",
        ),
    ],
)
def test_knowledge_fs_config_rejects_ambiguous_or_unsafe_auth_profiles(
    overrides: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(ValidationError, match=message):
        KnowledgeFSConfig(**overrides)


def test_knowledge_fs_config_rejects_weak_rsa_key_and_long_token_lifetime() -> None:
    common = {
        "KNOWLEDGE_FS_AUTH_MODE": "dify-jwt",
        "KNOWLEDGE_FS_BASE_URL": "https://knowledge-fs.test",
        "KNOWLEDGE_FS_JWT_KEY_ID": "k1",
        "KNOWLEDGE_FS_JWT_ISSUER": "https://dify.test/knowledge-fs",
    }

    with pytest.raises(ValidationError, match="2048"):
        KnowledgeFSConfig(**common, KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64=_private_key_b64(key_size=1024))

    with pytest.raises(ValidationError, match="less than or equal to 60"):
        KnowledgeFSConfig(
            **common,
            KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64=_private_key_b64(),
            KNOWLEDGE_FS_JWT_TTL_SECONDS=61,
        )
