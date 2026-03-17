from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Protocol, runtime_checkable

from configs import dify_config
from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)


@runtime_checkable
class SessionRevocationStorage(Protocol):
    def revoke(self, token_id: str, expiration_time: datetime) -> None: ...
    def is_revoked(self, token_id: str) -> bool: ...
    def expunge(self) -> None: ...


class NullSessionRevocationStorage(SessionRevocationStorage):
    def revoke(self, token_id: str, expiration_time: datetime) -> None:
        return None

    def is_revoked(self, token_id: str) -> bool:
        return False

    def expunge(self) -> None:
        return None


class RedisSessionRevocationStorage(SessionRevocationStorage):
    def __init__(self, key_prefix: str = "passport:blacklist:jti:") -> None:
        self.key_prefix = key_prefix

    def _key(self, token_id: str) -> str:
        return f"{self.key_prefix}{token_id}"

    def revoke(self, token_id: str, expiration_time: datetime) -> None:
        # Compute remaining lifetime in seconds
        now_ts = datetime.now(UTC).timestamp()
        ttl = int(expiration_time.timestamp() - now_ts)
        if ttl <= 0:
            return None
        redis_client.setex(self._key(token_id), ttl, b"1")
        return None

    def is_revoked(self, token_id: str) -> bool:
        return bool(redis_client.exists(self._key(token_id)))

    def expunge(self) -> None:
        return None


_singleton: SessionRevocationStorage | None = None


def get_session_revocation_storage() -> SessionRevocationStorage:
    global _singleton
    if _singleton is not None:
        return _singleton

    backend = (dify_config.SESSION_REVOCATION_STORAGE or "null").strip().lower()
    if backend in ("", "null", "disabled", "off"):
        _singleton = NullSessionRevocationStorage()
    elif backend == "redis":
        _singleton = RedisSessionRevocationStorage()
    else:
        logger.warning(
            "Unknown SESSION_REVOCATION_STORAGE '%s'; falling back to 'null' (disabled).",
            backend,
        )
        _singleton = NullSessionRevocationStorage()
    return _singleton
