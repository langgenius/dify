"""Owner-bound credential encryption capabilities and sanitized failures."""

from typing import Protocol


class CredentialCipherError(Exception):
    """Credential protection failed without exposing key or credential material."""


class CredentialKeyUnavailableError(CredentialCipherError):
    """The configured credential key cannot be safely loaded or provisioned."""


class InvalidCredentialCiphertextError(CredentialCipherError):
    """The ciphertext is malformed or cannot be authenticated by this key."""


class BoundCredentialCipher(Protocol):
    """Only encrypt/decrypt within an ownership boundary resolved by composition."""

    def encrypt(self, plaintext: str) -> bytes:
        """Require text; return randomized authenticated bytes or fail without plaintext."""
        ...

    def decrypt(self, ciphertext: bytes) -> str:
        """Require encrypted bytes; return authenticated text or fail without partial plaintext."""
        ...
