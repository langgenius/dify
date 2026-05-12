from unittest.mock import MagicMock, patch

import pytest

from core.rag.index_processor.constant.built_in_field import BuiltInField, MetadataDataSource
from models.account import Account
from models.dataset import DatasetMetadata
from models.enums import DatasetMetadataType
from services.entities.knowledge_entities.knowledge_entities import (
    DocumentMetadataOperation,
    MetadataArgs,
    MetadataDetail,
    MetadataOperationData,
)
from services.metadata_service import MetadataService

TEST_DATASET_ID = "ds1"
TEST_TENANT_ID = "test_tenant"
TEST_DOCUMENT_ID = "d1"


class TestMetadataServiceFactory:
    """Factory for MetadataService unit test mocks."""

    @staticmethod
    def create_account_mock(user_id: str = "test_user_id") -> MagicMock:
        """Create a mock Account object."""
        account = MagicMock(spec=Account)
        account.id = user_id
        account.__class__ = Account
        return account

    @staticmethod
    def create_dataset_mock(
        built_in_field_enabled: bool = False,
        dataset_id: str = TEST_DATASET_ID,
        tenant_id: str = TEST_TENANT_ID,
        doc_metadata: list | None = None,
    ) -> MagicMock:
        """Create a mock Dataset object."""
        dataset = MagicMock()
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.built_in_field_enabled = built_in_field_enabled
        dataset.doc_metadata = doc_metadata or []
        return dataset

    @staticmethod
    def create_dataset_metadata_mock(name: str = "test_meta") -> MagicMock:
        """Create a mock DatasetMetadata object."""
        metadata = MagicMock()
        metadata.name = name
        return metadata

    @staticmethod
    def create_document_mock(
        doc_metadata: dict | None = None,
        name: str = "test_doc",
        uploader: str = "test_user",
        data_source_type: str = MetadataDataSource.upload_file.name,
    ) -> MagicMock:
        """Create a basic mock Document object."""
        document = MagicMock()
        document.doc_metadata = doc_metadata or {}
        document.name = name
        document.uploader = uploader
        document.data_source_type = data_source_type
        return document

    @staticmethod
    def create_document_with_built_in_fields_mock() -> MagicMock:
        """Create a mock Document with date fields for built-in metadata."""
        document = MagicMock()
        document.doc_metadata = None
        document.name = "test_doc"
        document.uploader = "test_user"
        document.upload_date = MagicMock(timestamp=lambda: 123)
        document.last_update_date = MagicMock(timestamp=lambda: 456)
        document.data_source_type = MetadataDataSource.upload_file.name
        return document


