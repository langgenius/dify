"""Short-lived Web login grants stored atomically in Redis."""

from pydantic import TypeAdapter, ValidationError
from redis import RedisError

from extensions.ext_redis import RedisClientWrapper
from services.web_login_handoff import HANDOFF_TTL_SECONDS, WebLoginGrantRecord, WebLoginUnavailableError

_grant_adapter: TypeAdapter[WebLoginGrantRecord] = TypeAdapter(WebLoginGrantRecord)


class RedisWebLoginGrantStore:
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis

    def put(self, key: str, grant: WebLoginGrantRecord) -> None:
        try:
            if not self._redis.set(self._key(key), grant.model_dump_json(), ex=HANDOFF_TTL_SECONDS, nx=True):
                raise WebLoginUnavailableError()
        except RedisError as exc:
            raise WebLoginUnavailableError() from exc

    def get(self, key: str) -> WebLoginGrantRecord | None:
        try:
            value = self._redis.get(self._key(key))
        except RedisError as exc:
            raise WebLoginUnavailableError() from exc
        return self._decode(value)

    def consume(self, key: str) -> WebLoginGrantRecord | None:
        try:
            value = self._redis.getdel(self._key(key))
        except RedisError as exc:
            raise WebLoginUnavailableError() from exc
        return self._decode(value)

    @staticmethod
    def _decode(value: str | bytes | None) -> WebLoginGrantRecord | None:
        if value is None:
            return None
        try:
            return _grant_adapter.validate_json(value)
        except ValidationError as exc:
            raise WebLoginUnavailableError() from exc

    @staticmethod
    def _key(key: str) -> str:
        return f"webapp:login-grant:{key}"
