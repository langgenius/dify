import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any, Generic, Protocol, TypeVar

from pydantic import BaseModel, Field, ValidationError

from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)


class SessionStorage(Protocol):
    """Session storage interface."""

    def get(self, key: str) -> str | None: ...
    def set(self, key: str, value: str, ttl: int) -> None: ...
    def delete(self, key: str) -> bool: ...
    def exists(self, key: str) -> bool: ...
    def refresh_ttl(self, key: str, ttl: int) -> bool: ...


class RedisSessionStorage:
    """Redis storage implementation (default)."""

    def get(self, key: str) -> str | None:
        result = redis_client.get(key)
        if result is None:
            return None
        return result.decode() if isinstance(result, bytes) else result

    def set(self, key: str, value: str, ttl: int) -> None:
        redis_client.setex(key, ttl, value)

    def delete(self, key: str) -> bool:
        return redis_client.delete(key) > 0

    def exists(self, key: str) -> bool:
        return redis_client.exists(key) > 0

    def refresh_ttl(self, key: str, ttl: int) -> bool:
        return bool(redis_client.expire(key, ttl))


class BaseSession(BaseModel):
    """Base session model."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str
    user_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    context: dict[str, Any] = Field(default_factory=dict)

    def update_timestamp(self) -> None:
        self.updated_at = datetime.now(UTC)


T = TypeVar("T", bound=BaseSession)


class SessionManager(Generic[T]):
    """Generic session manager."""

    DEFAULT_TTL = 7200  # 2 hours

    def __init__(
        self,
        key_prefix: str,
        session_class: type[T],
        storage: SessionStorage | None = None,
        ttl: int | None = None,
    ):
        self._key_prefix = key_prefix
        self._session_class = session_class
        self._storage = storage or RedisSessionStorage()
        self._ttl = ttl or self.DEFAULT_TTL

    def _get_key(self, session_id: str) -> str:
        return f"{self._key_prefix}:{session_id}"

    def save(self, session: T) -> None:
        session.update_timestamp()
        key = self._get_key(session.id)
        self._storage.set(key, session.model_dump_json(), self._ttl)

    def get(self, session_id: str) -> T | None:
        key = self._get_key(session_id)
        data = self._storage.get(key)
        if data is None:
            return None
        try:
            return self._session_class.model_validate(json.loads(data))
        except (json.JSONDecodeError, ValidationError) as e:
            logger.warning("Failed to deserialize session %s: %s", session_id, e)
            return None

    def delete(self, session_id: str) -> bool:
        return self._storage.delete(self._get_key(session_id))

    def exists(self, session_id: str) -> bool:
        return self._storage.exists(self._get_key(session_id))

    def refresh_ttl(self, session_id: str) -> bool:
        return self._storage.refresh_ttl(self._get_key(session_id), self._ttl)
