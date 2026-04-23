import time
import uuid
from datetime import UTC, datetime

import jwt
from werkzeug.exceptions import Unauthorized

from configs import dify_config
from libs.session_revocation_storage import get_session_revocation_storage


def _get_blacklist_key(jti: str) -> str:
    return f"passport:blacklist:jti:{jti}"


class PassportService:
    def __init__(self):
        self.sk = dify_config.SECRET_KEY

    @classmethod
    def _get_blacklist_key(cls, jti: str) -> str:
        """Instance-accessible helper for tests and internal use."""
        return _get_blacklist_key(jti)

    def issue(self, payload):
        # Add jti (JWT ID) if not present for token revocation support
        payload_to_encode = dict(payload)
        if "jti" not in payload_to_encode:
            payload_to_encode["jti"] = str(uuid.uuid4())
        return jwt.encode(payload_to_encode, self.sk, algorithm="HS256")

    @classmethod
    def revoke(cls, token: str) -> bool:
        try:
            payload = jwt.decode(token, options={"verify_signature": False})
        except jwt.PyJWTError:
            # Invalid/garbled token: treat as non-revocable
            return False

        token_id = payload.get("jti") or token
        exp = payload.get("exp")
        if not exp:
            return False

        ttl = int(exp - time.time())
        if ttl <= 0:
            return False

        storage = get_session_revocation_storage()
        storage.revoke(token_id, datetime.fromtimestamp(exp, tz=UTC))
        return True

    def verify(self, token):
        """Verify a JWT and then enforce revocation via SessionRevocationStorage.

        The signature and standard claims are verified first to avoid any processing
        of untrusted data for invalid tokens. After successful verification we consult
        the configured revocation storage using the token's `jti` when present.
        """
        # 1) Verify signature/claims first
        try:
            verified_payload = jwt.decode(token, self.sk, algorithms=["HS256"])
        except jwt.ExpiredSignatureError:
            raise Unauthorized("Token has expired.")
        except jwt.InvalidSignatureError:
            raise Unauthorized("Invalid token signature.")
        except jwt.DecodeError:
            raise Unauthorized("Invalid token.")
        except jwt.PyJWTError:  # Catch-all for other JWT errors
            raise Unauthorized("Invalid token.")

        # 2) Enforce revocation using storage (supports old tokens without jti)
        storage = get_session_revocation_storage()
        token_id = verified_payload.get("jti") or token
        if storage.is_revoked(token_id):
            raise Unauthorized("Token has been revoked.")

        return verified_payload
