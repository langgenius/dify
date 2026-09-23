"""Manage workspace knowledge API keys and keys restricted to one knowledge base."""

from collections.abc import Callable
from typing import Protocol

from machinery.context import RequestContext
from services.auth.api_key_contracts import ApiKeyCache, ApiKeyRecord
from services.errors.account import NoPermissionError
from services.knowledge.dataset_access import DatasetAccess


class DatasetApiKeyStore(Protocol):
    def get_dataset_access(self, workspace_id: str, dataset_id: str, account_id: str) -> DatasetAccess: ...

    def list_keys(self, workspace_id: str, dataset_id: str) -> tuple[ApiKeyRecord, ...]: ...

    def create_key(self, workspace_id: str, dataset_id: str, *, max_keys: int, prefix: str) -> ApiKeyRecord: ...

    def delete_key(self, workspace_id: str, dataset_id: str, key_id: str) -> ApiKeyRecord: ...

    def list_workspace_keys(self, workspace_id: str) -> tuple[ApiKeyRecord, ...]: ...

    def create_workspace_key(
        self, workspace_id: str, dataset_ids: tuple[str, ...], *, max_keys: int, prefix: str
    ) -> ApiKeyRecord: ...

    def delete_workspace_key(self, workspace_id: str, key_id: str) -> ApiKeyRecord: ...


class UnknownDatasetIdsError(Exception):
    def __init__(self, dataset_ids: list[str]) -> None:
        super().__init__(f"Unknown knowledge base id(s): {', '.join(dataset_ids)}")


class DatasetApiKeyService:
    MAX_KEYS = 10

    def __init__(self, *, keys: DatasetApiKeyStore, cache: ApiKeyCache, rbac_enabled: Callable[[], bool]) -> None:
        self._keys = keys
        self._cache = cache
        self._rbac_enabled = rbac_enabled

    def list_keys(self, context: RequestContext, dataset_id: str) -> tuple[ApiKeyRecord, ...]:
        self._check_access(context, dataset_id)
        return self._keys.list_keys(context.active_workspace_id, dataset_id)

    def create_key(self, context: RequestContext, dataset_id: str) -> ApiKeyRecord:
        self._check_access(context, dataset_id)
        return self._keys.create_key(context.active_workspace_id, dataset_id, max_keys=self.MAX_KEYS, prefix="ds-")

    def delete_key(self, context: RequestContext, dataset_id: str, key_id: str) -> None:
        self._check_access(context, dataset_id)
        key = self._keys.delete_key(context.active_workspace_id, dataset_id, key_id)
        self._cache.delete(key.token, key.type)

    def _check_access(self, context: RequestContext, dataset_id: str) -> None:
        # Enterprise RBAC is enforced at admission; community deployments use the dataset ACL.
        if not self._rbac_enabled():
            access = self._keys.get_dataset_access(context.active_workspace_id, dataset_id, context.account_id)
            if not access.allows(context.account_id):
                raise NoPermissionError("You do not have permission to access this dataset.")

    def list_workspace_keys(self, context: RequestContext) -> tuple[ApiKeyRecord, ...]:
        return self._keys.list_workspace_keys(context.active_workspace_id)

    def create_workspace_key(self, context: RequestContext, dataset_ids: tuple[str, ...]) -> ApiKeyRecord:
        return self._keys.create_workspace_key(
            context.active_workspace_id, tuple(dict.fromkeys(dataset_ids)), max_keys=self.MAX_KEYS, prefix="dataset-"
        )

    def delete_workspace_key(self, context: RequestContext, key_id: str) -> None:
        key = self._keys.delete_workspace_key(context.active_workspace_id, key_id)
        self._cache.delete(key.token, key.type)
