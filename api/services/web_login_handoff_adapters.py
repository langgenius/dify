"""Short-lived Web login grants stored atomically in Redis."""

from pydantic import ValidationError
from redis import RedisError

from extensions.ext_redis import RedisClientWrapper
from services.web_login_handoff import HANDOFF_TTL_SECONDS, WebLoginGrant, WebLoginUnavailableError


class RedisWebLoginGrantStore:
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis

    def put(self, key: str, grant: WebLoginGrant) -> None:
        try:
            if not self._redis.set(self._key(key), grant.model_dump_json(), ex=HANDOFF_TTL_SECONDS, nx=True):
                raise WebLoginUnavailableError()
        except RedisError as exc:
            raise WebLoginUnavailableError() from exc

    def get(self, key: str) -> WebLoginGrant | None:
        try:
            value = self._redis.get(self._key(key))
        except RedisError as exc:
            raise WebLoginUnavailableError() from exc
        return self._decode(value)

    def consume(self, key: str) -> WebLoginGrant | None:
        try:
            value = self._redis.getdel(self._key(key))
        except RedisError as exc:
            raise WebLoginUnavailableError() from exc
        return self._decode(value)

    @staticmethod
    def _decode(value: str | bytes | None) -> WebLoginGrant | None:
        if value is None:
            return None
        try:
            return WebLoginGrant.model_validate_json(value)
        except ValidationError as exc:
            raise WebLoginUnavailableError() from exc

    @staticmethod
    def _key(key: str) -> str:
        return f"webapp:login-grant:{key}"
