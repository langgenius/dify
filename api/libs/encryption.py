"""
Field Encryption/Decryption Utilities

Provides AES-256-CBC decryption for sensitive fields (password, verification code)
received from the frontend. The frontend uses crypto-js for encryption.
"""

import base64
import hashlib
import logging

from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad

from configs import dify_config

logger = logging.getLogger(__name__)


class FieldEncryption:
    """Handle encryption/decryption of sensitive fields during transmission"""

    @staticmethod
    def is_enabled() -> bool:
        """Check if field encryption is enabled and properly configured"""
        return dify_config.ENABLE_FIELD_ENCRYPTION and bool(dify_config.ENCRYPTION_KEY)

    @staticmethod
    def _derive_key_and_iv(passphrase: str, salt: bytes) -> tuple[bytes, bytes]:
        """
        Derive key and IV from passphrase using PBKDF2-HMAC-SHA256.

        This uses a modern, secure KDF instead of the legacy MD5-based EVP_BytesToKey.
        Both frontend and backend must use the same KDF parameters for compatibility.

        Args:
            passphrase: The encryption passphrase
            salt: 8-byte salt

        Returns:
            Tuple of (key, iv) each 32 bytes and 16 bytes respectively
        """
        key_size = 32  # 256 bits for AES-256
        iv_size = 16  # 128 bits for AES CBC mode
        iterations = 100_000  # OWASP recommended minimum for PBKDF2

        # Derive key and IV using PBKDF2-HMAC-SHA256
        derived = hashlib.pbkdf2_hmac(
            "sha256",
            passphrase.encode("utf-8"),
            salt,
            iterations,
            dklen=key_size + iv_size,
        )

        key = derived[:key_size]
        iv = derived[key_size : key_size + iv_size]
        return key, iv

    @classmethod
    def decrypt_field(cls, ciphertext: str) -> str | None:
        """
        Decrypt field using AES-256-CBC
        Compatible with crypto-js AES.encrypt() format

        Args:
            ciphertext: Base64 encoded encrypted text from frontend

        Returns:
            Decrypted plaintext, or None if decryption fails
        """
        # If encryption is disabled, return ciphertext as-is (treat as plaintext)
        if not cls.is_enabled():
            logger.debug("Field encryption is disabled, returning ciphertext as plaintext")
            return ciphertext

        try:
            # Decode the base64 ciphertext
            try:
                encrypted_bytes = base64.b64decode(ciphertext)
            except Exception as e:
                # If base64 decode fails, might be plaintext (encryption disabled on frontend)
                logger.warning("Failed to decode base64, treating as plaintext: %s", e)
                return ciphertext

            # crypto-js format: "Salted__" + 8 bytes salt + actual ciphertext
            if not encrypted_bytes.startswith(b"Salted__"):
                # Not in crypto-js format, might be plaintext or wrong format
                logger.warning("Encrypted data does not start with 'Salted__' prefix, treating as plaintext")
                return ciphertext

            # Extract salt and ciphertext
            salt = encrypted_bytes[8:16]  # 8 bytes after "Salted__"
            ct = encrypted_bytes[16:]  # Rest is ciphertext

            logger.debug("Decrypting field with salt length: %d, ciphertext length: %d", len(salt), len(ct))

            # Derive key and IV using the same method as crypto-js
            key, iv = cls._derive_key_and_iv(dify_config.ENCRYPTION_KEY, salt)

            # Decrypt using AES-256-CBC
            cipher = AES.new(key, AES.MODE_CBC, iv)
            decrypted_padded = cipher.decrypt(ct)

            # Remove PKCS7 padding
            decrypted = unpad(decrypted_padded, AES.block_size)

            decrypted_text = decrypted.decode("utf-8")
            logger.debug("Field decryption successful")
            return decrypted_text

        except Exception as e:
            logger.error("Field decryption failed: %s", e, exc_info=True)
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
