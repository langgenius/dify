"""Concrete credential ports for unit tests, including actual thread exclusion."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from threading import Condition, Lock
from typing import TYPE_CHECKING, Literal

from services.credentials.refresh import CredentialRefreshLease, CredentialRefreshUnavailableError
from services.data_source.credential_gateway import DatasourceProviderCredentialStore

if TYPE_CHECKING:
    from services.data_source.provider_service import DatasourceProviderService


class ThreadCredentialRefreshLock:
    def __init__(self, *, wait_seconds: float = 2) -> None:
        self.wait_seconds = wait_seconds
        self.keys: list[tuple[str, str, str]] = []
        self.lost = False
        self.unavailable = False
        self._condition = Condition()
        self._locks: dict[tuple[str, str, str], Lock] = {}

    @contextmanager
    def acquire(
        self, *, credential_type: Literal["tool", "datasource"], workspace_id: str, credential_id: str
    ) -> Generator[CredentialRefreshLease]:
        key = (credential_type, workspace_id, credential_id)
        with self._condition:
            self.keys.append(key)
            lock = self._locks.setdefault(key, Lock())
            self._condition.notify_all()
        if self.unavailable or not lock.acquire(timeout=self.wait_seconds):
            raise CredentialRefreshUnavailableError()
        try:
            yield self
        finally:
            lock.release()

    def ensure_owned(self) -> None:
        if self.lost:
            raise CredentialRefreshUnavailableError()

    def wait_for_callers(self, count: int) -> None:
        """Keep the provider request open until competing callers have attempted the lock."""
        with self._condition:
            assert self._condition.wait_for(lambda: len(self.keys) >= count, timeout=self.wait_seconds)


def build_datasource_provider_service(*, credentials: DatasourceProviderCredentialStore) -> DatasourceProviderService:
    from core.plugin.impl.datasource import PluginDatasourceManager
    from core.plugin.impl.oauth import OAuthHandler
    from services.data_source.credential_adapters import (
        OAuthDatasourceCredentialRefresher,
        PluginDatasourceCredentialCodec,
        PluginDatasourceOAuthClientResolver,
    )
    from services.data_source.provider_service import DatasourceProviderService

    manager = PluginDatasourceManager()
    return DatasourceProviderService(
        credentials=credentials,
        codec=PluginDatasourceCredentialCodec(provider_manager=manager),
        refresher=OAuthDatasourceCredentialRefresher(
            oauth_clients=PluginDatasourceOAuthClientResolver(configs=credentials, provider_manager=manager),
            oauth_handler=OAuthHandler(),
        ),
        refresh_lock=ThreadCredentialRefreshLock(),
        provider_manager=manager,
    )
