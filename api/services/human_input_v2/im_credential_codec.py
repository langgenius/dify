from base64 import b64decode, b64encode
from typing import Protocol

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.credentials import (
    IMProviderCredentials,
    IMProviderCredentialsAdapter,
)
from models.human_input_v2 import IMEncryptedCredentials

_SAFE_ERROR = "IM credential configuration is unavailable"


class BoundCredentialCipher(Protocol):
    """A credential cipher bounded to a tenant or the whole deployment."""

    def encrypt(self, plaintext: str) -> bytes: ...
    def decrypt(self, ciphertext: bytes) -> str: ...


class IMCredentialError(ValueError): ...


class IMCredentialCodec:
    def __init__(self, cipher: BoundCredentialCipher) -> None:
        self._cipher = cipher

    def seal(self, credentials: IMProviderCredentials) -> IMEncryptedCredentials:
        encrypted = self._cipher.encrypt(credentials.model_dump_json())
        return IMEncryptedCredentials(ciphertext=b64encode(encrypted).decode())

    def load(
        self,
        provider: IMProvider,
        envelope: IMEncryptedCredentials,
    ) -> IMProviderCredentials:
        if envelope.version != 1:
            raise IMCredentialError(_SAFE_ERROR)
        try:
            decrypted = self._cipher.decrypt(b64decode(envelope.ciphertext))
            credentials = IMProviderCredentialsAdapter.validate_json(decrypted)
        except Exception as exc:
            raise IMCredentialError(_SAFE_ERROR) from exc
        if credentials.provider is not provider:
            raise IMCredentialError(_SAFE_ERROR)
        return credentials
