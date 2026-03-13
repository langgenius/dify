import time
import uuid

import jwt
from werkzeug.exceptions import Unauthorized

from configs import dify_config
from extensions.ext_redis import redis_client


def _get_blacklist_key(jti: str) -> str:
    """Generate Redis key for token blacklist using JWT ID."""
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
        """Add token to blacklist until its expiration using JWT ID (jti).

        Returns False if the token is invalid, missing exp/jti, or already expired.
        """
        try:
            payload = jwt.decode(token, options={"verify_signature": False})
        except jwt.PyJWTError:
            # Invalid/garbled token: treat as non-revocable
            return False

        jti = payload.get("jti")
        if not jti:
            # Fallback for tokens without jti (old format)
            # Use the full token as key for backward compatibility
            jti = token

        exp = payload.get("exp")
        if not exp:
            return False

        ttl = int(exp - time.time())
        if ttl <= 0:
            return False

        redis_client.setex(cls._get_blacklist_key(jti), ttl, "1")
        return True

    def verify(self, token):
        """Verify a JWT and then enforce revocation via Redis blacklist.

        The signature and standard claims are verified first to avoid any processing
        of untrusted data (including Redis lookups) for invalid tokens. Only after a
        successful verification do we consult the blacklist using the token's `jti`.
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

        # 2) Enforce revocation via blacklist using jti (if present)
        jti = verified_payload.get("jti")
        if jti:
            if redis_client.exists(self._get_blacklist_key(jti)):
                raise Unauthorized("Token has been revoked.")
        else:
            # Fallback for old tokens without jti
            if redis_client.exists(self._get_blacklist_key(token)):
                raise Unauthorized("Token has been revoked.")

        return verified_payload
