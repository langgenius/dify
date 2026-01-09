import base64
import hashlib
import logging
from collections.abc import Mapping
from typing import Any

from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from Crypto.Util.Padding import pad, unpad
from pydantic import TypeAdapter

from configs import dify_config

logger = logging.getLogger(__name__)


class EncryptionError(Exception):
    """Encryption/decryption specific error"""

    pass


class SystemEncrypter:
    """
    A simple parameters encrypter using AES-CBC encryption.

    This class provides methods to encrypt and decrypt parameters
    using AES-CBC mode with a key derived from the application's SECRET_KEY.
    """

    def __init__(self, secret_key: str | None = None):
        """
        Initialize the encrypter.

        Args:
            secret_key: Optional secret key. If not provided, uses dify_config.SECRET_KEY

        Raises:
            ValueError: If SECRET_KEY is not configured or empty
        """
        secret_key = secret_key or dify_config.SECRET_KEY or ""

        # Generate a fixed 256-bit key using SHA-256
        self.key = hashlib.sha256(secret_key.encode()).digest()

    def encrypt_params(self, params: Mapping[str, Any]) -> str:
        """
        Encrypt parameters.

        Args:
            params: parameters dictionary, e.g., {"client_id": "xxx", "client_secret": "xxx"}

        Returns:
            Base64-encoded encrypted string

        Raises:
            EncryptionError: If encryption fails
            ValueError: If params is invalid
        """

        try:
            # Generate random IV (16 bytes)
            iv = get_random_bytes(16)

            # Create AES cipher (CBC mode)
            cipher = AES.new(self.key, AES.MODE_CBC, iv)

            # Encrypt data
            padded_data = pad(TypeAdapter(dict).dump_json(dict(params)), AES.block_size)
            encrypted_data = cipher.encrypt(padded_data)

            # Combine IV and encrypted data
            combined = iv + encrypted_data

            # Return base64 encoded string
            return base64.b64encode(combined).decode()

        except Exception as e:
            raise EncryptionError(f"Encryption failed: {str(e)}") from e

    def decrypt_params(self, encrypted_data: str) -> Mapping[str, Any]:
        """
        Decrypt parameters.

        Args:
            encrypted_data: Base64-encoded encrypted string

        Returns:
            Decrypted parameters dictionary

        Raises:
            EncryptionError: If decryption fails
            ValueError: If encrypted_data is invalid
        """
        if not isinstance(encrypted_data, str):
            raise ValueError("encrypted_data must be a string")

        if not encrypted_data:
            raise ValueError("encrypted_data cannot be empty")

        try:
            # Base64 decode
            combined = base64.b64decode(encrypted_data)

            # Check minimum length (IV + at least one AES block)
            if len(combined) < 32:  # 16 bytes IV + 16 bytes minimum encrypted data
                raise ValueError("Invalid encrypted data format")

            # Separate IV and encrypted data
            iv = combined[:16]
            encrypted_data_bytes = combined[16:]

            # Create AES cipher
            cipher = AES.new(self.key, AES.MODE_CBC, iv)

            # Decrypt data
            decrypted_data = cipher.decrypt(encrypted_data_bytes)
            unpadded_data = unpad(decrypted_data, AES.block_size)

            # Parse JSON
            params: Mapping[str, Any] = TypeAdapter(Mapping[str, Any]).validate_json(unpadded_data)

            if not isinstance(params, dict):
                raise ValueError("Decrypted data is not a valid dictionary")

            return params

        except Exception as e:
            raise EncryptionError(f"Decryption failed: {str(e)}") from e


# Factory function for creating encrypter instances
def create_system_encrypter(secret_key: str | None = None) -> SystemEncrypter:
    """
    Create an encrypter instance.

    Args:
        secret_key: Optional secret key. If not provided, uses dify_config.SECRET_KEY

    Returns:
        SystemEncrypter instance
    """
    return SystemEncrypter(secret_key=secret_key)


# Global encrypter instance (for backward compatibility)
_encrypter: SystemEncrypter | None = None


def get_system_encrypter() -> SystemEncrypter:
    """
    Get the global encrypter instance.

    Returns:
        SystemEncrypter instance
    """
    global _encrypter
    if _encrypter is None:
        _encrypter = SystemEncrypter()
    return _encrypter


# Convenience functions for backward compatibility
def encrypt_system_params(params: Mapping[str, Any]) -> str:
    """
    Encrypt parameters using the global encrypter.

    Args:
        params: parameters dictionary

    Returns:
        Base64-encoded encrypted string
    """
    return get_system_encrypter().encrypt_params(params)


def decrypt_system_params(encrypted_data: str) -> Mapping[str, Any]:
    """
    Decrypt parameters using the global encrypter.

    Args:
        encrypted_data: Base64-encoded encrypted string

    Returns:
        Decrypted parameters dictionary
    """
    return get_system_encrypter().decrypt_params(encrypted_data)
