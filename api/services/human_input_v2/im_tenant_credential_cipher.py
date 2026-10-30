"""Tenant-bound IM credential encryption."""

from libs.key_providers.base import BaseKeyProvider


class TenantBoundCredentialCipher:
    def __init__(self, key_provider: BaseKeyProvider, tenant_id: str) -> None:
        self._key_provider = key_provider
        self._tenant_id = tenant_id

    def encrypt(self, plaintext: str) -> bytes:
        return self._key_provider.encrypt(self._tenant_id, plaintext)

    def decrypt(self, ciphertext: bytes) -> str:
        return self._key_provider.decrypt(self._tenant_id, ciphertext)


__all__ = ["TenantBoundCredentialCipher"]
