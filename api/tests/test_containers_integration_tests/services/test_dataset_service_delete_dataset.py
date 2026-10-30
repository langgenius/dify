"""Container-backed integration tests for the dataset deletion repository boundary."""

from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Barrier, Event
from uuid import uuid4

import psycopg2
import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.dataset import Dataset, Document
from models.enums import ApiTokenType, DataSourceType, DocumentCreatedFrom
from models.model import ApiToken, DatasetApiTokenBinding
from repositories.knowledge import dataset_api_key_bindings
from repositories.knowledge.dataset_api_key_bindings import DeletedDatasetApiKey
from repositories.knowledge.dataset_api_key_repository import DatasetApiKeyRepository
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from services.auth.api_key_contracts import ApiKeyRecord, ApiKeyResourceNotFoundError
from services.knowledge.api_key_service import UnknownDatasetIdsError
from services.knowledge.entities.datasets import DatasetCleanupRecord
from services.knowledge.entities.resource_scope import DatasetRef


class DatasetDeleteIntegrationDataFactory:
    """Create persisted entities used by delete_dataset integration tests."""

    @staticmethod
    def create_account_with_tenant(db_session_with_containers: Session) -> tuple[Account, Tenant]:
        """Persist an owner account, tenant, and tenant join for dataset deletion tests."""
        account = Account(
            email=f"owner-{uuid4()}@example.com",
            name="Owner",
            interface_language="en-US",
            status=AccountStatus.ACTIVE,
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        tenant = Tenant(
            name=f"tenant-{uuid4()}",
            status=TenantStatus.NORMAL,
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        account.set_current_tenant_with_session(tenant, session=db_session_with_containers)
        return account, tenant

    @staticmethod
    def create_dataset(
        db_session_with_containers: Session,
        tenant_id: str,
        created_by: str,
        *,
        indexing_technique: str | None,
        chunk_structure: str | None,
        index_struct: str | None = '{"type": "paragraph"}',
        collection_binding_id: str | None = None,
        pipeline_id: str | None = None,
    ) -> Dataset:
        """Persist a dataset with delete_dataset-relevant fields configured."""
        dataset = Dataset(
            tenant_id=tenant_id,
            name=f"dataset-{uuid4()}",
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique=indexing_technique,
            index_struct=index_struct,
            created_by=created_by,
            collection_binding_id=collection_binding_id,
            pipeline_id=pipeline_id,
            chunk_structure=chunk_structure,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        return dataset

    @staticmethod
    def create_document(
        db_session_with_containers: Session,
        *,
        tenant_id: str,
        dataset_id: str,
        created_by: str,
        doc_form: str = IndexStructureType.PARAGRAPH_INDEX,
    ) -> Document:
        """Persist a document so dataset.get_doc_form resolves through the real document path."""
        document = Document(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch=f"batch-{uuid4()}",
            name="Document",
            created_from=DocumentCreatedFrom.WEB,
            created_by=created_by,
            doc_form=doc_form,
        )
        db_session_with_containers.add(document)
        db_session_with_containers.commit()
        return document


def _dataset_repository(session: Session) -> SQLAlchemyDatasetRepository:
    sessions = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    return SQLAlchemyDatasetRepository(
        session_factory=sessions,
        revoke_keys_after_commit=lambda _session, _tokens: None,
    )


class TestDatasetRepositoryDeleteDataset:
    """Integration coverage for the current tenant-scoped delete transaction."""

    def test_delete_dataset_with_documents_success(self, db_session_with_containers: Session) -> None:
        """Delete a dataset and return its committed cleanup snapshot."""
        # Arrange
        owner, tenant = DatasetDeleteIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetDeleteIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            chunk_structure=None,
            index_struct='{"type": "paragraph"}',
            collection_binding_id=str(uuid4()),
            pipeline_id=str(uuid4()),
        )
        DatasetDeleteIntegrationDataFactory.create_document(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            created_by=owner.id,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )

        # Act
        result = _dataset_repository(db_session_with_containers).delete_with_relations(
            DatasetRef(tenant.id, dataset.id)
        )

        # Assert
        db_session_with_containers.expire_all()
        assert result is not None
        assert result.id == dataset.id
        assert result.workspace_id == tenant.id
        assert result.doc_form == IndexStructureType.PARAGRAPH_INDEX
        assert result.indexing_technique == IndexTechniqueType.HIGH_QUALITY
        assert db_session_with_containers.get(Dataset, dataset.id) is None

    def test_delete_empty_dataset_success(self, db_session_with_containers: Session) -> None:
        """Return cleanup even for an empty dataset without indexing configuration."""
        # Arrange
        owner, tenant = DatasetDeleteIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetDeleteIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            indexing_technique=None,
            chunk_structure=None,
            index_struct=None,
            collection_binding_id=None,
            pipeline_id=None,
        )

        # Act
        result = _dataset_repository(db_session_with_containers).delete_with_relations(
            DatasetRef(tenant.id, dataset.id)
        )

        # Assert
        db_session_with_containers.expire_all()
        assert result is not None
        assert result.id == dataset.id
        assert result.doc_form is None
        assert result.indexing_technique is None
        assert db_session_with_containers.get(Dataset, dataset.id) is None

    def test_delete_dataset_with_partial_none_values(self, db_session_with_containers: Session) -> None:
        """Return a complete cleanup snapshot when indexing technique is absent."""
        # Arrange
        owner, tenant = DatasetDeleteIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetDeleteIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            indexing_technique=None,
            chunk_structure="text_model",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=str(uuid4()),
            pipeline_id=str(uuid4()),
        )

        # Act
        result = _dataset_repository(db_session_with_containers).delete_with_relations(
            DatasetRef(tenant.id, dataset.id)
        )

        # Assert
        db_session_with_containers.expire_all()
        assert result is not None
        assert result.id == dataset.id
        assert result.doc_form == "text_model"
        assert result.indexing_technique is None
        assert db_session_with_containers.get(Dataset, dataset.id) is None

    def test_delete_dataset_with_doc_form_none_indexing_technique_exists(
        self, db_session_with_containers: Session
    ) -> None:
        """Return cleanup when indexing exists but no document form can be resolved."""
        # Arrange
        owner, tenant = DatasetDeleteIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetDeleteIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            chunk_structure=None,
            index_struct='{"type": "paragraph"}',
            collection_binding_id=str(uuid4()),
            pipeline_id=str(uuid4()),
        )

        # Act
        result = _dataset_repository(db_session_with_containers).delete_with_relations(
            DatasetRef(tenant.id, dataset.id)
        )

        # Assert
        db_session_with_containers.expire_all()
        assert result is not None
        assert result.id == dataset.id
        assert result.doc_form is None
        assert result.indexing_technique == IndexTechniqueType.HIGH_QUALITY
        assert db_session_with_containers.get(Dataset, dataset.id) is None

    def test_delete_dataset_not_found(self, db_session_with_containers: Session) -> None:
        """Return False without scheduling cleanup when the target dataset does not exist."""
        # Arrange
        _owner, tenant = DatasetDeleteIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        missing_dataset_id = str(uuid4())

        # Act
        result = _dataset_repository(db_session_with_containers).delete_with_relations(
            DatasetRef(tenant.id, missing_dataset_id)
        )

        # Assert
        assert result is None

    @pytest.mark.parametrize("workspace_creation", [False, True])
    def test_delete_serializes_with_dataset_key_creation(
        self,
        db_session_with_containers: Session,
        monkeypatch: pytest.MonkeyPatch,
        workspace_creation: bool,
    ) -> None:
        owner, tenant = DatasetDeleteIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetDeleteIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            indexing_technique=None,
            chunk_structure=None,
            index_struct=None,
        )
        tenant_id = tenant.id
        dataset_id = dataset.id
        database_client = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
        api_key_repository = DatasetApiKeyRepository(session_factory=database_client)
        dataset_repository = SQLAlchemyDatasetRepository(
            session_factory=database_client,
            revoke_keys_after_commit=lambda _session, _tokens: None,
        )
        cleanup_entered = Event()
        release_cleanup = Event()
        original_delete_keys = dataset_api_key_bindings.delete_keys_scoped_only_to

        def pause_key_cleanup(
            session: Session,
            dataset_id: str,
            *,
            tenant_id: str | None = None,
        ) -> list[DeletedDatasetApiKey]:
            cleanup_entered.set()
            assert release_cleanup.wait(timeout=10), "Timed out waiting to release dataset deletion"
            return original_delete_keys(session, dataset_id, tenant_id=tenant_id)

        def delete_dataset() -> DatasetCleanupRecord | None:
            return dataset_repository.delete_with_relations(DatasetRef(tenant_id, dataset_id))

        def create_key() -> ApiKeyRecord:
            if workspace_creation:
                return api_key_repository.create_workspace_key(tenant_id, (dataset_id,), max_keys=10, prefix="dataset-")
            return api_key_repository.create_key(tenant_id, dataset_id, max_keys=10, prefix="ds-")

        monkeypatch.setattr(dataset_api_key_bindings, "delete_keys_scoped_only_to", pause_key_cleanup)

        with ThreadPoolExecutor(max_workers=2) as pool:
            deletion = pool.submit(delete_dataset)
            assert cleanup_entered.wait(timeout=5)
            creation = pool.submit(create_key)
            try:
                with pytest.raises(TimeoutError):
                    creation.result(timeout=0.5)
            finally:
                release_cleanup.set()
            assert deletion.result(timeout=5)
            expected_error = UnknownDatasetIdsError if workspace_creation else ApiKeyResourceNotFoundError
            with pytest.raises(expected_error):
                creation.result(timeout=5)

        assert db_session_with_containers.scalar(select(ApiToken).where(ApiToken.tenant_id == tenant_id)) is None

    def test_repeatable_read_deletions_do_not_leave_a_multi_dataset_key_unrestricted(
        self,
        db_session_with_containers: Session,
    ) -> None:
        owner, tenant = DatasetDeleteIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        first_dataset = DatasetDeleteIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            indexing_technique=None,
            chunk_structure=None,
        )
        last_dataset = DatasetDeleteIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            indexing_technique=None,
            chunk_structure=None,
        )
        key = ApiToken(tenant_id=tenant.id, type=ApiTokenType.DATASET, token=f"dataset-{uuid4()}")
        db_session_with_containers.add(key)
        db_session_with_containers.flush()
        db_session_with_containers.add_all(
            [
                DatasetApiTokenBinding(api_token_id=key.id, dataset_id=first_dataset.id),
                DatasetApiTokenBinding(api_token_id=key.id, dataset_id=last_dataset.id),
            ]
        )
        db_session_with_containers.commit()
        tenant_id = tenant.id
        key_id = key.id
        first_dataset_id = first_dataset.id
        last_dataset_id = last_dataset.id

        repeatable_read_engine = db_session_with_containers.get_bind().execution_options(
            isolation_level="REPEATABLE READ"
        )
        repeatable_read_sessions = sessionmaker(bind=repeatable_read_engine, expire_on_commit=False)
        snapshots_ready = Barrier(2)
        first_has_workspace_lock = Event()
        second_is_waiting_for_workspace_lock = Event()
        release_first_deletion = Event()

        def establish_binding_snapshot(session: Session) -> None:
            session.scalars(select(DatasetApiTokenBinding.id)).all()
            snapshots_ready.wait(timeout=5)

        def delete_first_scope() -> list[DeletedDatasetApiKey]:
            with repeatable_read_sessions() as session:
                establish_binding_snapshot(session)
                assert dataset_api_key_bindings.lock_workspace(session, tenant_id)
                first_has_workspace_lock.set()
                assert release_first_deletion.wait(timeout=10)
                deleted_keys = dataset_api_key_bindings.delete_keys_scoped_only_to(session, first_dataset_id)
                session.execute(delete(Dataset).where(Dataset.id == first_dataset_id))
                session.commit()
                return deleted_keys

        def delete_last_scope_once() -> list[DeletedDatasetApiKey]:
            with repeatable_read_sessions() as session:
                establish_binding_snapshot(session)
                assert first_has_workspace_lock.wait(timeout=5)
                second_is_waiting_for_workspace_lock.set()
                assert dataset_api_key_bindings.lock_workspace(session, tenant_id)
                deleted_keys = dataset_api_key_bindings.delete_keys_scoped_only_to(session, last_dataset_id)
                session.execute(delete(Dataset).where(Dataset.id == last_dataset_id))
                session.commit()
                return deleted_keys

        def delete_last_scope() -> list[DeletedDatasetApiKey]:
            try:
                return delete_last_scope_once()
            except OperationalError as error:
                # PostgreSQL's REPEATABLE READ rejects a locking read of a row
                # deleted after the snapshot. Retrying from a fresh snapshot is
                # safe; MySQL's locking current read completes on the first try.
                if not isinstance(error.orig, psycopg2.Error) or error.orig.pgcode != "40001":
                    raise
                with repeatable_read_sessions.begin() as session:
                    assert dataset_api_key_bindings.lock_workspace(session, tenant_id)
                    deleted_keys = dataset_api_key_bindings.delete_keys_scoped_only_to(session, last_dataset_id)
                    session.execute(delete(Dataset).where(Dataset.id == last_dataset_id))
                    return deleted_keys

        with ThreadPoolExecutor(max_workers=2) as pool:
            first_deletion = pool.submit(delete_first_scope)
            last_deletion = pool.submit(delete_last_scope)
            assert first_has_workspace_lock.wait(timeout=5)
            assert second_is_waiting_for_workspace_lock.wait(timeout=5)
            try:
                with pytest.raises(TimeoutError):
                    last_deletion.result(timeout=0.5)
            finally:
                release_first_deletion.set()
            assert first_deletion.result(timeout=5) == []
            deleted_keys = last_deletion.result(timeout=5)

        assert [deleted.id for deleted in deleted_keys] == [key_id]
        db_session_with_containers.expire_all()
        assert db_session_with_containers.get(ApiToken, key_id) is None