class TestMetadataServiceCreateMetadata:
    """
    Unit tests for MetadataService.create_metadata.

    This test suite covers:
    - Successful creation of a new metadata field
    - Validation of name length constraints
    - Duplicate name validation
    - Built-in field name conflicts
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestMetadataServiceFactory()

    @patch("services.metadata_service.db")
    @patch("services.metadata_service.current_account_with_tenant")
    def test_create_metadata_success(self, mock_current_account, mock_db, factory):
        """Test create_metadata persists a new metadata field."""
        # Arrange
        mock_current_account.return_value = (factory.create_account_mock(), TEST_TENANT_ID)
        mock_db.session.scalar.return_value = None
        args = MetadataArgs(name="test", type=DatasetMetadataType.STRING)

        # Act
        res = MetadataService.create_metadata(TEST_DATASET_ID, args)

        # Assert
        assert isinstance(res, DatasetMetadata)
        mock_db.session.add.assert_called_once()
        mock_db.session.commit.assert_called_once()

    def test_create_metadata_name_too_long(self):
        """Test name length validation."""
        # Arrange
        long_name = "x" * 300
        args = MetadataArgs(name=long_name, type=DatasetMetadataType.STRING)

        # Act & Assert
        with pytest.raises(ValueError, match="255"):
            MetadataService.create_metadata(TEST_DATASET_ID, args)

    @patch("services.metadata_service.db")
    @patch("services.metadata_service.current_account_with_tenant")
    def test_create_metadata_name_exists(self, mock_current_account, mock_db, factory):
        """Test duplicate name raises."""
        # Arrange
        mock_current_account.return_value = (factory.create_account_mock(), TEST_TENANT_ID)
        mock_db.session.scalar.return_value = MagicMock()
        args = MetadataArgs(name="test", type=DatasetMetadataType.STRING)

        # Act & Assert
        with pytest.raises(ValueError, match="already exists"):
            MetadataService.create_metadata(TEST_DATASET_ID, args)

    @patch("services.metadata_service.db")
    @patch("services.metadata_service.current_account_with_tenant")
    def test_create_metadata_built_in_conflict(self, mock_current_account, mock_db, factory):
        """Test built-in field name cannot be reused."""
        # Arrange
        mock_current_account.return_value = (factory.create_account_mock(), TEST_TENANT_ID)
        mock_db.session.scalar.return_value = None
        args = MetadataArgs(name=BuiltInField.document_name.value, type=DatasetMetadataType.STRING)

        # Act & Assert
        with pytest.raises(ValueError, match="Built-in"):
            MetadataService.create_metadata(TEST_DATASET_ID, args)


class TestMetadataServiceUpdateMetadataName:
    """
    Unit tests for MetadataService.update_metadata_name.

    This test suite covers:
    - Successful update of metadata name
    - Validation of name length constraints
    - Duplicate name validation
    - Built-in field name conflicts
    - Handling of missing metadata row
    - Handling of exceptions during update
    - Handling of None doc_metadata in documents
    - Empty dataset metadata bindings
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestMetadataServiceFactory()

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.db")
    @patch("services.metadata_service.current_account_with_tenant")
    def test_update_metadata_name_success(self, mock_current_account, mock_db, mock_doc, mock_redis, factory):
        """Test successful rename updates Redis and returns metadata."""
        # Arrange
        mock_current_account.return_value = (factory.create_account_mock(), TEST_TENANT_ID)
        mock_db.session.scalar.side_effect = [None, factory.create_dataset_metadata_mock(name="old_name")]
        mock_doc.get_document_by_ids.return_value = [factory.create_document_mock(doc_metadata={"old_name": 1})]
        mock_redis.get.return_value = None

        # Act
        res = MetadataService.update_metadata_name(TEST_DATASET_ID, "m1", "new_name")

        # Assert
        assert res is not None
        assert res.name == "new_name"
        mock_redis.delete.assert_called_once()

    def test_update_metadata_name_too_long(self):
        """Test new name length validation."""
        # Act & Assert
        with pytest.raises(ValueError, match="255"):
            MetadataService.update_metadata_name(TEST_DATASET_ID, "m1", "x" * 300)

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.db")
    @patch("services.metadata_service.current_account_with_tenant")
    def test_update_metadata_name_conflict(self, mock_current_account, mock_db, mock_redis, factory):
        """Test conflict when target name exists."""
        # Arrange
        mock_current_account.return_value = (factory.create_account_mock(), TEST_TENANT_ID)
        mock_db.session.scalar.return_value = factory.create_dataset_metadata_mock()
        mock_redis.get.return_value = None

        # Act & Assert
        with pytest.raises(ValueError, match="exists"):
            MetadataService.update_metadata_name(TEST_DATASET_ID, "m1", "test")

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.db")
    @patch("services.metadata_service.current_account_with_tenant")
    def test_update_metadata_name_built_in_conflict(self, mock_current_account, mock_db, mock_redis, factory):
        """Test cannot rename to built-in field name."""
        # Arrange
        mock_current_account.return_value = (factory.create_account_mock(), TEST_TENANT_ID)
        mock_db.session.scalar.return_value = None
        mock_redis.get.return_value = None

        # Act & Assert
        with pytest.raises(ValueError, match="Built-in"):
            MetadataService.update_metadata_name(TEST_DATASET_ID, "m1", BuiltInField.document_name.value)

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.db")
    @patch("services.metadata_service.current_account_with_tenant")
    def test_update_metadata_name_not_found(self, mock_current_account, mock_db, mock_redis, factory):
        """Test returns None when metadata row missing."""
        # Arrange
        mock_current_account.return_value = (factory.create_account_mock(), TEST_TENANT_ID)
        mock_db.session.scalar.side_effect = [None, None]
        mock_redis.get.return_value = None

        # Act
        res = MetadataService.update_metadata_name(TEST_DATASET_ID, "m1", "new")

        # Assert
        assert res is None

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.db")
    @patch("services.metadata_service.current_account_with_tenant")
    def test_update_metadata_name_exception(self, mock_current_account, mock_db, mock_redis, factory):
        """Test scalar failure returns None."""
        # Arrange
        mock_current_account.return_value = (factory.create_account_mock(), TEST_TENANT_ID)
        mock_db.session.scalar.side_effect = [None, Exception("fail")]
        mock_redis.get.return_value = None

        # Act
        res = MetadataService.update_metadata_name(TEST_DATASET_ID, "m1", "new")

        # Assert
        assert res is None

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.db")
    @patch("services.metadata_service.current_account_with_tenant")
    def test_update_metadata_name_doc_metadata_none(self, mock_current_account, mock_db, mock_doc, mock_redis, factory):
        """Test update metadata name when document.doc_metadata is None (cover doc_metadata = {})."""
        # Arrange
        mock_current_account.return_value = (factory.create_account_mock(), TEST_TENANT_ID)
        mock_db.session.scalar.side_effect = [None, factory.create_dataset_metadata_mock(name="old_name")]
        mock_doc.get_document_by_ids.return_value = [factory.create_document_mock(doc_metadata=None)]
        mock_redis.get.return_value = None

        # Act
        MetadataService.update_metadata_name(TEST_DATASET_ID, "m1", "new_name")

        # Assert
        mock_db.session.commit.assert_called_once()

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.db")
    @patch("services.metadata_service.current_account_with_tenant")
    def test_update_metadata_name_no_bindings(self, mock_current_account, mock_db, mock_doc, mock_redis, factory):
        """Test update metadata name with empty dataset metadata bindings."""
        mock_current_account.return_value = (factory.create_account_mock(), TEST_TENANT_ID)
        mock_db.session.scalar.side_effect = [None, factory.create_dataset_metadata_mock(name="old_name")]
        mock_db.session.scalars.return_value.all.return_value = []
        mock_redis.get.return_value = None
        res = MetadataService.update_metadata_name(TEST_DATASET_ID, "m1", "new_name")
        assert res is not None


