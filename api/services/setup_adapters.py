"""Infrastructure adapters for the first-time setup application service."""

from contextlib import AbstractContextManager
from typing import override

from extensions.ext_redis import RedisClientWrapper
from services.setup_service import SetupLock

_SETUP_LOCK_KEY = "setup:initialize"
_SETUP_LOCK_TIMEOUT_SECONDS = 300


class RedisSetupLock(SetupLock):
    def __init__(self, *, client: RedisClientWrapper) -> None:
        self._client = client

    @override
    def acquire(self) -> AbstractContextManager[None]:
        return self._client.lock(
            _SETUP_LOCK_KEY,
            timeout=_SETUP_LOCK_TIMEOUT_SECONDS,
            blocking_timeout=_SETUP_LOCK_TIMEOUT_SECONDS,
        )
