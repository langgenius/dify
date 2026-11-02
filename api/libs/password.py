import base64
import binascii
import hashlib
import hmac
import re

from configs import dify_config

password_pattern = r"^(?=.*[a-zA-Z])(?=.*\d).{8,}$"


def valid_password(password):
    # Define a regex pattern for password rules
    pattern = password_pattern
    # Check if the password matches the pattern
    if re.match(pattern, password) is not None:
        return password

    raise ValueError("Password must contain letters and numbers, and the length must be at least 8 characters.")


def hash_password(password_str: str, salt_byte: bytes):
    dk = hashlib.pbkdf2_hmac("sha256", password_str.encode("utf-8"), salt_byte, 10000)
    # The pepper wraps the legacy PBKDF2 digest, so changing PASSWORD_PEPPER invalidates every stored hash.
    if pepper := dify_config.PASSWORD_PEPPER:
        dk = hmac.new(pepper.encode("utf-8"), dk, hashlib.sha256).digest()
    return binascii.hexlify(dk)


def compare_password(password_str, password_hashed_base64, salt_base64):
    # compare password for login
    return hash_password(password_str, base64.b64decode(salt_base64)) == base64.b64decode(password_hashed_base64)