class TestMetadataServiceDeleteMetadata:
    """
    Unit tests for MetadataService.delete_metadata.

    This test suite covers:
    - Successful deletion of a metadata field
    - Handling of missing metadata row
    - Handling of exceptions during deletion
    - Handling of None doc_metadata in documents
    - Empty dataset metadata bindings
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestMetadataServiceFactory()

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.db")
    def test_delete_metadata_success(self, mock_db, mock_doc, mock_redis, factory):
        """Test delete removes row and commits."""
        # Arrange
        mock_meta = factory.create_dataset_metadata_mock(name="old_key")
        mock_db.session.scalar.return_value = mock_meta
        mock_doc.get_document_by_ids.return_value = [factory.create_document_mock(doc_metadata={"old_key": 1})]
        mock_redis.get.return_value = None

        # Act
        res = MetadataService.delete_metadata(TEST_DATASET_ID, "m1")

        # Assert
        assert res is not None
        mock_db.session.delete.assert_called_once_with(mock_meta)
        mock_db.session.commit.assert_called_once()

    @patch("services.metadata_service.db")
    def test_delete_metadata_not_found(self, mock_db):
        """Test delete returns None when missing."""
        # Arrange
        mock_db.session.scalar.return_value = None

        # Act
        res = MetadataService.delete_metadata(TEST_DATASET_ID, "m1")

        # Assert
        assert res is None

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.db")
    def test_delete_metadata_exception(self, mock_db, mock_redis):
        """Test delete returns None on DB error."""
        # Arrange
        mock_db.session.scalar.side_effect = Exception("fail")
        mock_redis.get.return_value = None

        # Act
        res = MetadataService.delete_metadata(TEST_DATASET_ID, "m1")

        # Assert
        assert res is None

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.db")
    def test_delete_metadata_doc_metadata_none(self, mock_db, mock_doc, mock_redis, factory):
        """Test delete metadata when document.doc_metadata is None (cover doc_metadata = {})."""
        # Arrange
        mock_meta = factory.create_dataset_metadata_mock(name="old_key")
        mock_db.session.scalar.return_value = mock_meta
        mock_doc.get_document_by_ids.return_value = [factory.create_document_mock(doc_metadata=None)]
        mock_redis.get.return_value = None

        # Act
        MetadataService.delete_metadata(TEST_DATASET_ID, "m1")

        # Assert
        mock_db.session.commit.assert_called_once()

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.db")
    def test_delete_metadata_no_bindings(self, mock_db, mock_doc, mock_redis, factory):
        """Test delete metadata with empty dataset metadata bindings."""
        mock_meta = factory.create_dataset_metadata_mock(name="old_key")
        mock_db.session.scalar.return_value = mock_meta
        mock_db.session.scalars.return_value.all.return_value = []
        mock_redis.get.return_value = None
        res = MetadataService.delete_metadata(TEST_DATASET_ID, "m1")
        assert res is not None


class TestMetadataServiceBuiltInFields:
    """
    Unit tests for built-in metadata field helpers.

    This test suite covers:
    - Retrieve built-in metadata field definitions
    - Idempotent enable operation
    - Successful enable with documents
    - Successful enable with empty documents
    - Exception handling for enable operation
    - Built-in field doc_metadata not None during enable
    - Idempotent disable operation
    - Successful disable with documents
    - Successful disable with empty documents
    - Exception handling for disable operation
    - Built-in field doc_metadata None during disable
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestMetadataServiceFactory()

    def test_get_built_in_fields(self):
        """Test built-in field list shape."""
        # Act
        res = MetadataService.get_built_in_fields()

        # Assert
        assert len(res) == 5
        assert res[0]["name"] == BuiltInField.document_name

    def test_enable_built_in_already_enabled(self, factory):
        """Test no-op when already enabled."""
        # Arrange
        ds = factory.create_dataset_mock(built_in_field_enabled=True)

        # Act
        MetadataService.enable_built_in_field(ds)

        # Assert
        assert ds.built_in_field_enabled is True

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.db")
    def test_enable_built_in_success(self, mock_db, mock_doc, mock_redis, factory):
        """Test enabling writes document metadata for working docs."""
        # Arrange
        ds = factory.create_dataset_mock(built_in_field_enabled=False)
        mock_doc.get_working_documents_by_dataset_id.return_value = [
            factory.create_document_with_built_in_fields_mock()
        ]
        mock_redis.get.return_value = None

        # Act
        MetadataService.enable_built_in_field(ds)

        # Assert
        assert ds.built_in_field_enabled is True
        mock_db.session.add.assert_called()
        mock_db.session.commit.assert_called_once()

    @patch("services.metadata_service.db")
    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    def test_enable_built_in_empty_documents(self, mock_doc, mock_redis, mock_db, factory):
        """Test enable with no documents."""
        # Arrange
        ds = factory.create_dataset_mock(built_in_field_enabled=False)
        mock_doc.get_working_documents_by_dataset_id.return_value = []
        mock_redis.get.return_value = None

        # Act
        MetadataService.enable_built_in_field(ds)

        # Assert
        assert ds.built_in_field_enabled is True

    @patch("services.metadata_service.db")
    @patch("services.metadata_service.DocumentService")
    def test_enable_built_in_exception(self, mock_doc, mock_db, factory):
        """Test enable swallows document load errors."""
        # Arrange
        ds = factory.create_dataset_mock(built_in_field_enabled=False)
        mock_doc.get_working_documents_by_dataset_id.side_effect = Exception("fail")

        # Act
        MetadataService.enable_built_in_field(ds)

        # Assert
        assert ds.built_in_field_enabled is False

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.db")
    def test_enable_built_in_field_doc_metadata_not_none(self, mock_db, mock_doc, mock_redis, factory):
        """Test enable built-in field when document.doc_metadata is not None (cover deepcopy)."""
        # Arrange
        ds = factory.create_dataset_mock(built_in_field_enabled=False)
        mock_doc.get_working_documents_by_dataset_id.return_value = [
            factory.create_document_mock(doc_metadata={"custom_key": "custom_val"})
        ]
        mock_redis.get.return_value = None

        # Act
        MetadataService.enable_built_in_field(ds)

        # Assert
        assert ds.built_in_field_enabled is True

    def test_disable_built_in_already_disabled(self, factory):
        """Test no-op when already disabled."""
        # Arrange
        ds = factory.create_dataset_mock(built_in_field_enabled=False)

        # Act
        MetadataService.disable_built_in_field(ds)

        # Assert
        assert ds.built_in_field_enabled is False

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.db")
    def test_disable_built_in_success(self, mock_db, mock_doc, mock_redis, factory):
        """Test disable clears built-in keys from documents."""
        # Arrange
        ds = factory.create_dataset_mock(built_in_field_enabled=True)
        mock_doc.get_working_documents_by_dataset_id.return_value = [
            factory.create_document_mock(
                doc_metadata={
                    BuiltInField.document_name.value: "test",
                    BuiltInField.uploader.value: "u",
                }
            )
        ]
        mock_redis.get.return_value = None

        # Act
        MetadataService.disable_built_in_field(ds)

        # Assert
        assert ds.built_in_field_enabled is False
        mock_db.session.commit.assert_called_once()

    @patch("services.metadata_service.db")
    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    def test_disable_built_in_empty_documents(self, mock_doc, mock_redis, mock_db, factory):
        """Test disable with no documents."""
        # Arrange
        ds = factory.create_dataset_mock(built_in_field_enabled=True)
        mock_doc.get_working_documents_by_dataset_id.return_value = []
        mock_redis.get.return_value = None

        # Act
        MetadataService.disable_built_in_field(ds)

        # Assert
        assert ds.built_in_field_enabled is False

    @patch("services.metadata_service.db")
    @patch("services.metadata_service.DocumentService")
    def test_disable_built_in_exception(self, mock_doc, mock_db, factory):
        """Test disable swallows document load errors."""
        # Arrange
        ds = factory.create_dataset_mock(built_in_field_enabled=True)
        mock_doc.get_working_documents_by_dataset_id.side_effect = Exception("fail")

        # Act
        MetadataService.disable_built_in_field(ds)

        # Assert
        assert ds.built_in_field_enabled is True

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.db")
    def test_disable_built_in_field_doc_metadata_none(self, mock_db, mock_doc, mock_redis, factory):
        """Test disable built-in field when document.doc_metadata is None (cover doc_metadata = {})."""
        # Arrange
        ds = factory.create_dataset_mock(built_in_field_enabled=True)
        mock_doc.get_working_documents_by_dataset_id.return_value = [factory.create_document_mock(doc_metadata=None)]
        mock_redis.get.return_value = None

        # Act
        MetadataService.disable_built_in_field(ds)

        # Assert
        assert ds.built_in_field_enabled is False


