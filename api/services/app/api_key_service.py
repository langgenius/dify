"""Manage App API access, including Agent routes backed by an App."""

from dataclasses import dataclass
from typing import Protocol

from machinery.context import RequestContext
from services.auth.api_key_contracts import ApiKeyCache, ApiKeyRecord


@dataclass(frozen=True, slots=True)
class AppApiKeyAccessState:
    is_agent_app: bool
    has_published_snapshot: bool


class AppApiKeyStore(Protocol):
    def resolve_agent_app_id(self, workspace_id: str, agent_id: str) -> str: ...

    def get_access_state(self, workspace_id: str, app_id: str) -> AppApiKeyAccessState: ...

    def list_keys(self, workspace_id: str, app_id: str) -> tuple[ApiKeyRecord, ...]: ...

    def create_key(self, workspace_id: str, app_id: str, *, max_keys: int, prefix: str) -> ApiKeyRecord: ...

    def delete_key(self, workspace_id: str, app_id: str, key_id: str) -> ApiKeyRecord: ...


class AppApiKeyNotReadyError(Exception):
    pass


class AppApiKeyService:
    def __init__(self, *, keys: AppApiKeyStore, cache: ApiKeyCache) -> None:
        self._keys = keys
        self._cache = cache

    def list_keys(self, context: RequestContext, app_id: str) -> tuple[ApiKeyRecord, ...]:
        return self._keys.list_keys(context.active_workspace_id, app_id)

    def create_key(self, context: RequestContext, app_id: str) -> ApiKeyRecord:
        access = self._keys.get_access_state(context.active_workspace_id, app_id)
        if access.is_agent_app and not access.has_published_snapshot:
            raise AppApiKeyNotReadyError
        return self._keys.create_key(context.active_workspace_id, app_id, max_keys=10, prefix="app-")

    def delete_key(self, context: RequestContext, app_id: str, key_id: str) -> None:
        key = self._keys.delete_key(context.active_workspace_id, app_id, key_id)
        # External cache I/O follows the repository's committed transaction.
        self._cache.delete(key.token, key.type)

    def list_agent_keys(self, context: RequestContext, agent_id: str) -> tuple[ApiKeyRecord, ...]:
        app_id = self._keys.resolve_agent_app_id(context.active_workspace_id, agent_id)
        return self.list_keys(context, app_id)

    def create_agent_key(self, context: RequestContext, agent_id: str) -> ApiKeyRecord:
        app_id = self._keys.resolve_agent_app_id(context.active_workspace_id, agent_id)
        return self.create_key(context, app_id)

    def delete_agent_key(self, context: RequestContext, agent_id: str, key_id: str) -> None:
        app_id = self._keys.resolve_agent_app_id(context.active_workspace_id, agent_id)
        self.delete_key(context, app_id, key_id)
