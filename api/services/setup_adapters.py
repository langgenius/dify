"""Infrastructure adapters for the first-time setup application service."""

from contextlib import AbstractContextManager
from typing import override

from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from services.account_service import RegisterService
from services.setup_service import SetupAccountProvisioner, SetupInput, SetupLock

_SETUP_LOCK_KEY = "setup:initialize"
_SETUP_LOCK_TIMEOUT_SECONDS = 300


class RegisterServiceAccountProvisioner(SetupAccountProvisioner):
    def __init__(self, client: sessionmaker[Session]) -> None:
        self._client = client

    @override
    def provision(self, setup: SetupInput) -> None:
        with self._client() as session:
            RegisterService.setup(
                email=setup.email,
                name=setup.name,
                password=setup.password,
                ip_address=setup.ip_address,
                language=setup.language,
                session=session,
            )


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
