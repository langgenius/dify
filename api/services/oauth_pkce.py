"""PKCE (RFC 7636) helpers. Only the S256 method is supported."""

import base64
import hashlib
import hmac
import re
from enum import StrEnum

_CHALLENGE_PATTERN = re.compile(r"[A-Za-z0-9\-._~]{43,128}")


class PkceMethod(StrEnum):
    S256 = "S256"


def is_valid_challenge(challenge: str) -> bool:
    return _CHALLENGE_PATTERN.fullmatch(challenge) is not None


def verify_pkce(verifier: str, challenge: str) -> bool:
    if not is_valid_challenge(verifier):
        return False
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    expected = base64.urlsafe_b64encode(digest).rstrip(b"=")
    return hmac.compare_digest(expected, challenge.encode("utf-8"))
