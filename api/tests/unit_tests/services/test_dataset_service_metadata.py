from unittest.mock import Mock, patch
from uuid import uuid4

import pytest

from models.account import Account
from models.dataset import Dataset, DatasetMetadata, DatasetMetadataBinding, Document
from models.model import UploadFile
from services.dataset_service import DocumentService
from services.entities.knowledge_entities.knowledge_entities import (
    DataSource,
    DocumentMetadataInput,
    FileInfo,
    InfoList,
    KnowledgeConfig,
)


class TestDocumentServiceMetadata:
    @pytest.fixture
    def mock_dependencies(self):
        with (
            patch("services.dataset_service.db.session") as mock_db,
            patch("services.dataset_service.DatasetService.get_dataset") as mock_get_dataset,
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.DocumentService.build_document") as mock_build_document,
            patch("services.dataset_service.current_user") as mock_current_user,
            patch("services.dataset_service.DocumentIndexingTaskProxy") as mock_indexing_task,
            patch("services.dataset_service.DuplicateDocumentIndexingTaskProxy") as mock_duplicate_indexing_task,
            # We don't patch DocumentService.save_document_with_dataset_id as that's what we are testing
        ):
            # Hack to pass isinstance check
            mock_current_user.__class__ = Account
            mock_current_user.current_tenant_id = "tenant-123"

            yield {
                "db": mock_db,
                "get_dataset": mock_get_dataset,
                "redis": mock_redis,
                "build_document": mock_build_document,
                "current_user": mock_current_user,
            }

    def test_save_document_with_metadata(self, mock_dependencies):
        # Arrange
        dataset_id = str(uuid4())
        tenant_id = str(uuid4())
        account = Mock(spec=Account)
        account.id = "account-1"
        account.current_tenant_id = tenant_id

        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.built_in_field_enabled = False
        dataset.doc_form = "text_model"
        mock_dependencies["get_dataset"].return_value = dataset

        # Define metadata inputs
        metadata_id = str(uuid4())
        doc_metadata_inputs = [DocumentMetadataInput(metadata_id=metadata_id, value="custom_value")]

        # Knowledge config
        knowledge_config = KnowledgeConfig(
            data_source_type="upload_file",
            data_source=DataSource(
                info_list=InfoList(data_source_type="upload_file", file_info_list=FileInfo(file_ids=["file-1"]))
            ),
            doc_form="text_model",
            doc_language="en",
            indexing_technique="high_quality",
            enable_built_in_metadata=True,
            doc_metadata=doc_metadata_inputs,
        )

        # Mock local file for upload_file type
        with patch("services.dataset_service.db.session.query") as mock_query:
            # Mock DatasetMetadata lookup
            mock_metadata_def = Mock(spec=DatasetMetadata)
            mock_metadata_def.id = metadata_id
            mock_metadata_def.name = "custom_field"
            mock_metadata_def.field_type = "text"

            # Create a side effect for query(Model)
            def query_side_effect(*models):
                m = Mock()
                if len(models) == 1 and models[0] == DatasetMetadata:
                    m.filter.return_value.filter.return_value.first.return_value = mock_metadata_def
                    # handle the specific chain in code
                    m.filter_by.return_value.first.return_value = mock_metadata_def
                    m.filter.return_value.all.return_value = [mock_metadata_def]
                    return m
                if len(models) == 1 and models[0] == Document:
                    doc_mock = Mock()
                    doc_mock.position = 1
                    # For get_documents_position
                    m.filter_by.return_value.order_by.return_value.first.return_value = doc_mock
                    # For duplicate check
                    m.where.return_value.all.return_value = []
                    return m
                if len(models) == 1 and models[0] == UploadFile:
                    m.where.return_value.all.return_value = [Mock(id="file-1", tenant_id=tenant_id)]
                    return m
                if len(models) == 2:
                    m.filter.return_value.all.return_value = []
                    return m

                return m

            mock_query.side_effect = query_side_effect

            # Mock build_document to return a document
            mock_document = Mock(spec=Document)
            mock_document.id = "doc-123"
            mock_document.doc_metadata = {}
            mock_dependencies["build_document"].return_value = mock_document

            # Act
            DocumentService.save_document_with_dataset_id(
                dataset=dataset, knowledge_config=knowledge_config, account=account
            )

            # Assert
            # 1. Check built-in metadata enabled
            assert dataset.built_in_field_enabled is True

            # 2. Check custom metadata passed to build_document
            call_args = mock_dependencies["build_document"].call_args
            assert call_args is not None
            _, kwargs = call_args
            assert "custom_metadata" in kwargs
            assert kwargs["custom_metadata"] == {"custom_field": "custom_value"}

            # 3. Check DatasetMetadataBinding creation
            binding_instances = [
                call.args[0]
                for call in mock_dependencies["db"].add.call_args_list
                if isinstance(call.args[0], DatasetMetadataBinding)
            ]
            assert len(binding_instances) == 1
            assert binding_instances[0].document_id == "doc-123"
            assert binding_instances[0].metadata_id == metadata_id

    def test_save_duplicate_document_with_metadata_creates_binding(self, mock_dependencies):
        # Arrange
        dataset_id = str(uuid4())
        tenant_id = str(uuid4())
        account = Mock(spec=Account)
        account.id = "account-1"
        account.current_tenant_id = tenant_id

        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.built_in_field_enabled = False
        dataset.doc_form = "text_model"
        mock_dependencies["get_dataset"].return_value = dataset

        metadata_id = str(uuid4())
        knowledge_config = KnowledgeConfig(
            data_source_type="upload_file",
            data_source=DataSource(
                info_list=InfoList(data_source_type="upload_file", file_info_list=FileInfo(file_ids=["file-1"]))
            ),
            doc_form="text_model",
            doc_language="en",
            indexing_technique="high_quality",
            duplicate=True,
            doc_metadata=[DocumentMetadataInput(metadata_id=metadata_id, value="custom_value")],
        )

        existing_document = Mock(spec=Document)
        existing_document.id = "dup-doc-1"
        existing_document.name = "dup.txt"
        existing_document.doc_metadata = {"existing_field": "existing_value"}

        with patch("services.dataset_service.db.session.query") as mock_query:
            mock_metadata_def = Mock(spec=DatasetMetadata)
            mock_metadata_def.id = metadata_id
            mock_metadata_def.name = "custom_field"
            mock_metadata_def.field_type = "text"

            def query_side_effect(*models):
                m = Mock()
                if len(models) == 1 and models[0] == DatasetMetadata:
                    m.filter.return_value.all.return_value = [mock_metadata_def]
                    return m
                if len(models) == 1 and models[0] == Document:
                    doc_mock = Mock()
                    doc_mock.position = 1
                    m.filter_by.return_value.order_by.return_value.first.return_value = doc_mock
                    m.where.return_value.all.return_value = [existing_document]
                    return m
                if len(models) == 1 and models[0] == UploadFile:
                    file_mock = Mock(id="file-1", tenant_id=tenant_id)
                    file_mock.name = "dup.txt"
                    m.where.return_value.all.return_value = [file_mock]
                    return m
                if len(models) == 2:
                    m.filter.return_value.all.return_value = []
                    return m

                return m

            mock_query.side_effect = query_side_effect

            # Act
            DocumentService.save_document_with_dataset_id(
                dataset=dataset, knowledge_config=knowledge_config, account=account
            )

            # Assert
            mock_dependencies["build_document"].assert_not_called()
            assert existing_document.doc_metadata["custom_field"] == "custom_value"

            binding_instances = [
                call.args[0]
                for call in mock_dependencies["db"].add.call_args_list
                if isinstance(call.args[0], DatasetMetadataBinding)
            ]
            assert any(
                binding.document_id == existing_document.id and binding.metadata_id == metadata_id
                for binding in binding_instances
            )
