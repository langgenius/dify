import base64

from Crypto.PublicKey import RSA
from sqlalchemy.orm import Session

from libs import rsa


def obfuscated_token(token: str) -> str:
    if not token:
        return token
    if len(token) <= 8:
        return "*" * 20
    return token[:6] + "*" * 12 + token[-2:]


def full_mask_token(token_length: int = 20) -> str:
    return "*" * token_length


def encrypt_token(tenant_id: str, token: str, *, session: Session | None = None) -> str:
    from models.account import Tenant

    if session is None:
        from models.engine import db

        tenant = db.session.get(Tenant, tenant_id)
    else:
        tenant = session.get(Tenant, tenant_id)
    if tenant is None:
        raise ValueError(f"Tenant with id {tenant_id} not found")
    assert tenant.encrypt_public_key is not None
    encrypted_token = rsa.encrypt(token, tenant.encrypt_public_key)
    return base64.b64encode(encrypted_token).decode()


def decrypt_token(tenant_id: str, token: str) -> str:
    return rsa.decrypt(base64.b64decode(token), tenant_id)


def batch_decrypt_token(tenant_id: str, tokens: list[str]) -> list[str]:
    rsa_key, cipher_rsa = rsa.get_decrypt_decoding(tenant_id)

    return [rsa.decrypt_token_with_decoding(base64.b64decode(token), rsa_key, cipher_rsa) for token in tokens]


def get_decrypt_decoding(tenant_id: str) -> tuple[RSA.RsaKey, object]:
    return rsa.get_decrypt_decoding(tenant_id)


def decrypt_token_with_decoding(token: str, rsa_key: RSA.RsaKey, cipher_rsa: object) -> str:
    return rsa.decrypt_token_with_decoding(base64.b64decode(token), rsa_key, cipher_rsa)
