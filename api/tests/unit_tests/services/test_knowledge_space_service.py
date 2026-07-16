from __future__ import annotations

import base64
from datetime import UTC, datetime
from unittest.mock import MagicMock

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import SecretStr

import services.knowledge_space_service as knowledge_space_service_module
from clients.knowledge_fs import KnowledgeFSConfigurationError
from clients.knowledge_fs.credentials import (
    RS256KnowledgeFSCredentialProvider,
    StaticKnowledgeFSCredentialProvider,
)
from services.knowledge_space_service import KnowledgeSpaceService, create_knowledge_space_service


def _private_key() -> tuple[rsa.RSAPrivateKey, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return private_key, base64.b64encode(pem).decode()


def _set_disabled_config(monkeypatch) -> None:
    values = {
        "KNOWLEDGE_FS_AUTH_MODE": None,
        "KNOWLEDGE_FS_BASE_URL": None,
        "KNOWLEDGE_FS_API_TOKEN": None,
        "KNOWLEDGE_FS_STATIC_TENANT_ID": None,
        "KNOWLEDGE_FS_ALLOW_SHARED_TENANT_TOKEN": False,
        "KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64": None,
        "KNOWLEDGE_FS_JWT_KEY_ID": None,
        "KNOWLEDGE_FS_JWT_ISSUER": None,
        "KNOWLEDGE_FS_JWT_AUDIENCE": "knowledge-fs",
        "KNOWLEDGE_FS_JWT_TTL_SECONDS": 60,
        "KNOWLEDGE_FS_TIMEOUT_SECONDS": 10.0,
    }
    for name, value in values.items():
        monkeypatch.setattr(f"services.knowledge_space_service.dify_config.{name}", value, raising=False)


def test_factory_returns_none_when_kfs_is_fully_unconfigured(monkeypatch) -> None:
    _set_disabled_config(monkeypatch)

    assert create_knowledge_space_service() is None


def test_factory_rejects_partial_kfs_configuration(monkeypatch) -> None:
    _set_disabled_config(monkeypatch)
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_BASE_URL",
        "http://localhost:8788",
    )

    with pytest.raises(KnowledgeFSConfigurationError, match="AUTH_MODE"):
        create_knowledge_space_service()


def test_factory_rejects_shared_tenant_token_without_explicit_single_tenant_opt_in(monkeypatch) -> None:
    _set_disabled_config(monkeypatch)
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_AUTH_MODE",
        "dev-static",
        raising=False,
    )
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_BASE_URL",
        "http://localhost:8788",
    )
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_API_TOKEN",
        SecretStr("dev-token"),
    )
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_STATIC_TENANT_ID",
        "tenant-dev",
        raising=False,
    )
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_ALLOW_SHARED_TENANT_TOKEN",
        False,
        raising=False,
    )

    with pytest.raises(KnowledgeFSConfigurationError, match="shared tenant token"):
        create_knowledge_space_service()


def test_factory_rejects_dev_static_without_an_explicit_tenant(monkeypatch) -> None:
    _set_disabled_config(monkeypatch)
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_AUTH_MODE",
        "dev-static",
        raising=False,
    )
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_BASE_URL",
        "http://localhost:8788",
    )
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_API_TOKEN",
        SecretStr("dev-token"),
    )
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_ALLOW_SHARED_TENANT_TOKEN",
        True,
        raising=False,
    )

    with pytest.raises(KnowledgeFSConfigurationError, match="STATIC_TENANT_ID"):
        create_knowledge_space_service()


def test_factory_builds_service_from_server_only_configuration(monkeypatch) -> None:
    _set_disabled_config(monkeypatch)
    client = MagicMock()
    factory = MagicMock(return_value=client)
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_AUTH_MODE",
        "dev-static",
        raising=False,
    )
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_BASE_URL",
        "http://localhost:8788/",
    )
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_API_TOKEN",
        SecretStr("dev-token"),
    )
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_STATIC_TENANT_ID",
        "tenant-dev",
        raising=False,
    )
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_TIMEOUT_SECONDS",
        7.5,
    )
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_ALLOW_SHARED_TENANT_TOKEN",
        True,
        raising=False,
    )
    monkeypatch.setattr("services.knowledge_space_service.create_knowledge_fs_client", factory)

    service = create_knowledge_space_service()

    assert isinstance(service, KnowledgeSpaceService)
    assert service.client is client
    factory.assert_called_once()
    call = factory.call_args.kwargs
    assert call["base_url"] == "http://localhost:8788/"
    assert call["timeout_seconds"] == 7.5
    assert isinstance(call["credential_provider"], StaticKnowledgeFSCredentialProvider)
    credential = call["credential_provider"].issue(
        tenant_id="tenant-dev",
        subject_id="user-dev",
        scope="knowledge-spaces:read",
    )
    assert credential.token == "dev-token"


