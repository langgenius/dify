"""Application service for the first Dataset 2.0 KnowledgeFS slice."""

from __future__ import annotations

import base64
import binascii
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from threading import Lock
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey
from pydantic import SecretStr

from clients.knowledge_fs import (
    KnowledgeFSClient,
    KnowledgeFSConfigurationError,
    KnowledgeSpace,
    KnowledgeSpaceList,
    create_knowledge_fs_client,
)
from clients.knowledge_fs.credentials import (
    KnowledgeFSCredentialProvider,
    RS256KnowledgeFSCredentialProvider,
    StaticKnowledgeFSCredentialProvider,
)
from configs import dify_config


@dataclass(frozen=True, slots=True)
class _RS256CredentialProviderCacheKey:
    """Identify a signer without retaining private key material in the cache key."""

    private_key_digest: str
    key_id: str
    issuer: str
    audience: str
    ttl_seconds: int


_RS256_CREDENTIAL_PROVIDER_CACHE_MAX_SIZE = 4
_rs256_credential_provider_cache: OrderedDict[_RS256CredentialProviderCacheKey, RS256KnowledgeFSCredentialProvider] = (
    OrderedDict()
)
_rs256_credential_provider_cache_lock = Lock()


class KnowledgeSpaceService:
    """Coordinate tenant-aware list and create calls through KnowledgeFS."""

    client: KnowledgeFSClient

    def __init__(self, client: KnowledgeFSClient) -> None:
        self.client = client

    def list_knowledge_spaces(
        self,
        *,
        limit: int,
        cursor: str | None,
        tenant_id: str,
        user_id: str,
    ) -> KnowledgeSpaceList:
        """List spaces authorized for the current KnowledgeFS subject."""
        return self.client.list_knowledge_spaces(
            limit=limit,
            cursor=cursor,
            tenant_id=tenant_id,
            user_id=user_id,
        )

    def create_knowledge_space(
        self,
        *,
        idempotency_key: str,
        name: str,
        description: str | None,
        tenant_id: str,
        user_id: str,
    ) -> KnowledgeSpace:
        """Create a KnowledgeFS space owned by the current subject."""
        return self.client.create_knowledge_space(
            idempotency_key=idempotency_key,
            name=name,
            description=description,
            tenant_id=tenant_id,
            user_id=user_id,
        )


