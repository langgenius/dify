"""Redis persistence for temporary trigger subscription builders and validation logs."""

from collections.abc import Generator
from contextlib import contextmanager
from typing import override

from pydantic import TypeAdapter

from core.trigger.entities.entities import RequestLog, SubscriptionBuilder
from extensions.ext_redis import RedisClientWrapper
from services.trigger.trigger_subscription_builder_service import TriggerSubscriptionBuilderStore

_request_logs_adapter = TypeAdapter(list[RequestLog])
_BUILDER_TTL_SECONDS = 30 * 60
_LOG_TTL_SECONDS = 30 * 60
_LOCK_TTL_SECONDS = 30
_LOG_COUNT = 10


class RedisTriggerSubscriptionBuilderRepository(TriggerSubscriptionBuilderStore):
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis

    @staticmethod
    def encode_cache_key(subscription_id: str) -> str:
        return f"trigger:subscription:builder:{subscription_id}"

    @staticmethod
    def encode_lock_key(subscription_id: str) -> str:
        return f"trigger:subscription:builder:lock:{subscription_id}"

    @override
    def get(self, *, subscription_id: str) -> SubscriptionBuilder | None:
        value = self._redis.get(self.encode_cache_key(subscription_id))
        return SubscriptionBuilder.model_validate_json(value) if value else None

    @override
    def save(self, *, builder: SubscriptionBuilder) -> None:
        self._redis.setex(self.encode_cache_key(builder.id), _BUILDER_TTL_SECONDS, builder.model_dump_json())

    @override
    def delete(self, *, subscription_id: str) -> None:
        self._redis.delete(self.encode_cache_key(subscription_id))

    @override
    @contextmanager
    def lock(self, *, subscription_id: str) -> Generator[None]:
        with self._redis.lock(self.encode_lock_key(subscription_id), timeout=_LOCK_TTL_SECONDS):
            yield

    @override
    def list_logs(self, *, endpoint_id: str) -> list[RequestLog]:
        value = self._redis.get(f"trigger:subscription:builder:logs:{endpoint_id}")
        return _request_logs_adapter.validate_json(value) if value else []

    @override
    def append_log(self, *, log: RequestLog) -> None:
        logs = self.list_logs(endpoint_id=log.endpoint)
        logs.append(log)
        self._redis.setex(
            f"trigger:subscription:builder:logs:{log.endpoint}",
            _LOG_TTL_SECONDS,
            _request_logs_adapter.dump_json(logs[-_LOG_COUNT:]),
        )
