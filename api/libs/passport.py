import time

import jwt
from werkzeug.exceptions import Unauthorized

from configs import dify_config
from extensions.ext_redis import redis_client


def _get_blacklist_key(token: str) -> str:
    """Generate Redis key for token blacklist."""
    return f"passport:blacklist:{token}"


class PassportService:
    def __init__(self):
        self.sk = dify_config.SECRET_KEY

    @classmethod
    def _get_blacklist_key(cls, token: str) -> str:
        """Instance-accessible helper for tests and internal use."""
        return _get_blacklist_key(token)

    def issue(self, payload):
        return jwt.encode(payload, self.sk, algorithm="HS256")

    @classmethod
    def revoke(cls, token: str) -> bool:
        """Add token to blacklist until its expiration.

        Returns False if the token is invalid, missing exp, or already expired.
        """
        try:
            payload = jwt.decode(token, options={"verify_signature": False})
        except jwt.PyJWTError:
            # Invalid/garbled token: treat as non-revocable
            return False

        exp = payload.get("exp")
        if not exp:
            return False

        ttl = int(exp - time.time())
        if ttl <= 0:
            return False

        redis_client.setex(cls._get_blacklist_key(token), ttl, "1")
        return True

    def verify(self, token):
        if redis_client.exists(self._get_blacklist_key(token)):
            raise Unauthorized("Token has been revoked.")

        try:
            return jwt.decode(token, self.sk, algorithms=["HS256"])
        except jwt.ExpiredSignatureError:
            raise Unauthorized("Token has expired.")
        except jwt.InvalidSignatureError:
            raise Unauthorized("Invalid token signature.")
        except jwt.DecodeError:
            raise Unauthorized("Invalid token.")
        except jwt.PyJWTError:  # Catch-all for other JWT errors
            raise Unauthorized("Invalid token.")
