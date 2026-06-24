import base64
from typing import Any

from libs import rsa


def obfuscated_token(token: str) -> str:
    if not token:
        return token
    if len(token) <= 8:
        return "*" * 20
    return token[:6] + "*" * 12 + token[-2:]


def full_mask_token(token_length: int = 20) -> str:
    return "*" * token_length


def encrypt_token(tenant_id: str, token: str) -> str:
    from models.account import Tenant
    from models.engine import db

    if not (tenant := db.session.get(Tenant, tenant_id)):
        raise ValueError(f"Tenant with id {tenant_id} not found")
    assert tenant.encrypt_public_key is not None
    encrypted_token = rsa.encrypt(token, tenant.encrypt_public_key)
    return base64.b64encode(encrypted_token).decode()


def decrypt_token(tenant_id: str, token: str) -> str:
    return rsa.decrypt(base64.b64decode(token), tenant_id)


def batch_decrypt_token(tenant_id: str, tokens: list[str]) -> list[str]:
    rsa_key, cipher_rsa = rsa.get_decrypt_decoding(tenant_id)

    return [rsa.decrypt_token_with_decoding(base64.b64decode(token), rsa_key, cipher_rsa) for token in tokens]


def get_decrypt_decoding(tenant_id: str) -> tuple[Any, Any]:
    return rsa.get_decrypt_decoding(tenant_id)


def decrypt_token_with_decoding(token: str, rsa_key: Any, cipher_rsa: Any) -> str:
    return rsa.decrypt_token_with_decoding(base64.b64decode(token), rsa_key, cipher_rsa)
