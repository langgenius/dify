"""Let the draft-synced webhook listener run against SQLite, with nothing cached."""

import pytest
from sqlalchemy import Engine

from extensions.ext_database import db
from services.trigger import webhook_service


class _UncachedRedis:
    """The cache and lock calls `WebhookService.sync_webhook_relationships` makes."""

    class _Lock:
        def acquire(self, **_kwargs: object) -> bool:
            return True

        def release(self) -> None:
            return None

    def get(self, _key: str) -> None:
        return None

    def set(self, *_args: object, **_kwargs: object) -> None:
        return None

    def delete(self, *_args: object) -> None:
        return None

    def lock(self, *_args: object, **_kwargs: object) -> "_UncachedRedis._Lock":
        return self._Lock()


def route_webhook_sync(monkeypatch: pytest.MonkeyPatch, engine: Engine) -> None:
    """Point the webhook listener's database at `engine` and its cache at an empty one."""
    monkeypatch.setattr(type(db), "engine", property(lambda _: engine))
    monkeypatch.setattr(webhook_service, "redis_client", _UncachedRedis())
