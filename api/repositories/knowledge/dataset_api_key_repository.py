"""Knowledge base API keys with repository-owned sessions and transactions."""

from typing import override

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant, TenantAccountJoin
from models.dataset import Dataset, DatasetPermission
from models.enums import ApiTokenType
from models.model import ApiToken
from repositories.knowledge import dataset_api_key_bindings
from services.auth.api_key_contracts import (
    ApiKeyLimitExceededError,
    ApiKeyNotFoundError,
    ApiKeyRecord,
    ApiKeyResourceNotFoundError,
)
from services.knowledge.api_key_service import DatasetApiKeyStore, UnknownDatasetIdsError
from services.knowledge.dataset_access import DatasetAccess


class DatasetApiKeyRepository(DatasetApiKeyStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_dataset_access(self, workspace_id: str, dataset_id: str, account_id: str) -> DatasetAccess:
        with self._session_factory() as session:
            dataset = self._get_dataset(session, workspace_id, dataset_id)
            role = session.scalar(
                select(TenantAccountJoin.role).where(
                    TenantAccountJoin.tenant_id == workspace_id, TenantAccountJoin.account_id == account_id
                )
            )
            has_permission = (
                session.scalar(
                    select(DatasetPermission.id)
                    .where(
                        DatasetPermission.tenant_id == workspace_id,
                        DatasetPermission.dataset_id == dataset_id,
                        DatasetPermission.account_id == account_id,
                        DatasetPermission.has_permission.is_(True),
                    )
                    .limit(1)
                )
                is not None
            )
            return DatasetAccess(dataset.permission, dataset.maintainer, role, has_permission)

    @override
    def list_keys(self, workspace_id: str, dataset_id: str) -> tuple[ApiKeyRecord, ...]:
        with self._session_factory() as session:
            self._get_dataset(session, workspace_id, dataset_id)
            return tuple(
                self._record(key, (dataset_id,)) for key in session.scalars(self._key_query(workspace_id, dataset_id))
            )

    @override
    def create_key(self, workspace_id: str, dataset_id: str, *, max_keys: int, prefix: str) -> ApiKeyRecord:
        with self._session_factory.begin() as session:
            self._lock_workspace(session, workspace_id)
            self._get_dataset(session, workspace_id, dataset_id)
            return self._create_key(session, workspace_id, (dataset_id,), max_keys=max_keys, prefix=prefix)

    @override
    def list_workspace_keys(self, workspace_id: str) -> tuple[ApiKeyRecord, ...]:
        with self._session_factory() as session:
            keys = session.scalars(self._workspace_key_query(workspace_id)).all()
            bindings = dataset_api_key_bindings.list_bindings_by_token(session, (key.id for key in keys))
            return tuple(self._record(key, tuple(bindings.get(key.id, ()))) for key in keys)

    @override
    def create_workspace_key(
        self, workspace_id: str, dataset_ids: tuple[str, ...], *, max_keys: int, prefix: str
    ) -> ApiKeyRecord:
        with self._session_factory.begin() as session:
            self._lock_workspace(session, workspace_id)
            unknown = dataset_api_key_bindings.find_unknown_dataset_ids(session, list(dataset_ids), workspace_id)
            if unknown:
                raise UnknownDatasetIdsError(unknown)
            return self._create_key(session, workspace_id, dataset_ids, max_keys=max_keys, prefix=prefix)

    @override
    def delete_workspace_key(self, workspace_id: str, key_id: str) -> ApiKeyRecord:
        with self._session_factory.begin() as session:
            key = session.scalar(self._workspace_key_query(workspace_id).where(ApiToken.id == key_id))
            if key is None:
                raise ApiKeyNotFoundError
            bindings = dataset_api_key_bindings.get_bound_dataset_ids(session, key.id)
            record = self._record(key, tuple(sorted(bindings)))
            session.delete(key)
            return record

    def _create_key(
        self, session: Session, workspace_id: str, dataset_ids: tuple[str, ...], *, max_keys: int, prefix: str
    ) -> ApiKeyRecord:
        count = session.scalar(select(func.count()).select_from(self._workspace_key_query(workspace_id).subquery()))
        if count is not None and count >= max_keys:
            raise ApiKeyLimitExceededError(max_keys)
        key = ApiToken(
            tenant_id=workspace_id,
            type=ApiTokenType.DATASET,
            token=ApiToken.generate_api_key(prefix, 24, session=session),
        )
        session.add(key)
        session.flush()
        dataset_api_key_bindings.bind_datasets(session, key.id, dataset_ids)
        return self._record(key, dataset_ids)

    @staticmethod
    def _lock_workspace(session: Session, workspace_id: str) -> None:
        # Both creation routes lock the same row before counting all workspace dataset keys.
        if session.scalar(select(Tenant.id).where(Tenant.id == workspace_id).with_for_update()) is None:
            raise ApiKeyResourceNotFoundError("Workspace not found.")

    @override
    def delete_key(self, workspace_id: str, dataset_id: str, key_id: str) -> ApiKeyRecord:
        with self._session_factory.begin() as session:
            self._get_dataset(session, workspace_id, dataset_id)
            key = session.scalar(self._key_query(workspace_id, dataset_id).where(ApiToken.id == key_id))
            if key is None:
                raise ApiKeyNotFoundError
            record = self._record(key, (dataset_id,))
            session.delete(key)
            return record

    @staticmethod
    def _get_dataset(session: Session, workspace_id: str, dataset_id: str) -> Dataset:
        query = select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == workspace_id)
        dataset = session.scalar(query)
        if dataset is None:
            raise ApiKeyResourceNotFoundError("Dataset not found.")
        return dataset

    @staticmethod
    def _workspace_key_query(workspace_id: str) -> Select[tuple[ApiToken]]:
        return select(ApiToken).where(ApiToken.tenant_id == workspace_id, ApiToken.type == ApiTokenType.DATASET)

    @classmethod
    def _key_query(cls, workspace_id: str, dataset_id: str) -> Select[tuple[ApiToken]]:
        # A per-dataset permission cannot expose or revoke broader workspace keys.
        return cls._workspace_key_query(workspace_id).where(
            ApiToken.id.in_(dataset_api_key_bindings.token_ids_scoped_only_to(dataset_id)),
        )

    @staticmethod
    def _record(key: ApiToken, dataset_ids: tuple[str, ...]) -> ApiKeyRecord:
        return ApiKeyRecord(
            id=key.id,
            type=key.type,
            token=key.token,
            last_used_at=key.last_used_at,
            created_at=key.created_at,
            dataset_ids=dataset_ids,
        )