def create_knowledge_space_service() -> KnowledgeSpaceService | None:
    """Build the optional integration from process configuration.

    Returns ``None`` when the feature is wholly unconfigured so the frontend
    can keep Classic Dataset as the only entry. A partial configuration is an
    operator error and must not look like a disabled feature. The development
    credential is bound to one configured tenant before any upstream request.
    """
    auth_mode = dify_config.KNOWLEDGE_FS_AUTH_MODE
    base_url = dify_config.KNOWLEDGE_FS_BASE_URL
    static_token = dify_config.KNOWLEDGE_FS_API_TOKEN
    static_tenant_id = dify_config.KNOWLEDGE_FS_STATIC_TENANT_ID
    jwt_private_key = dify_config.KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64
    jwt_key_id = dify_config.KNOWLEDGE_FS_JWT_KEY_ID
    jwt_issuer = dify_config.KNOWLEDGE_FS_JWT_ISSUER
    configured = any((auth_mode, base_url, static_token, static_tenant_id, jwt_private_key, jwt_key_id, jwt_issuer))
    if not configured:
        return None
    if not base_url:
        raise KnowledgeFSConfigurationError("KNOWLEDGE_FS_BASE_URL is required when KnowledgeFS is enabled")
    if not auth_mode:
        raise KnowledgeFSConfigurationError("KNOWLEDGE_FS_AUTH_MODE is required when KnowledgeFS is enabled")

    credential_provider: KnowledgeFSCredentialProvider
    if auth_mode == "dev-static":
        if not static_token:
            raise KnowledgeFSConfigurationError("KNOWLEDGE_FS_API_TOKEN is required for dev-static auth")
        if not static_tenant_id:
            raise KnowledgeFSConfigurationError("KNOWLEDGE_FS_STATIC_TENANT_ID is required for dev-static auth")
        if not dify_config.KNOWLEDGE_FS_ALLOW_SHARED_TENANT_TOKEN:
            raise KnowledgeFSConfigurationError(
                "KNOWLEDGE_FS_API_TOKEN is a shared tenant token; explicitly enable it only for local "
                "or single-workspace use"
            )
        if any((jwt_private_key, jwt_key_id, jwt_issuer)):
            raise KnowledgeFSConfigurationError("Dify JWT settings cannot be combined with dev-static auth")
        credential_provider = StaticKnowledgeFSCredentialProvider(
            token=static_token.get_secret_value(),
            expected_tenant_id=static_tenant_id,
        )
    elif auth_mode == "dify-jwt":
        if static_token or static_tenant_id or dify_config.KNOWLEDGE_FS_ALLOW_SHARED_TENANT_TOKEN:
            raise KnowledgeFSConfigurationError("Static token settings cannot be combined with dify-jwt auth")
        if jwt_private_key is None or jwt_key_id is None or jwt_issuer is None:
            raise KnowledgeFSConfigurationError(
                "KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64, KNOWLEDGE_FS_JWT_KEY_ID, and "
                "KNOWLEDGE_FS_JWT_ISSUER are required for dify-jwt auth"
            )
        credential_provider = _create_rs256_credential_provider(
            private_key_b64=jwt_private_key,
            key_id=jwt_key_id,
            issuer=jwt_issuer,
            audience=dify_config.KNOWLEDGE_FS_JWT_AUDIENCE,
            ttl_seconds=dify_config.KNOWLEDGE_FS_JWT_TTL_SECONDS,
        )
    else:
        raise KnowledgeFSConfigurationError("KNOWLEDGE_FS_AUTH_MODE must be either dev-static or dify-jwt")

    return KnowledgeSpaceService(
        create_knowledge_fs_client(
            base_url=base_url,
            credential_provider=credential_provider,
            timeout_seconds=float(dify_config.KNOWLEDGE_FS_TIMEOUT_SECONDS),
        )
    )


def _create_rs256_credential_provider(
    *,
    private_key_b64: SecretStr,
    key_id: str,
    issuer: str,
    audience: str,
    ttl_seconds: int,
) -> RS256KnowledgeFSCredentialProvider:
    """Load and cache a validated signer under a non-secret, rotation-aware key."""
    encoded_private_key = private_key_b64.get_secret_value()
    cache_key = _RS256CredentialProviderCacheKey(
        private_key_digest=sha256(encoded_private_key.encode()).hexdigest(),
        key_id=key_id,
        issuer=issuer,
        audience=audience,
        ttl_seconds=ttl_seconds,
    )
    with _rs256_credential_provider_cache_lock:
        cached_provider = _rs256_credential_provider_cache.get(cache_key)
        if cached_provider is not None:
            _rs256_credential_provider_cache.move_to_end(cache_key)
            return cached_provider

        try:
            private_key_pem = base64.b64decode(encoded_private_key, validate=True)
            private_key = serialization.load_pem_private_key(private_key_pem, password=None)
        except (ValueError, TypeError, binascii.Error) as exc:
            raise KnowledgeFSConfigurationError(
                "KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64 must contain an unencrypted PKCS#8 PEM key"
            ) from exc
        if not isinstance(private_key, RSAPrivateKey) or private_key.key_size < 2048:
            raise KnowledgeFSConfigurationError("KnowledgeFS JWT signing requires an RSA key of at least 2048 bits")

        provider = RS256KnowledgeFSCredentialProvider(
            private_key=private_key,
            key_id=key_id,
            issuer=issuer,
            audience=audience,
            ttl_seconds=ttl_seconds,
            now=lambda: datetime.now(UTC),
            jti_factory=lambda: str(uuid4()),
        )
        _rs256_credential_provider_cache[cache_key] = provider
        if len(_rs256_credential_provider_cache) > _RS256_CREDENTIAL_PROVIDER_CACHE_MAX_SIZE:
            _rs256_credential_provider_cache.popitem(last=False)
        return provider
