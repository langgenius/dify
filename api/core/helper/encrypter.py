"""Tenant-scoped token encryption helpers."""

import base64
from typing import Any, Protocol

from libs import rsa


class _SessionLike(Protocol):
    """Subset of SQLAlchemy Session used to load tenant encryption metadata."""

    def get(self, entity: type[Any], ident: Any) -> Any:
        """Return a mapped row by primary key."""
        ...


def obfuscated_token(token: str) -> str:
    if not token:
        return token
    if len(token) <= 8:
        return "*" * 20
    return token[:6] + "*" * 12 + token[-2:]


def full_mask_token(token_length=20):
    return "*" * token_length


def encrypt_token(tenant_id: str, token: str, *, session: _SessionLike | None = None) -> str:
    """Encrypt a token with the tenant public key.

    Pass ``session`` when encryption participates in a caller-owned transaction.
    Omit it only from code paths that intentionally use the configured default
    database session.
    """

    from models.account import Tenant

    if session is None:
        from extensions.ext_database import db

        session = db.session

    if not (tenant := session.get(Tenant, tenant_id)):
        raise ValueError(f"Tenant with id {tenant_id} not found")
    if tenant.encrypt_public_key is None:
        raise ValueError(f"Tenant with id {tenant_id} has no encryption public key")

    encrypted_token = rsa.encrypt(token, tenant.encrypt_public_key)
    return base64.b64encode(encrypted_token).decode()


def decrypt_token(tenant_id: str, token: str) -> str:
    return rsa.decrypt(base64.b64decode(token), tenant_id)


def batch_decrypt_token(tenant_id: str, tokens: list[str]):
    rsa_key, cipher_rsa = rsa.get_decrypt_decoding(tenant_id)

    return [rsa.decrypt_token_with_decoding(base64.b64decode(token), rsa_key, cipher_rsa) for token in tokens]


def get_decrypt_decoding(tenant_id: str):
    return rsa.get_decrypt_decoding(tenant_id)


def decrypt_token_with_decoding(token: str, rsa_key, cipher_rsa):
    return rsa.decrypt_token_with_decoding(base64.b64decode(token), rsa_key, cipher_rsa)
