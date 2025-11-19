import base64
import binascii
import hashlib
import re

from configs import dify_config

password_pattern = r"^(?=.*[a-zA-Z])(?=.*\d).{8,}$"


def valid_password(password):
    # Define a regex pattern for password rules
    pattern = password_pattern
    # Check if the password matches the pattern
    if re.match(pattern, password) is not None:
        return password

    raise ValueError("Password must contain letters and numbers, and the length must be greater than 8.")


def hash_password(password_str, salt_byte, iterations=None):
    """
    Hash a password using PBKDF2-HMAC-SHA256.

    Args:
        password_str: The plaintext password to hash
        salt_byte: Cryptographic salt as bytes
        iterations: Number of PBKDF2 iterations. If None, uses dify_config.PASSWORD_HASH_ITERATIONS

    Returns:
        Hexadecimal-encoded hash as bytes
    """
    if iterations is None:
        iterations = dify_config.PASSWORD_HASH_ITERATIONS

    dk = hashlib.pbkdf2_hmac(
        "sha256",
        password_str.encode("utf-8"),
        salt_byte,
        iterations,
    )
    return binascii.hexlify(dk)


def compare_password(password_str, password_hashed_base64, salt_base64, iterations=None):
    """
    Compare a plaintext password against a stored hash.

    Supports backward compatibility by trying the configured iteration count first,
    then falling back to the legacy default (10000) if verification fails.

    Args:
        password_str: The plaintext password to verify
        password_hashed_base64: Base64-encoded stored password hash
        salt_base64: Base64-encoded salt
        iterations: Number of PBKDF2 iterations. If None, tries current config then legacy default.

    Returns:
        True if password matches, False otherwise
    """
    password_hash_bytes = base64.b64decode(password_hashed_base64)
    salt_bytes = base64.b64decode(salt_base64)

    if iterations is not None:
        # Explicit iteration count provided - use it directly
        return hash_password(password_str, salt_bytes, iterations) == password_hash_bytes

    # Try current configured iteration count first
    if hash_password(password_str, salt_bytes, dify_config.PASSWORD_HASH_ITERATIONS) == password_hash_bytes:
        return True

    # Fallback: Try legacy default (10000) for backward compatibility
    # This allows passwords hashed with old iteration count to still work
    if dify_config.PASSWORD_HASH_ITERATIONS != 10000:
        if hash_password(password_str, salt_bytes, 10000) == password_hash_bytes:
            return True

    return False