class TestMetadataServiceUpdateDocumentsMetadata:
    """
    Unit tests for MetadataService.update_documents_metadata.

    This test suite covers:
    - Full metadata replacement for a document
    - Partial metadata merge for a document
    - Handling of missing document
    - Handling of exceptions during document load
    - Existing metadata binding
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestMetadataServiceFactory()

    @patch("services.metadata_service.db")
    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.current_account_with_tenant")
    def test_update_docs_metadata_full(self, mock_current_account, mock_doc, mock_redis, mock_db, factory):
        """Test full replace of document metadata."""
        # Arrange
        mock_current_account.return_value = (factory.create_account_mock(), TEST_TENANT_ID)
        mock_doc.get_document.return_value = factory.create_document_with_built_in_fields_mock()
        mock_redis.get.return_value = None

        op_data = MetadataOperationData(
            operation_data=[
                DocumentMetadataOperation(
                    document_id=TEST_DOCUMENT_ID,
                    partial_update=False,
                    metadata_list=[MetadataDetail(id="m1", name="k", type=DatasetMetadataType.STRING, value="v")],
                )
            ]
        )
        ds = factory.create_dataset_mock(built_in_field_enabled=True)

        # Act
        MetadataService.update_documents_metadata(ds, op_data)

        # Assert
        mock_db.session.add.assert_called()
        mock_db.session.commit.assert_called_once()

    @patch("services.metadata_service.db")
    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.current_account_with_tenant")
    def test_update_docs_metadata_partial(self, mock_current_account, mock_doc, mock_redis, mock_db, factory):
        """Test partial metadata merge."""
        # Arrange
        mock_current_account.return_value = (factory.create_account_mock(), TEST_TENANT_ID)
        mock_doc.get_document.return_value = factory.create_document_mock(doc_metadata={"x": 1})
        mock_redis.get.return_value = None

        op_data = MetadataOperationData(
            operation_data=[
                DocumentMetadataOperation(
                    document_id=TEST_DOCUMENT_ID,
                    partial_update=True,
                    metadata_list=[MetadataDetail(id="m1", name="k", type=DatasetMetadataType.STRING, value="v")],
                )
            ]
        )
        ds = factory.create_dataset_mock(built_in_field_enabled=False)

        # Act
        MetadataService.update_documents_metadata(ds, op_data)

        # Assert
        mock_db.session.add.assert_called()
        mock_db.session.commit.assert_called_once()

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    def test_update_docs_metadata_doc_not_found(self, mock_doc, mock_redis, factory):
        """Test missing document raises."""
        # Arrange
        mock_doc.get_document.return_value = None
        mock_redis.get.return_value = None
        op_data = MetadataOperationData(
            operation_data=[
                DocumentMetadataOperation(document_id=TEST_DOCUMENT_ID, partial_update=True, metadata_list=[])
            ]
        )
        ds = factory.create_dataset_mock()

        # Act & Assert
        with pytest.raises(ValueError, match="Document not found"):
            MetadataService.update_documents_metadata(ds, op_data)

    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    def test_update_docs_metadata_exception(self, mock_doc, mock_redis, factory):
        """Test document load error propagates."""
        # Arrange
        mock_doc.get_document.side_effect = RuntimeError("fail")
        mock_redis.get.return_value = None
        op_data = MetadataOperationData(
            operation_data=[
                DocumentMetadataOperation(document_id=TEST_DOCUMENT_ID, partial_update=True, metadata_list=[])
            ]
        )

        # Act & Assert
        with pytest.raises(RuntimeError):
            MetadataService.update_documents_metadata(factory.create_dataset_mock(), op_data)

    @patch("services.metadata_service.db")
    @patch("services.metadata_service.redis_client")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.current_account_with_tenant")
    def test_update_docs_metadata_existing_binding(self, mock_current_account, mock_doc, mock_redis, mock_db, factory):
        """Test update with existing metadata binding."""
        # Arrange
        mock_current_account.return_value = (factory.create_account_mock(), TEST_TENANT_ID)
        mock_doc.get_document.return_value = factory.create_document_mock(doc_metadata={"x": 1})
        mock_redis.get.return_value = None
        mock_db.session.scalar.return_value = None

        op_data = MetadataOperationData(
            operation_data=[
                DocumentMetadataOperation(
                    document_id=TEST_DOCUMENT_ID,
                    partial_update=True,
                    metadata_list=[MetadataDetail(id="m1", name="k", type=DatasetMetadataType.STRING, value="v")],
                )
            ]
        )

        # Act
        MetadataService.update_documents_metadata(factory.create_dataset_mock(), op_data)

        # Assert
        mock_db.session.scalar.assert_called_once()


class TestMetadataServiceLockCheck:
    """
    Unit tests for MetadataService.knowledge_base_metadata_lock_check.

    This test suite covers:
    - Lock check passes when no Redis keys are set
    - Dataset-level lock raises appropriate error
    - Document-level lock raises appropriate error
    """

    @patch("services.metadata_service.redis_client")
    def test_lock_both_dataset_and_document(self, mock_redis):
        """Test lock check passes when Redis keys absent."""
        # Arrange
        mock_redis.get.return_value = None
        mock_redis.set.return_value = True

        # Act
        MetadataService.knowledge_base_metadata_lock_check("ds1", "d1")

        # Assert
        assert mock_redis.set.call_count == 2

    @patch("services.metadata_service.redis_client")
    def test_lock_dataset_already_locked(self, mock_redis):
        """Test dataset-level lock raises."""
        # Arrange
        mock_redis.get.return_value = b"1"

        # Act & Assert
        with pytest.raises(ValueError, match="knowledge base metadata operation is running"):
            MetadataService.knowledge_base_metadata_lock_check("ds1", None)

    @patch("services.metadata_service.redis_client")
    def test_lock_document_already_locked(self, mock_redis):
        """Test document-level lock raises."""
        # Arrange
        mock_redis.get.return_value = b"1"

        # Act & Assert
        with pytest.raises(ValueError, match="document metadata operation is running"):
            MetadataService.knowledge_base_metadata_lock_check(None, "d1")


class TestMetadataServiceGetDatasetMetadatas:
    """
    Unit tests for MetadataService.get_dataset_metadatas.

    This test suite covers:
    - Retrieval of dataset metadata
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestMetadataServiceFactory()

    @patch("services.metadata_service.db")
    def test_get_dataset_metadatas(self, mock_db, factory):
        """Test response includes doc_metadata with counts."""
        # Arrange
        mock_db.session.scalar.return_value = 0
        ds = factory.create_dataset_mock(
            built_in_field_enabled=True, doc_metadata=[{"id": "m1", "name": "n", "type": "s"}]
        )

        # Act
        res = MetadataService.get_dataset_metadatas(ds)

        # Assert
        assert "doc_metadata" in res
        assert "built_in_field_enabled" in res
        assert res["doc_metadata"][0]["count"] == 0
