"""Recover PAT secrets using a dedicated, deployment-managed encryption key."""

import os
from collections.abc import Callable

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class PersonalAccessTokenKeyUnavailableError(Exception):
    """The instance has no usable PAT encryption key."""


class AESPersonalAccessTokenCipher:
    def __init__(self, *, key: Callable[[], str]) -> None:
        self._key = key

    def _aes(self) -> AESGCM:
        try:
            key = bytes.fromhex(self._key())
        except ValueError:
            raise PersonalAccessTokenKeyUnavailableError("PAT encryption is not configured.") from None
        if len(key) != 32:
            raise PersonalAccessTokenKeyUnavailableError("PAT encryption is not configured.")
        return AESGCM(key)

    def encrypt(self, secret: str, *, token_id: str, account_id: str) -> bytes:
        nonce = os.urandom(12)
        aad = f"pat:v1:{account_id}:{token_id}".encode()
        return nonce + self._aes().encrypt(nonce, secret.encode(), aad)

    def decrypt(self, ciphertext: bytes, *, token_id: str, account_id: str) -> str:
        aad = f"pat:v1:{account_id}:{token_id}".encode()
        try:
            return self._aes().decrypt(ciphertext[:12], ciphertext[12:], aad).decode()
        except (InvalidTag, ValueError, UnicodeDecodeError):
            raise PersonalAccessTokenKeyUnavailableError("PAT secret cannot be recovered.") from None
