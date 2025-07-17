import base64
import hashlib
import logging
from collections.abc import Mapping
from typing import Any, Optional

from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from Crypto.Util.Padding import pad, unpad
from pydantic import TypeAdapter

from configs import dify_config

logger = logging.getLogger(__name__)


class OAuthEncryptionError(Exception):
    """OAuth encryption/decryption specific error"""

    pass


class SystemOAuthEncrypter:
    """
    A simple OAuth parameters encrypter using AES-CBC encryption.

    This class provides methods to encrypt and decrypt OAuth parameters
    using AES-CBC mode with a key derived from the application's SECRET_KEY.
    """

    def __init__(self, secret_key: Optional[str] = None):
        """
        Initialize the OAuth encrypter.

        Args:
            secret_key: Optional secret key. If not provided, uses dify_config.SECRET_KEY

        Raises:
            ValueError: If SECRET_KEY is not configured or empty
        """
        secret_key = secret_key or dify_config.SECRET_KEY or ""

        # Generate a fixed 256-bit key using SHA-256
        self.key = hashlib.sha256(secret_key.encode()).digest()

    def encrypt_oauth_params(self, oauth_params: Mapping[str, Any]) -> str:
        """
        Encrypt OAuth parameters.

        Args:
            oauth_params: OAuth parameters dictionary, e.g., {"client_id": "xxx", "client_secret": "xxx"}

        Returns:
            Base64-encoded encrypted string

        Raises:
            OAuthEncryptionError: If encryption fails
            ValueError: If oauth_params is invalid
        """

        try:
            # Generate random IV (16 bytes)
            iv = get_random_bytes(16)

            # Create AES cipher (CBC mode)
            cipher = AES.new(self.key, AES.MODE_CBC, iv)

            # Encrypt data
            padded_data = pad(TypeAdapter(dict).dump_json(dict(oauth_params)), AES.block_size)
            encrypted_data = cipher.encrypt(padded_data)

            # Combine IV and encrypted data
            combined = iv + encrypted_data

            # Return base64 encoded string
            return base64.b64encode(combined).decode()

        except Exception as e:
            raise OAuthEncryptionError(f"Encryption failed: {str(e)}") from e

    def decrypt_oauth_params(self, encrypted_data: str) -> Mapping[str, Any]:
        """
        Decrypt OAuth parameters.

        Args:
            encrypted_data: Base64-encoded encrypted string

        Returns:
            Decrypted OAuth parameters dictionary

        Raises:
            OAuthEncryptionError: If decryption fails
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
            oauth_params: Mapping[str, Any] = TypeAdapter(Mapping[str, Any]).validate_json(unpadded_data)

            if not isinstance(oauth_params, dict):
                raise ValueError("Decrypted data is not a valid dictionary")

            return oauth_params

        except Exception as e:
            raise OAuthEncryptionError(f"Decryption failed: {str(e)}") from e


# Factory function for creating encrypter instances
def create_system_oauth_encrypter(secret_key: Optional[str] = None) -> SystemOAuthEncrypter:
    """
    Create an OAuth encrypter instance.

    Args:
        secret_key: Optional secret key. If not provided, uses dify_config.SECRET_KEY

    Returns:
        SystemOAuthEncrypter instance
    """
    return SystemOAuthEncrypter(secret_key=secret_key)


# Global encrypter instance (for backward compatibility)
_oauth_encrypter: Optional[SystemOAuthEncrypter] = None


def get_system_oauth_encrypter() -> SystemOAuthEncrypter:
    """
    Get the global OAuth encrypter instance.

    Returns:
        SystemOAuthEncrypter instance
    """
    global _oauth_encrypter
    if _oauth_encrypter is None:
        _oauth_encrypter = SystemOAuthEncrypter()
    return _oauth_encrypter


# Convenience functions for backward compatibility
def encrypt_system_oauth_params(oauth_params: Mapping[str, Any]) -> str:
    """
    Encrypt OAuth parameters using the global encrypter.

    Args:
        oauth_params: OAuth parameters dictionary

    Returns:
        Base64-encoded encrypted string
    """
    return get_system_oauth_encrypter().encrypt_oauth_params(oauth_params)


def decrypt_system_oauth_params(encrypted_data: str) -> Mapping[str, Any]:
    """
    Decrypt OAuth parameters using the global encrypter.

    Args:
        encrypted_data: Base64-encoded encrypted string

    Returns:
        Decrypted OAuth parameters dictionary
    """
    return get_system_oauth_encrypter().decrypt_oauth_params(encrypted_data)
