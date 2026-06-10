"""
Field Encoding/Decoding Utilities

Provides Base64 decoding for sensitive fields (password, verification code)
received from the frontend.

Note: This uses Base64 encoding for obfuscation, not cryptographic encryption.
Real security relies on HTTPS for transport layer encryption.
"""

import base64
import logging

logger = logging.getLogger(__name__)


class FieldEncryption:
    """Handle decoding of sensitive fields during transmission"""

    @classmethod
    def decrypt_field(cls, encoded_text: str) -> str | None:
        """
        Decode Base64 encoded field from frontend.

        Args:
            encoded_text: Base64 encoded text from frontend

        Returns:
            Decoded plaintext, or None if decoding fails
        """
        try:
            # Decode base64
            decoded_bytes = base64.b64decode(encoded_text)
            decoded_text = decoded_bytes.decode("utf-8")
            logger.debug("Field decoding successful")
            return decoded_text

        except Exception:
            # Decoding failed - return None to trigger error in caller
            return None

    @classmethod
    def decrypt_password(cls, encrypted_password: str) -> str | None:
        """
        Decrypt password field

        Args:
            encrypted_password: Encrypted password from frontend

        Returns:
            Decrypted password or None if decryption fails
        """
        return cls.decrypt_field(encrypted_password)

    @classmethod
    def decrypt_verification_code(cls, encrypted_code: str) -> str | None:
        """
        Decrypt verification code field

        Args:
            encrypted_code: Encrypted code from frontend

        Returns:
            Decrypted code or None if decryption fails
        """
        return cls.decrypt_field(encrypted_code)
