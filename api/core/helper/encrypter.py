import base64
from typing import Any

from configs import dify_config
from libs import rsa
from libs.key_providers.key_provider_type import KeyProviderType


def obfuscated_token(token: str) -> str:
    if not token:
        return token
    if len(token) <= 8:
        return "*" * 20
    return token[:6] + "*" * 12 + token[-2:]


def full_mask_token(token_length: int = 20) -> str:
    return "*" * token_length


def _use_local_provider() -> bool:
    return dify_config.KEY_PROVIDER_TYPE == KeyProviderType.LOCAL


def encrypt_token(tenant_id: str, token: str) -> str:
    if _use_local_provider():
        from models.account import Tenant
        from models.engine import db

        if not (tenant := db.session.get(Tenant, tenant_id)):
            raise ValueError(f"Tenant with id {tenant_id} not found")
        if tenant.encrypt_public_key is None:
            raise ValueError(f"Tenant with id {tenant_id} has no encrypt_public_key")
        encrypted_token = rsa.encrypt(token, tenant.encrypt_public_key)
        return base64.b64encode(encrypted_token).decode()

    from extensions.ext_key_provider import key_provider_manager

    encrypted_token = key_provider_manager.provider.encrypt(tenant_id, token)
    return base64.b64encode(encrypted_token).decode()


def decrypt_token(tenant_id: str, token: str) -> str:
    if _use_local_provider():
        return rsa.decrypt(base64.b64decode(token), tenant_id)

    from extensions.ext_key_provider import key_provider_manager

    return key_provider_manager.provider.decrypt(tenant_id, base64.b64decode(token))


def batch_decrypt_token(tenant_id: str, tokens: list[str]) -> list[str]:
    decoding = get_decrypt_decoding(tenant_id)
    return [decrypt_token_with_decoding(token, decoding) for token in tokens]


def get_decrypt_decoding(tenant_id: str) -> Any:
    """
    Return a reusable decoding context for batch/repeated decryption of a tenant's credentials
    (e.g. across many provider/model configs in the same request). The returned object is opaque
    and must only be passed back into decrypt_token_with_decoding.
    """
    if _use_local_provider():
        return rsa.get_decrypt_decoding(tenant_id)

    from extensions.ext_key_provider import key_provider_manager

    return key_provider_manager.provider.get_decrypt_decoding(tenant_id)


def decrypt_token_with_decoding(token: str, decoding: Any) -> str:
    if _use_local_provider():
        rsa_key, cipher_rsa = decoding
        return rsa.decrypt_token_with_decoding(base64.b64decode(token), rsa_key, cipher_rsa)

    from extensions.ext_key_provider import key_provider_manager

    return key_provider_manager.provider.decrypt_with_decoding(base64.b64decode(token), decoding)
