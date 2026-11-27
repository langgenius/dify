from typing import override

from Crypto.PublicKey import RSA

from libs import rsa
from libs.key_providers.base import BaseKeyProvider


class RSAKeyProvider(BaseKeyProvider):
    """
    Default key provider: per-tenant RSA key pair.

    The private key is kept in the configured STORAGE_TYPE backend (see libs/rsa.py).
    This provider only composes the existing libs.rsa implementation; the underlying
    crypto logic is intentionally left untouched.
    """

    @override
    def generate_key_pair(self, tenant_id: str) -> str:
        return rsa.generate_key_pair(tenant_id)

    @override
    def encrypt(self, tenant_id: str, text: str) -> bytes:
        from models.account import Tenant
        from models.engine import db

        if not (tenant := db.session.get(Tenant, tenant_id)):
            raise ValueError(f"Tenant with id {tenant_id} not found")
        if tenant.encrypt_public_key is None:
            raise ValueError(f"Tenant with id {tenant_id} has no encrypt_public_key")
        return rsa.encrypt(text, tenant.encrypt_public_key)

    @override
    def get_decrypt_decoding(self, tenant_id: str) -> tuple[RSA.RsaKey, object]:
        return rsa.get_decrypt_decoding(tenant_id)

    @override
    def decrypt_with_decoding(self, encrypted_text: bytes, decoding: tuple[RSA.RsaKey, object]) -> str:
        rsa_key, cipher_rsa = decoding
        return rsa.decrypt_token_with_decoding(encrypted_text, rsa_key, cipher_rsa)

    @override
    def decrypt(self, tenant_id: str, encrypted_text: bytes) -> str:
        # Overrides BaseKeyProvider's generic get_decrypt_decoding()+decrypt_with_decoding()
        # composition to call libs.rsa.decrypt() directly (a single-shot equivalent), matching
        # this provider's one supported decrypt path in libs/rsa.py.
        return rsa.decrypt(encrypted_text, tenant_id)
