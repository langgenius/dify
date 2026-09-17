from unittest.mock import create_autospec

import pytest
from faker import Faker
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.built_in_field import BuiltInField
from core.rag.index_processor.constant.index_type import IndexStructureType
from models import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.dataset import Dataset, DatasetMetadata, DatasetMetadataBinding, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from repositories.knowledge.metadata_repository import SQLAlchemyMetadataRepository
from services.errors.metadata import MetadataResourceNotFoundError
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.entities.knowledge_entities import (
    DocumentMetadataOperation,
    MetadataArgs,
    MetadataDetail,
    MetadataOperationData,
)
from services.knowledge.metadata.application import MetadataService
from services.knowledge.resource_scope import DatasetRef


def _metadata_service(session: Session) -> MetadataService:
    return MetadataService(
        store=SQLAlchemyMetadataRepository(
            session_factory=sessionmaker(bind=session.get_bind(), expire_on_commit=False)
        ),
        dataset_access=create_autospec(DatasetAccess, instance=True),
    )


class TestMetadataService:
    """Integration tests for MetadataService using testcontainers."""

    def _create_test_account_and_tenant(self, db_session_with_containers: Session) -> tuple[Account, Tenant]:
        """
        Helper method to create a test account and tenant for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure

        Returns:
            tuple: (account, tenant) - Created account and tenant instances
        """
        fake = Faker()
        account = Account(email=fake.email(), name=fake.name(), interface_language="en-US", status=AccountStatus.ACTIVE)
        db_session_with_containers.add(account)
        db_session_with_containers.commit()
        tenant = Tenant(name=fake.company(), status=TenantStatus.NORMAL)
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()
        join = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER, current=True)
        db_session_with_containers.add(join)
        db_session_with_containers.commit()
        account.current_tenant = tenant
        return (account, tenant)

    def _create_test_dataset(self, db_session_with_containers: Session, account: Account, tenant: Tenant) -> Dataset:
        """
        Helper method to create a test dataset for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            account: Account instance
            tenant: Tenant instance

        Returns:
            Dataset: Created dataset instance
        """
        fake = Faker()
        dataset = Dataset(
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=account.id,
            built_in_field_enabled=False,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        return dataset

    def _create_test_document(
        self, db_session_with_containers: Session, dataset: Dataset, account: Account
    ) -> Document:
        """
        Helper method to create a test document for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            dataset: Dataset instance
            account: Account instance

        Returns:
            Document: Created document instance
        """
        fake = Faker()
        document = Document(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            data_source_info="{}",
            batch="test-batch",
            name=fake.file_name(),
            created_from=DocumentCreatedFrom.WEB,
            created_by=account.id,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            doc_language="en",
        )
        db_session_with_containers.add(document)
        db_session_with_containers.commit()
        return document

    def test_create_metadata_success(self, db_session_with_containers: Session) -> None:
        """
        Test successful metadata creation with valid parameters.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        metadata_args = MetadataArgs(type="string", name="test_metadata")
        result = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), metadata_args, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        assert result is not None
        assert result.name == "test_metadata"
        assert result.type == "string"
        assert result.dataset_id == dataset.id
        assert result.tenant_id == tenant.id
        assert result.created_by == account.id
        db_session_with_containers.expire_all()
        assert result.id is not None
        assert result.created_at is not None

    def test_create_metadata_name_too_long(self, db_session_with_containers: Session) -> None:
        """
        Test metadata creation fails when name exceeds 255 characters.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        long_name = "a" * 256
        metadata_args = MetadataArgs(type="string", name=long_name)
        with pytest.raises(ValueError, match="Metadata name cannot exceed 255 characters."):
            _metadata_service(db_session_with_containers).create_metadata(
                DatasetRef(tenant.id, dataset.id), metadata_args, actor_id=account.id
            )
        db_session_with_containers.expire_all()

    def test_create_metadata_name_already_exists(self, db_session_with_containers: Session) -> None:
        """
        Test metadata creation fails when name already exists in the same dataset.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        first_metadata_args = MetadataArgs(type="string", name="duplicate_name")
        _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), first_metadata_args, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        second_metadata_args = MetadataArgs(type="number", name="duplicate_name")
        with pytest.raises(ValueError, match="Metadata name already exists."):
            _metadata_service(db_session_with_containers).create_metadata(
                DatasetRef(tenant.id, dataset.id), second_metadata_args, actor_id=account.id
            )
        db_session_with_containers.expire_all()

    def test_create_metadata_name_conflicts_with_built_in_field(self, db_session_with_containers: Session) -> None:
        """
        Test metadata creation fails when name conflicts with built-in field names.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        built_in_field_name = BuiltInField.document_name
        metadata_args = MetadataArgs(type="string", name=built_in_field_name)
        with pytest.raises(ValueError, match="Metadata name already exists in Built-in fields."):
            _metadata_service(db_session_with_containers).create_metadata(
                DatasetRef(tenant.id, dataset.id), metadata_args, actor_id=account.id
            )
        db_session_with_containers.expire_all()

    def test_update_metadata_name_success(self, db_session_with_containers: Session) -> None:
        """
        Test successful metadata name update with valid parameters.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        metadata_args = MetadataArgs(type="string", name="old_name")
        metadata = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), metadata_args, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        new_name = "new_name"
        result = _metadata_service(db_session_with_containers).update_metadata_name(
            DatasetRef(dataset.tenant_id, dataset.id), metadata.id, new_name, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        assert result is not None
        assert result.name == new_name
        assert result.updated_by == account.id
        assert result.updated_at is not None
        db_session_with_containers.expire_all()
        assert result.name == new_name

    def test_update_metadata_name_too_long(self, db_session_with_containers: Session) -> None:
        """
        Test metadata name update fails when new name exceeds 255 characters.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        metadata_args = MetadataArgs(type="string", name="old_name")
        metadata = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), metadata_args, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        long_name = "a" * 256
        with pytest.raises(ValueError, match="Metadata name cannot exceed 255 characters."):
            _metadata_service(db_session_with_containers).update_metadata_name(
                DatasetRef(dataset.tenant_id, dataset.id), metadata.id, long_name, actor_id=account.id
            )
        db_session_with_containers.expire_all()

    def test_update_metadata_name_already_exists(self, db_session_with_containers: Session) -> None:
        """
        Test metadata name update fails when new name already exists in the same dataset.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        first_metadata_args = MetadataArgs(type="string", name="first_metadata")
        first_metadata = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), first_metadata_args, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        second_metadata_args = MetadataArgs(type="number", name="second_metadata")
        second_metadata = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), second_metadata_args, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        with pytest.raises(ValueError, match="Metadata name already exists."):
            _metadata_service(db_session_with_containers).update_metadata_name(
                DatasetRef(dataset.tenant_id, dataset.id), first_metadata.id, "second_metadata", actor_id=account.id
            )
        db_session_with_containers.expire_all()

    def test_update_metadata_name_conflicts_with_built_in_field(self, db_session_with_containers: Session) -> None:
        """
        Test metadata name update fails when new name conflicts with built-in field names.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        metadata_args = MetadataArgs(type="string", name="old_name")
        metadata = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), metadata_args, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        built_in_field_name = BuiltInField.document_name
        with pytest.raises(ValueError, match="Metadata name already exists in Built-in fields."):
            _metadata_service(db_session_with_containers).update_metadata_name(
                DatasetRef(dataset.tenant_id, dataset.id), metadata.id, built_in_field_name, actor_id=account.id
            )
        db_session_with_containers.expire_all()

    def test_update_metadata_name_not_found(self, db_session_with_containers: Session) -> None:
        """
        Test metadata name update fails when metadata ID does not exist.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        import uuid

        fake_metadata_id = str(uuid.uuid4())
        new_name = "new_name"
        with pytest.raises(MetadataResourceNotFoundError, match="Metadata not found"):
            _metadata_service(db_session_with_containers).update_metadata_name(
                DatasetRef(dataset.tenant_id, dataset.id), fake_metadata_id, new_name, actor_id=account.id
            )
        db_session_with_containers.expire_all()

    def test_delete_metadata_success(self, db_session_with_containers: Session) -> None:
        """
        Test successful metadata deletion with valid parameters.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        metadata_args = MetadataArgs(type="string", name="to_be_deleted")
        metadata = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), metadata_args, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        result = _metadata_service(db_session_with_containers).delete_metadata(
            DatasetRef(dataset.tenant_id, dataset.id), metadata.id
        )
        db_session_with_containers.expire_all()
        assert result is not None
        assert result.id == metadata.id
        deleted_metadata = db_session_with_containers.query(DatasetMetadata).filter_by(id=metadata.id).first()
        assert deleted_metadata is None

    def test_delete_metadata_not_found(self, db_session_with_containers: Session) -> None:
        """
        Test metadata deletion fails when metadata ID does not exist.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        import uuid

        fake_metadata_id = str(uuid.uuid4())
        with pytest.raises(MetadataResourceNotFoundError, match="Metadata not found"):
            _metadata_service(db_session_with_containers).delete_metadata(
                DatasetRef(dataset.tenant_id, dataset.id), fake_metadata_id
            )
        db_session_with_containers.expire_all()

    def test_delete_metadata_with_document_bindings(self, db_session_with_containers: Session) -> None:
        """
        Test metadata deletion successfully removes document metadata bindings.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, dataset, account)
        metadata_args = MetadataArgs(type="string", name="test_metadata")
        metadata = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), metadata_args, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        binding = DatasetMetadataBinding(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            metadata_id=metadata.id,
            document_id=document.id,
            created_by=account.id,
        )
        db_session_with_containers.add(binding)
        db_session_with_containers.commit()
        document.doc_metadata = {"test_metadata": "test_value"}
        db_session_with_containers.add(document)
        db_session_with_containers.commit()
        result = _metadata_service(db_session_with_containers).delete_metadata(
            DatasetRef(dataset.tenant_id, dataset.id), metadata.id
        )
        db_session_with_containers.expire_all()
        assert result is not None
        deleted_metadata = db_session_with_containers.query(DatasetMetadata).filter_by(id=metadata.id).first()
        assert deleted_metadata is None

    @pytest.mark.parametrize("operation", ["rename", "delete"])
    @pytest.mark.parametrize("binding_owner", ["metadata", "document"])
    def test_metadata_changes_ignore_historical_foreign_document_binding(
        self, operation: str, binding_owner: str, db_session_with_containers: Session
    ) -> None:
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        foreign_account, foreign_tenant = self._create_test_account_and_tenant(db_session_with_containers)
        foreign_dataset = self._create_test_dataset(db_session_with_containers, foreign_account, foreign_tenant)
        foreign_document = self._create_test_document(db_session_with_containers, foreign_dataset, foreign_account)
        foreign_document.enabled = True
        foreign_document.archived = False
        foreign_document.indexing_status = IndexingStatus.COMPLETED
        foreign_document.doc_metadata = {"old_name": "foreign-value"}
        metadata = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), MetadataArgs(type="string", name="old_name"), actor_id=account.id
        )
        db_session_with_containers.expire_all()
        db_session_with_containers.add(
            DatasetMetadataBinding(
                tenant_id=dataset.tenant_id if binding_owner == "metadata" else foreign_dataset.tenant_id,
                dataset_id=dataset.id if binding_owner == "metadata" else foreign_dataset.id,
                metadata_id=metadata.id,
                document_id=foreign_document.id,
                created_by=account.id,
            )
        )
        db_session_with_containers.commit()
        if operation == "rename":
            _metadata_service(db_session_with_containers).update_metadata_name(
                DatasetRef(dataset.tenant_id, dataset.id), metadata.id, "new_name", actor_id=account.id
            )
        else:
            _metadata_service(db_session_with_containers).delete_metadata(
                DatasetRef(dataset.tenant_id, dataset.id), metadata.id
            )
        db_session_with_containers.expire_all()
        db_session_with_containers.refresh(foreign_document)
        assert foreign_document.doc_metadata == {"old_name": "foreign-value"}

    def test_get_built_in_fields_success(self, db_session_with_containers: Session) -> None:
        """
        Test successful retrieval of built-in metadata fields.
        """
        result = MetadataService.get_built_in_fields()
        assert result is not None
        assert len(result) == 5
        field_names = [field["name"] for field in result]
        field_types = [field["type"] for field in result]
        assert BuiltInField.document_name in field_names
        assert BuiltInField.uploader in field_names
        assert BuiltInField.upload_date in field_names
        assert BuiltInField.last_update_date in field_names
        assert BuiltInField.source in field_names
        assert "string" in field_types
        assert "time" in field_types

    def test_enable_built_in_field_success(self, db_session_with_containers: Session) -> None:
        """
        Test successful enabling of built-in fields for a dataset.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, dataset, account)
        assert dataset.built_in_field_enabled is False
        _metadata_service(db_session_with_containers).enable_built_in_field(DatasetRef(dataset.tenant_id, dataset.id))
        db_session_with_containers.expire_all()
        db_session_with_containers.refresh(dataset)
        assert dataset.built_in_field_enabled

    def test_enable_built_in_field_already_enabled(self, db_session_with_containers: Session) -> None:
        """
        Test enabling built-in fields when they are already enabled.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        dataset.built_in_field_enabled = True
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        _metadata_service(db_session_with_containers).enable_built_in_field(DatasetRef(dataset.tenant_id, dataset.id))
        db_session_with_containers.expire_all()
        db_session_with_containers.refresh(dataset)
        assert dataset.built_in_field_enabled is True

    def test_enable_built_in_field_with_no_documents(self, db_session_with_containers: Session) -> None:
        """
        Test enabling built-in fields for a dataset with no documents.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        _metadata_service(db_session_with_containers).enable_built_in_field(DatasetRef(dataset.tenant_id, dataset.id))
        db_session_with_containers.expire_all()
        db_session_with_containers.refresh(dataset)
        assert dataset.built_in_field_enabled

    def test_disable_built_in_field_success(self, db_session_with_containers: Session) -> None:
        """
        Test successful disabling of built-in fields for a dataset.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, dataset, account)
        dataset.built_in_field_enabled = True
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        document.doc_metadata = {
            BuiltInField.document_name: document.name,
            BuiltInField.uploader: "test_uploader",
            BuiltInField.upload_date: 1234567890.0,
            BuiltInField.last_update_date: 1234567890.0,
            BuiltInField.source: "test_source",
        }
        db_session_with_containers.add(document)
        db_session_with_containers.commit()
        _metadata_service(db_session_with_containers).disable_built_in_field(DatasetRef(dataset.tenant_id, dataset.id))
        db_session_with_containers.expire_all()
        db_session_with_containers.refresh(dataset)
        assert dataset.built_in_field_enabled is False

    def test_disable_built_in_field_already_disabled(self, db_session_with_containers: Session) -> None:
        """
        Test disabling built-in fields when they are already disabled.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        assert dataset.built_in_field_enabled is False
        _metadata_service(db_session_with_containers).disable_built_in_field(DatasetRef(dataset.tenant_id, dataset.id))
        db_session_with_containers.expire_all()
        db_session_with_containers.refresh(dataset)
        assert not dataset.built_in_field_enabled

    def test_disable_built_in_field_with_no_documents(self, db_session_with_containers: Session) -> None:
        """
        Test disabling built-in fields for a dataset with no documents.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        dataset.built_in_field_enabled = True
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        _metadata_service(db_session_with_containers).disable_built_in_field(DatasetRef(dataset.tenant_id, dataset.id))
        db_session_with_containers.expire_all()
        db_session_with_containers.refresh(dataset)
        assert dataset.built_in_field_enabled is False

    def test_update_documents_metadata_success(self, db_session_with_containers: Session) -> None:
        """
        Test successful update of documents metadata.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, dataset, account)
        metadata_args = MetadataArgs(type="string", name="test_metadata")
        metadata = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), metadata_args, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        metadata_detail = MetadataDetail(id=metadata.id, name=metadata.name, value="test_value")
        operation = DocumentMetadataOperation(document_id=document.id, metadata_list=[metadata_detail])
        operation_data = MetadataOperationData(operation_data=[operation])
        _metadata_service(db_session_with_containers).update_documents_metadata(
            DatasetRef(dataset.tenant_id, dataset.id), operation_data, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        db_session_with_containers.refresh(document)
        assert document.doc_metadata is not None
        assert "test_metadata" in document.doc_metadata
        assert document.doc_metadata["test_metadata"] == "test_value"
        binding = (
            db_session_with_containers.query(DatasetMetadataBinding)
            .filter_by(metadata_id=metadata.id, document_id=document.id)
            .first()
        )
        assert binding is not None
        assert binding.tenant_id == tenant.id
        assert binding.dataset_id == dataset.id

    @pytest.mark.parametrize("foreign_resource", ["metadata", "document"])
    def test_update_documents_metadata_rejects_foreign_owner_before_writes(
        self, foreign_resource: str, db_session_with_containers: Session
    ) -> None:
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, dataset, account)
        metadata = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), MetadataArgs(type="string", name="owned"), actor_id=account.id
        )
        db_session_with_containers.expire_all()
        foreign_account, foreign_tenant = self._create_test_account_and_tenant(db_session_with_containers)
        foreign_dataset = self._create_test_dataset(db_session_with_containers, foreign_account, foreign_tenant)
        foreign_document = self._create_test_document(db_session_with_containers, foreign_dataset, foreign_account)
        foreign_metadata = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(foreign_tenant.id, foreign_dataset.id),
            MetadataArgs(type="string", name="foreign"),
            actor_id=foreign_account.id,
        )
        db_session_with_containers.expire_all()
        operation = DocumentMetadataOperation(
            document_id=foreign_document.id if foreign_resource == "document" else document.id,
            metadata_list=[
                MetadataDetail(
                    id=foreign_metadata.id if foreign_resource == "metadata" else metadata.id,
                    name="ignored",
                    value="value",
                )
            ],
        )
        with pytest.raises(MetadataResourceNotFoundError, match=f"{foreign_resource.capitalize()} not found"):
            _metadata_service(db_session_with_containers).update_documents_metadata(
                DatasetRef(dataset.tenant_id, dataset.id),
                MetadataOperationData(operation_data=[operation]),
                actor_id=account.id,
            )
        db_session_with_containers.expire_all()
        db_session_with_containers.refresh(document)
        db_session_with_containers.refresh(foreign_document)
        assert document.doc_metadata is None
        assert foreign_document.doc_metadata is None
        assert db_session_with_containers.query(DatasetMetadataBinding).count() == 0

    def test_update_documents_metadata_with_built_in_fields_enabled(self, db_session_with_containers: Session) -> None:
        """
        Test update of documents metadata when built-in fields are enabled.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, dataset, account)
        dataset.built_in_field_enabled = True
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        metadata_args = MetadataArgs(type="string", name="test_metadata")
        metadata = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), metadata_args, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        metadata_detail = MetadataDetail(id=metadata.id, name=metadata.name, value="test_value")
        operation = DocumentMetadataOperation(document_id=document.id, metadata_list=[metadata_detail])
        operation_data = MetadataOperationData(operation_data=[operation])
        _metadata_service(db_session_with_containers).update_documents_metadata(
            DatasetRef(dataset.tenant_id, dataset.id), operation_data, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        db_session_with_containers.refresh(document)
        assert document.doc_metadata is not None
        assert "test_metadata" in document.doc_metadata
        assert document.doc_metadata["test_metadata"] == "test_value"

    def test_update_documents_metadata_document_not_found(self, db_session_with_containers: Session) -> None:
        """
        Test update of documents metadata when document is not found.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        metadata_args = MetadataArgs(type="string", name="test_metadata")
        metadata = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), metadata_args, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        metadata_detail = MetadataDetail(id=metadata.id, name=metadata.name, value="test_value")
        operation = DocumentMetadataOperation(
            document_id="00000000-0000-0000-0000-000000000000", metadata_list=[metadata_detail]
        )
        operation_data = MetadataOperationData(operation_data=[operation])
        with pytest.raises(MetadataResourceNotFoundError, match="Document not found"):
            _metadata_service(db_session_with_containers).update_documents_metadata(
                DatasetRef(dataset.tenant_id, dataset.id), operation_data, actor_id=account.id
            )
        db_session_with_containers.expire_all()

    def test_get_dataset_metadatas_success(self, db_session_with_containers: Session) -> None:
        """
        Test successful retrieval of dataset metadata information.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        metadata_args = MetadataArgs(type="string", name="test_metadata")
        metadata = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), metadata_args, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        document = self._create_test_document(db_session_with_containers, dataset, account)
        binding = DatasetMetadataBinding(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            metadata_id=metadata.id,
            document_id=document.id,
            created_by=account.id,
        )
        db_session_with_containers.add(binding)
        db_session_with_containers.commit()
        result = _metadata_service(db_session_with_containers).get_dataset_metadatas(
            DatasetRef(dataset.tenant_id, dataset.id)
        )
        db_session_with_containers.expire_all()
        assert result is not None
        assert "doc_metadata" in result
        assert "built_in_field_enabled" in result
        doc_metadata = result["doc_metadata"]
        assert len(doc_metadata) == 1
        assert doc_metadata[0]["id"] == metadata.id
        assert doc_metadata[0]["name"] == metadata.name
        assert doc_metadata[0]["type"] == metadata.type
        assert doc_metadata[0]["count"] == 1
        assert result["built_in_field_enabled"] is False

    def test_get_dataset_metadatas_with_built_in_fields_enabled(self, db_session_with_containers: Session) -> None:
        """
        Test retrieval of dataset metadata when built-in fields are enabled.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        dataset.built_in_field_enabled = True
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        metadata_args = MetadataArgs(type="string", name="test_metadata")
        metadata = _metadata_service(db_session_with_containers).create_metadata(
            DatasetRef(tenant.id, dataset.id), metadata_args, actor_id=account.id
        )
        db_session_with_containers.expire_all()
        result = _metadata_service(db_session_with_containers).get_dataset_metadatas(
            DatasetRef(dataset.tenant_id, dataset.id)
        )
        db_session_with_containers.expire_all()
        assert result is not None
        assert "doc_metadata" in result
        assert "built_in_field_enabled" in result
        doc_metadata = result["doc_metadata"]
        assert len(doc_metadata) == 1
        assert result["built_in_field_enabled"] is True

    def test_get_dataset_metadatas_no_metadata(self, db_session_with_containers: Session) -> None:
        """
        Test retrieval of dataset metadata when no metadata exists.
        """
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        result = _metadata_service(db_session_with_containers).get_dataset_metadatas(
            DatasetRef(dataset.tenant_id, dataset.id)
        )
        db_session_with_containers.expire_all()
        assert result is not None
        assert "doc_metadata" in result
        assert "built_in_field_enabled" in result
        doc_metadata = result["doc_metadata"]
        assert len(doc_metadata) == 0
        assert result["built_in_field_enabled"] is False
