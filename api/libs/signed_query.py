"""Timestamped HMAC query parameters shared by URL producers."""

import base64
import hashlib
import hmac
import os
import time


def sign_query(*, payload: str, key: bytes) -> dict[str, str]:
    timestamp = str(int(time.time()))
    nonce = os.urandom(16).hex()
    signature = hmac.new(key, f"{payload}|{timestamp}|{nonce}".encode(), hashlib.sha256).digest()
    return {"timestamp": timestamp, "nonce": nonce, "sign": base64.urlsafe_b64encode(signature).decode()}
