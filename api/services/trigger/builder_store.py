"""Persistence contract for temporary trigger subscription builders and logs."""

from contextlib import AbstractContextManager
from typing import Protocol

from services.trigger.builder_entities import RequestLog, SubscriptionBuilder


class TriggerSubscriptionBuilderStore(Protocol):
    """Persist temporary builders and validation logs without owning their policies."""

    def get(self, *, subscription_id: str) -> SubscriptionBuilder | None: ...

    def save(self, *, builder: SubscriptionBuilder) -> None: ...

    def delete(self, *, subscription_id: str) -> None: ...

    def lock(self, *, subscription_id: str) -> AbstractContextManager[None]: ...

    def list_logs(self, *, endpoint_id: str) -> list[RequestLog]: ...

    def append_log(self, *, log: RequestLog) -> None: ...
