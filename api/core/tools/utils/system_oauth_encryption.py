import base64
import hashlib
from collections.abc import Mapping
from typing import Any

from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from Crypto.Util.Padding import pad, unpad
from pydantic import TypeAdapter

from configs import dify_config


class OAuthEncryptionError(Exception):
    """OAuth encryption/decryption specific error."""


class SystemOAuthEncrypter:
    def __init__(self, secret_key: str | None = None):
        secret_key = secret_key or dify_config.SECRET_KEY or ""
        self.key = hashlib.sha256(secret_key.encode()).digest()

    def encrypt_oauth_params(self, oauth_params: Mapping[str, Any]) -> str:
        try:
            iv = get_random_bytes(16)
            cipher = AES.new(self.key, AES.MODE_CBC, iv)
            padded_data = pad(TypeAdapter(dict).dump_json(dict(oauth_params)), AES.block_size)
            encrypted_data = cipher.encrypt(padded_data)
            return base64.b64encode(iv + encrypted_data).decode()
        except Exception as e:
            raise OAuthEncryptionError(f"Encryption failed: {str(e)}") from e

    def decrypt_oauth_params(self, encrypted_data: str) -> Mapping[str, Any]:
        if not isinstance(encrypted_data, str):
            raise ValueError("encrypted_data must be a string")
        if not encrypted_data:
            raise ValueError("encrypted_data cannot be empty")

        try:
            combined = base64.b64decode(encrypted_data)
            if len(combined) < 32:
                raise ValueError("Invalid encrypted data format")

            iv = combined[:16]
            encrypted_data_bytes = combined[16:]
            cipher = AES.new(self.key, AES.MODE_CBC, iv)
            decrypted_data = cipher.decrypt(encrypted_data_bytes)
            unpadded_data = unpad(decrypted_data, AES.block_size)
            oauth_params = TypeAdapter(Mapping[str, Any]).validate_json(unpadded_data)
            if not isinstance(oauth_params, dict):
                raise ValueError("Decrypted data is not a valid dictionary")
            return oauth_params
        except Exception as e:
            raise OAuthEncryptionError(f"Decryption failed: {str(e)}") from e


def create_system_oauth_encrypter(secret_key: str | None = None) -> SystemOAuthEncrypter:
    return SystemOAuthEncrypter(secret_key=secret_key)


_oauth_encrypter: SystemOAuthEncrypter | None = None


def get_system_oauth_encrypter() -> SystemOAuthEncrypter:
    global _oauth_encrypter
    if _oauth_encrypter is None:
        _oauth_encrypter = SystemOAuthEncrypter()
    return _oauth_encrypter


def encrypt_system_oauth_params(oauth_params: Mapping[str, Any]) -> str:
    return get_system_oauth_encrypter().encrypt_oauth_params(oauth_params)


def decrypt_system_oauth_params(encrypted_data: str) -> Mapping[str, Any]:
    return get_system_oauth_encrypter().decrypt_oauth_params(encrypted_data)