def test_factory_builds_request_scoped_rs256_provider_for_production_profile(monkeypatch) -> None:
    _set_disabled_config(monkeypatch)
    private_key, encoded_private_key = _private_key()
    client = MagicMock()
    factory = MagicMock(return_value=client)
    configured = {
        "KNOWLEDGE_FS_AUTH_MODE": "dify-jwt",
        "KNOWLEDGE_FS_BASE_URL": "https://knowledge-fs.test",
        "KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64": SecretStr(encoded_private_key),
        "KNOWLEDGE_FS_JWT_KEY_ID": "2026-07-k1",
        "KNOWLEDGE_FS_JWT_ISSUER": "https://dify.test/knowledge-fs",
        "KNOWLEDGE_FS_JWT_AUDIENCE": "urn:langgenius:knowledge-fs",
        "KNOWLEDGE_FS_JWT_TTL_SECONDS": 60,
        "KNOWLEDGE_FS_TIMEOUT_SECONDS": 7.5,
    }
    for name, value in configured.items():
        monkeypatch.setattr(f"services.knowledge_space_service.dify_config.{name}", value, raising=False)
    monkeypatch.setattr("services.knowledge_space_service.create_knowledge_fs_client", factory)

    service = create_knowledge_space_service()

    assert isinstance(service, KnowledgeSpaceService)
    provider = factory.call_args.kwargs["credential_provider"]
    assert isinstance(provider, RS256KnowledgeFSCredentialProvider)
    credential = provider.issue(
        tenant_id="tenant-a",
        subject_id="user-a",
        scope="knowledge-spaces:write",
    )
    claims = jwt.decode(
        credential.token,
        private_key.public_key(),
        algorithms=["RS256"],
        audience="urn:langgenius:knowledge-fs",
        issuer="https://dify.test/knowledge-fs",
    )
    assert claims["tenant_id"] == "tenant-a"
    assert claims["sub"] == "user-a"
    assert claims["scope"] == "knowledge-spaces:write"
    assert claims["exp"] - claims["iat"] == 60
    assert datetime.fromtimestamp(claims["exp"], tz=UTC) == credential.expires_at


def test_factory_cache_excludes_private_key_material_and_refreshes_after_rotation(monkeypatch) -> None:
    _set_disabled_config(monkeypatch)
    first_private_key, first_encoded_private_key = _private_key()
    second_private_key, second_encoded_private_key = _private_key()
    factory = MagicMock(return_value=MagicMock())
    configured = {
        "KNOWLEDGE_FS_AUTH_MODE": "dify-jwt",
        "KNOWLEDGE_FS_BASE_URL": "https://knowledge-fs.test",
        "KNOWLEDGE_FS_JWT_KEY_ID": "2026-07-k1",
        "KNOWLEDGE_FS_JWT_ISSUER": "https://dify.test/knowledge-fs",
        "KNOWLEDGE_FS_JWT_AUDIENCE": "knowledge-fs",
        "KNOWLEDGE_FS_JWT_TTL_SECONDS": 60,
    }
    for name, value in configured.items():
        monkeypatch.setattr(f"services.knowledge_space_service.dify_config.{name}", value, raising=False)
    monkeypatch.setattr("services.knowledge_space_service.create_knowledge_fs_client", factory)

    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64",
        SecretStr(first_encoded_private_key),
    )
    create_knowledge_space_service()
    first_provider = factory.call_args.kwargs["credential_provider"]

    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64",
        SecretStr(second_encoded_private_key),
    )
    create_knowledge_space_service()
    second_provider = factory.call_args.kwargs["credential_provider"]

    assert first_provider is not second_provider
    assert first_encoded_private_key not in repr(knowledge_space_service_module._rs256_credential_provider_cache)
    assert second_encoded_private_key not in repr(knowledge_space_service_module._rs256_credential_provider_cache)

    credential = second_provider.issue(
        tenant_id="tenant-a",
        subject_id="user-a",
        scope="knowledge-spaces:read",
    )
    claims = jwt.decode(
        credential.token,
        second_private_key.public_key(),
        algorithms=["RS256"],
        audience="knowledge-fs",
        issuer="https://dify.test/knowledge-fs",
    )
    assert claims["tenant_id"] == "tenant-a"
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(
            credential.token,
            first_private_key.public_key(),
            algorithms=["RS256"],
            audience="knowledge-fs",
            issuer="https://dify.test/knowledge-fs",
        )
