"""Abstract interface for tenant credential encryption key providers."""

from abc import ABC, abstractmethod
from typing import Any


class BaseKeyProvider(ABC):
    """Interface for providers that manage the keys used to encrypt/decrypt tenant credentials."""

    @abstractmethod
    def generate_key_pair(self, tenant_id: str) -> str:
        """
        Provision the encryption key for a tenant.

        Returns an opaque reference to be stored in Tenant.encrypt_public_key
        (e.g. a PEM public key, or a key vault key name/identifier).
        """
        raise NotImplementedError

    @abstractmethod
    def encrypt(self, tenant_id: str, text: str) -> bytes:
        raise NotImplementedError

    @abstractmethod
    def get_decrypt_decoding(self, tenant_id: str) -> Any:
        """Return a reusable decoding context, so batch decryption can avoid repeated key lookups."""
        raise NotImplementedError

    @abstractmethod
    def decrypt_with_decoding(self, encrypted_text: bytes, decoding: Any) -> str:
        raise NotImplementedError

    def decrypt(self, tenant_id: str, encrypted_text: bytes) -> str:
        return self.decrypt_with_decoding(encrypted_text, self.get_decrypt_decoding(tenant_id))
