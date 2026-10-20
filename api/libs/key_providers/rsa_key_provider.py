from collections.abc import Callable
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

    def __init__(self, *, public_key_reader: Callable[[str], str]) -> None:
        self._public_key_reader = public_key_reader

    @override
    def generate_key_pair(self, tenant_id: str) -> str:
        return rsa.generate_key_pair(tenant_id)

    @override
    def encrypt(self, tenant_id: str, text: str) -> bytes:
        return rsa.encrypt(text, self._public_key_reader(tenant_id))

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
