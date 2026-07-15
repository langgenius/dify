from datetime import UTC, datetime, timedelta

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

from clients.knowledge_fs.credentials import (
    BearerCredential,
    RS256KnowledgeFSCredentialProvider,
    StaticKnowledgeFSCredentialProvider,
)


def test_rs256_credential_is_tenant_scoped_short_lived_and_safe_to_repr() -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime(2026, 7, 15, 10, 30, tzinfo=UTC)
    issuer = "https://dify.test/internal"
    audience = "knowledge-fs"
    key_id = "2026-07-k1"
    token_id = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42"

    provider = RS256KnowledgeFSCredentialProvider(
        private_key=private_key,
        key_id=key_id,
        issuer=issuer,
        audience=audience,
        ttl_seconds=60,
        now=lambda: now,
        jti_factory=lambda: token_id,
    )

    credential = provider.issue(
        tenant_id="tenant-1",
        subject_id="user-1",
        scope="knowledge-spaces:read",
    )

    assert isinstance(credential, BearerCredential)
    assert jwt.get_unverified_header(credential.token) == {
        "alg": "RS256",
        "kid": key_id,
        "typ": "dify-kfs+jwt",
    }

    claims = jwt.decode(
        credential.token,
        private_key.public_key(),
        algorithms=["RS256"],
        audience=audience,
        issuer=issuer,
        options={
            "require": ["iss", "aud", "sub", "tenant_id", "scope", "iat", "nbf", "exp", "jti"],
            "verify_exp": False,
            "verify_iat": False,
            "verify_nbf": False,
        },
    )
    issued_at = int(now.timestamp())
    assert claims == {
        "iss": issuer,
        "aud": audience,
        "sub": "user-1",
        "tenant_id": "tenant-1",
        "scope": "knowledge-spaces:read",
        "iat": issued_at,
        "nbf": issued_at,
        "exp": issued_at + 60,
        "jti": token_id,
    }
    assert claims["exp"] - claims["iat"] == 60
    assert credential.expires_at == now + timedelta(seconds=60)
    assert credential.token not in repr(credential)


def test_static_provider_returns_configured_dev_credential_without_exposing_it_in_repr() -> None:
    provider = StaticKnowledgeFSCredentialProvider(token="dev-static-secret")

    credential = provider.issue(
        tenant_id="tenant-dev",
        subject_id="user-dev",
        scope="knowledge-spaces:read",
    )

    assert credential.token == "dev-static-secret"
    assert credential.expires_at == datetime.max.replace(tzinfo=UTC)
    assert credential.token not in repr(provider)
