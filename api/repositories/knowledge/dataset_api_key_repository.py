"""Knowledge base API keys with repository-owned sessions and transactions."""

from typing import override

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, sessionmaker

from models.dataset import Dataset
from models.enums import ApiTokenType
from models.model import ApiToken
from repositories.knowledge import dataset_api_key_bindings
from services.auth.api_key_contracts import (
    ApiKeyLimitExceededError,
    ApiKeyNotFoundError,
    ApiKeyRecord,
    ApiKeyResourceNotFoundError,
)
from services.knowledge.admission.application import DatasetApiKeyScope
from services.knowledge.api_key_service import DatasetApiKeyStore, UnknownDatasetIdsError, UnknownKnowledgeSpaceIdsError


class DatasetApiKeyRepository(DatasetApiKeyStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get_active_scope(self, workspace_id: str, api_key_id: str) -> DatasetApiKeyScope | None:
        """Read key existence and bindings together; revoked keys never become unrestricted."""
        with self._session_factory() as session:
            scope = dataset_api_key_bindings.get_active_key_scope(
                session,
                api_token_id=api_key_id,
                tenant_id=workspace_id,
            )
            if scope is None:
                return None
            return DatasetApiKeyScope(dataset_ids=scope.dataset_ids, restricted=scope.restricted)

    @override
    def list_keys(self, workspace_id: str, dataset_id: str) -> tuple[ApiKeyRecord, ...]:
        with self._session_factory() as session:
            self._get_dataset(session, workspace_id, dataset_id, current_read=False)
            return tuple(
                self._record(key, (dataset_id,)) for key in session.scalars(self._key_query(workspace_id, dataset_id))
            )

    @override
    def create_key(self, workspace_id: str, dataset_id: str, *, max_keys: int, prefix: str) -> ApiKeyRecord:
        with self._session_factory.begin() as session:
            self._lock_workspace(session, workspace_id)
            self._get_dataset(session, workspace_id, dataset_id, current_read=True)
            return self._create_key(session, workspace_id, (dataset_id,), max_keys=max_keys, prefix=prefix)

    @override
    def list_workspace_keys(self, workspace_id: str) -> tuple[ApiKeyRecord, ...]:
        with self._session_factory() as session:
            keys = session.scalars(self._workspace_key_query(workspace_id)).all()
            bindings = dataset_api_key_bindings.list_bindings_by_token(session, (key.id for key in keys))
            return tuple(
                self._record(key, tuple(scope.dataset_ids), tuple(scope.knowledge_space_ids))
                for key in keys
                for scope in (bindings.get(key.id, dataset_api_key_bindings.ApiKeyBindings()),)
            )

    @override
    def create_workspace_key(
        self,
        workspace_id: str,
        dataset_ids: tuple[str, ...],
        *,
        knowledge_space_ids: tuple[str, ...] = (),
        max_keys: int,
        prefix: str,
    ) -> ApiKeyRecord:
        with self._session_factory.begin() as session:
            self._lock_workspace(session, workspace_id)
            unknown = dataset_api_key_bindings.find_unknown_dataset_ids(session, list(dataset_ids), workspace_id)
            if unknown:
                raise UnknownDatasetIdsError(unknown)
            unknown_spaces = dataset_api_key_bindings.find_unknown_knowledge_space_ids(
                session, list(knowledge_space_ids), workspace_id
            )
            if unknown_spaces:
                raise UnknownKnowledgeSpaceIdsError(unknown_spaces)
            return self._create_key(
                session,
                workspace_id,
                dataset_ids,
                knowledge_space_ids=knowledge_space_ids,
                max_keys=max_keys,
                prefix=prefix,
            )

    @override
    def delete_workspace_key(self, workspace_id: str, key_id: str) -> ApiKeyRecord:
        with self._session_factory.begin() as session:
            self._lock_workspace(session, workspace_id)
            key = session.scalar(self._workspace_key_query(workspace_id).where(ApiToken.id == key_id))
            if key is None:
                raise ApiKeyNotFoundError
            bindings = dataset_api_key_bindings.get_bound_dataset_ids(session, key.id)
            record = self._record(key, tuple(sorted(bindings)))
            session.delete(key)
            return record

    def _create_key(
        self,
        session: Session,
        workspace_id: str,
        dataset_ids: tuple[str, ...],
        *,
        knowledge_space_ids: tuple[str, ...] = (),
        max_keys: int,
        prefix: str,
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
        dataset_api_key_bindings.bind_knowledge_spaces(session, key.id, knowledge_space_ids)
        return self._record(key, dataset_ids, knowledge_space_ids)

    @staticmethod
    def _lock_workspace(session: Session, workspace_id: str) -> None:
        # Serialize key mutation with dataset cleanup and workspace quota checks.
        if not dataset_api_key_bindings.lock_workspace(session, workspace_id):
            raise ApiKeyResourceNotFoundError("Workspace not found.")

    @override
    def delete_key(self, workspace_id: str, dataset_id: str, key_id: str) -> ApiKeyRecord:
        with self._session_factory.begin() as session:
            self._lock_workspace(session, workspace_id)
            self._get_dataset(session, workspace_id, dataset_id, current_read=True)
            key = session.scalar(self._key_query(workspace_id, dataset_id).where(ApiToken.id == key_id))
            if key is None:
                raise ApiKeyNotFoundError
            record = self._record(key, (dataset_id,))
            session.delete(key)
            return record

    @staticmethod
    def _get_dataset(session: Session, workspace_id: str, dataset_id: str, *, current_read: bool) -> Dataset:
        query = select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == workspace_id)
        if current_read:
            # Key mutation holds the tenant lock first. A locking read then sees
            # a dataset deletion that committed while the creator was waiting,
            # including under MySQL's REPEATABLE READ isolation.
            query = query.with_for_update(read=True)
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
    def _record(key: ApiToken, dataset_ids: tuple[str, ...], knowledge_space_ids: tuple[str, ...] = ()) -> ApiKeyRecord:
        return ApiKeyRecord(
            id=key.id,
            type=key.type,
            token=key.token,
            last_used_at=key.last_used_at,
            created_at=key.created_at,
            dataset_ids=dataset_ids,
            knowledge_space_ids=knowledge_space_ids,
        )
