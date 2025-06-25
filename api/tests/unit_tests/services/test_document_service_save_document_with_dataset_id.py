from typing import Optional
from unittest.mock import Mock, patch

import pytest

from models.account import Account
from models.dataset import Dataset, Document
from services.dataset_service import DocumentService
from services.entities.knowledge_entities.knowledge_entities import KnowledgeConfig


class DocumentSaveTestDataFactory:
    """Factory class for creating test data and mock objects for document save tests."""

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "ds1",
        tenant_id: str = "tenant1",
        data_source_type: Optional[str] = None,
        indexing_technique: Optional[str] = None,
        **kwargs,
    ) -> Mock:
        """Create a mock Dataset object with specified attributes."""
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.data_source_type = data_source_type
        dataset.indexing_technique = indexing_technique
        dataset.retrieval_model = None
        dataset.embedding_model = None
        dataset.embedding_model_provider = None
        dataset.collection_binding_id = None
        dataset.latest_process_rule = None
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_account_mock(user_id: str = "user1", name: str = "Test User") -> Mock:
        """Create a mock Account object."""
        account = Mock(spec=Account)
        account.id = user_id
        account.name = name
        return account

    @staticmethod
    def create_features_mock(
        billing_enabled: bool = True, plan: str = "pro", quota_limit: int = 100, quota_size: int = 0
    ) -> Mock:
        """Create a mock features object for billing tests."""
        features = Mock()
        features.billing.enabled = billing_enabled
        if billing_enabled:
            features.billing.subscription.plan = plan
            features.documents_upload_quota.limit = quota_limit
            features.documents_upload_quota.size = quota_size
        return features

    @staticmethod
    def create_knowledge_config_mock(
        data_source_type: str,
        original_document_id: Optional[str] = None,
        file_ids: Optional[list[str]] = None,
        notion_pages: Optional[list[Mock]] = None,
        website_urls: Optional[list[str]] = None,
        indexing_technique: str = "high_quality",
        duplicate: bool = False,
        **kwargs,
    ) -> Mock:
        """Create a mock KnowledgeConfig object with specified data source configuration."""
        knowledge_config = Mock(spec=KnowledgeConfig)
        knowledge_config.original_document_id = original_document_id
        knowledge_config.indexing_technique = indexing_technique
        knowledge_config.embedding_model = "embed-model"
        knowledge_config.embedding_model_provider = "openai"
        knowledge_config.retrieval_model = None
        knowledge_config.doc_form = "pdf"
        knowledge_config.doc_language = "en"
        knowledge_config.duplicate = duplicate

        # Set up process rule
        knowledge_config.process_rule = Mock()
        knowledge_config.process_rule.mode = "custom" if data_source_type == "upload_file" else "automatic"
        knowledge_config.process_rule.rules = Mock()

        # Set up data source info
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = data_source_type

        if data_source_type == "upload_file" and file_ids:
            knowledge_config.data_source.info_list.file_info_list = Mock()
            knowledge_config.data_source.info_list.file_info_list.file_ids = file_ids
        elif data_source_type == "notion_import" and notion_pages:
            knowledge_config.data_source.info_list.notion_info_list = notion_pages
        elif data_source_type == "website_crawl" and website_urls:
            website_info = Mock()
            website_info.urls = website_urls
            website_info.provider = "test"
            website_info.job_id = "job1"
            website_info.only_main_content = True
            knowledge_config.data_source.info_list.website_info_list = website_info

        for key, value in kwargs.items():
            setattr(knowledge_config, key, value)
        return knowledge_config

    @staticmethod
    def create_upload_file_mock(file_id: str, name: str) -> Mock:
        """Create a mock upload file."""
        upload_file = Mock()
        upload_file.id = file_id
        upload_file.name = name
        return upload_file

    @staticmethod
    def create_document_mock(document_id: str) -> Mock:
        """Create a mock Document."""
        document = Mock(spec=Document, id=document_id)
        return document

    @staticmethod
    def create_notion_page_mock(page_id: str, page_name: str, page_type: str = "page") -> Mock:
        """Create a mock Notion page."""
        page = Mock()
        page.page_id = page_id
        page.page_name = page_name
        page.page_icon = None
        page.type = page_type
        return page

    @staticmethod
    def create_notion_info_mock(workspace_id: str, pages: list[Mock]) -> Mock:
        """Create a mock Notion info."""
        notion_info = Mock()
        notion_info.workspace_id = workspace_id
        notion_info.pages = pages
        return notion_info


class TestDocumentServiceSaveDocumentWithDatasetId:
    """
    Comprehensive unit tests for DocumentService.save_document_with_dataset_id.

    This test suite covers all major code branches including:
    - Billing and quota validation
    - Different data source types (upload_file, notion_import, website_crawl)
    - Duplicate document handling
    - Process rule validation and error cases
    - Exception handling and edge cases
    - Database session operations (add and flush)
    """

    @pytest.fixture(autouse=True)
    def setup_method(self):
        """Set up common test fixtures and mock objects."""
        self.dataset_id = "ds1"
        self.tenant_id = "tenant1"
        self.user_id = "user1"
        self.batch_id = "batch1"

    @pytest.fixture
    def mock_document_service_dependencies(self):
        """Common mock setup for document service dependencies."""
        with (
            patch("services.dataset_service.FeatureService.get_features") as mock_features,
            patch("services.dataset_service.db.session") as mock_db,
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.time") as mock_time,
            patch("services.dataset_service.secrets.randbelow", return_value=123456) as mock_rand,
            patch("services.dataset_service.current_user") as mock_current_user,
        ):
            mock_current_user.current_tenant_id = self.tenant_id
            mock_time.strftime.return_value = "20231201120000"

            yield {
                "features": mock_features,
                "db_session": mock_db,
                "redis_client": mock_redis,
                "time": mock_time,
                "randbelow": mock_rand,
                "current_user": mock_current_user,
            }

    @pytest.fixture
    def mock_async_task_dependencies(self):
        """Mock setup for async task dependencies."""
        with (
            patch("services.dataset_service.DocumentService.build_document") as mock_build_doc,
            patch("services.dataset_service.document_indexing_task.delay") as mock_doc_task,
            patch("services.dataset_service.duplicate_document_indexing_task.delay") as mock_dup_task,
            patch("services.dataset_service.clean_notion_document_task.delay") as mock_clean_task,
        ):
            yield {
                "build_document": mock_build_doc,
                "document_indexing_task": mock_doc_task,
                "duplicate_document_indexing_task": mock_dup_task,
                "clean_notion_document_task": mock_clean_task,
            }

    @pytest.fixture
    def mock_model_dependencies(self):
        """Mock setup for model dependencies."""
        with (
            patch("services.dataset_service.ModelManager") as mock_model_manager,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding"
            ) as mock_collection_binding,
            patch(
                "services.dataset_service.DocumentService.get_documents_position", return_value=0
            ) as mock_get_position,
        ):
            yield {
                "model_manager": mock_model_manager,
                "collection_binding": mock_collection_binding,
                "get_position": mock_get_position,
            }

    def _setup_redis_lock(self, mock_redis):
        """Helper method to set up Redis lock."""
        mock_lock = Mock()
        mock_redis.lock.return_value.__enter__ = Mock(return_value=None)
        mock_redis.lock.return_value.__exit__ = Mock(return_value=None)

    def _assert_document_created(self, mock_db, expected_documents: list[Mock]):
        """Helper method to verify documents were created and added to session."""
        for doc in expected_documents:
            mock_db.add.assert_any_call(doc)

    def _assert_async_task_called(self, mock_task, expected_calls: int = 1):
        """Helper method to verify async task was called."""
        assert mock_task.call_count == expected_calls

    # ==================== Upload File Tests ====================

    def test_upload_file_success(
        self, mock_document_service_dependencies, mock_async_task_dependencies, mock_model_dependencies
    ):
        """Test successful upload_file document creation with multiple files."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock()
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock()
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="upload_file", file_ids=["file1", "file2"]
        )

        mock_document_service_dependencies["features"].return_value = features

        # Mock ModelManager
        mock_model_manager_instance = Mock()
        mock_embedding_model = Mock()
        mock_embedding_model.model = "embed-model"
        mock_embedding_model.provider = "openai"
        mock_model_manager_instance.get_default_model_instance.return_value = mock_embedding_model
        mock_model_dependencies["model_manager"].return_value = mock_model_manager_instance

        # Mock collection binding
        mock_collection_binding_instance = Mock()
        mock_collection_binding_instance.id = "binding-123"
        mock_model_dependencies["collection_binding"].return_value = mock_collection_binding_instance

        # Mock build_document
        mock_doc1 = DocumentSaveTestDataFactory.create_document_mock("doc1")
        mock_doc2 = DocumentSaveTestDataFactory.create_document_mock("doc2")
        mock_async_task_dependencies["build_document"].side_effect = [mock_doc1, mock_doc2]

        # Mock upload files
        upload_file1 = DocumentSaveTestDataFactory.create_upload_file_mock("file1", "file1.pdf")
        upload_file2 = DocumentSaveTestDataFactory.create_upload_file_mock("file2", "file2.pdf")
        mock_document_service_dependencies["db_session"].query.return_value.filter.return_value.first.side_effect = [
            upload_file1,
            upload_file2,
        ]

        # Act
        docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

        # Assert
        assert len(docs) == 2
        self._assert_async_task_called(mock_async_task_dependencies["document_indexing_task"])
        mock_async_task_dependencies["duplicate_document_indexing_task"].assert_not_called()

        # Verify the documents were added to session
        self._assert_document_created(mock_document_service_dependencies["db_session"], [mock_doc1, mock_doc2])

    def test_upload_file_duplicate(
        self, mock_document_service_dependencies, mock_async_task_dependencies, mock_model_dependencies
    ):
        """Test upload_file with duplicate=True when document already exists."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock()
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock()
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="upload_file", file_ids=["file1"], duplicate=True
        )

        mock_document_service_dependencies["features"].return_value = features

        # Mock ModelManager
        mock_model_manager_instance = Mock()
        mock_embedding_model = Mock()
        mock_embedding_model.model = "embed-model"
        mock_embedding_model.provider = "openai"
        mock_model_manager_instance.get_default_model_instance.return_value = mock_embedding_model
        mock_model_dependencies["model_manager"].return_value = mock_model_manager_instance

        # Mock collection binding
        mock_collection_binding_instance = Mock()
        mock_collection_binding_instance.id = "binding-123"
        mock_model_dependencies["collection_binding"].return_value = mock_collection_binding_instance

        # Mock upload file and existing document
        upload_file = DocumentSaveTestDataFactory.create_upload_file_mock("file1", "file1.pdf")
        existing_doc = DocumentSaveTestDataFactory.create_document_mock("docid")
        existing_doc.name = "file1.pdf"
        mock_document_service_dependencies[
            "db_session"
        ].query.return_value.filter.return_value.first.return_value = upload_file
        mock_document_service_dependencies[
            "db_session"
        ].query.return_value.filter_by.return_value.first.return_value = existing_doc

        # Act
        docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

        # Assert
        assert len(docs) == 1
        self._assert_async_task_called(mock_async_task_dependencies["duplicate_document_indexing_task"])

        # Verify the existing document was added to session with updated properties
        mock_document_service_dependencies["db_session"].add.assert_any_call(existing_doc)

        # Verify the document properties were updated before being added
        assert existing_doc.batch == "20231201120000223456"
        assert existing_doc.indexing_status == "waiting"
        assert existing_doc.created_from == "web"
        assert existing_doc.doc_form == "pdf"
        assert existing_doc.doc_language == "en"

    def test_upload_file_file_not_found(self, mock_document_service_dependencies):
        """Test that missing upload file raises FileNotExistsError."""
        # Arrange
        from services.dataset_service import FileNotExistsError

        dataset = DocumentSaveTestDataFactory.create_dataset_mock()
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock(billing_enabled=False)
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="upload_file", file_ids=["file1"]
        )

        mock_document_service_dependencies["features"].return_value = features
        mock_document_service_dependencies[
            "db_session"
        ].query.return_value.filter.return_value.first.return_value = None

        # Act & Assert
        with pytest.raises(FileNotExistsError):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    # ==================== Notion Import Tests ====================

    def test_notion_import_success(self, mock_document_service_dependencies, mock_async_task_dependencies):
        """Test successful notion_import document creation for new pages."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock(
            data_source_type="notion_import", indexing_technique="high_quality"
        )
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock(billing_enabled=False)

        page = DocumentSaveTestDataFactory.create_notion_page_mock("page1", "Test Page")
        notion_info = DocumentSaveTestDataFactory.create_notion_info_mock("ws1", [page])

        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="notion_import", indexing_technique="high_quality"
        )
        knowledge_config.data_source.info_list.notion_info_list = [notion_info]

        mock_document_service_dependencies["features"].return_value = features

        # Mock existing documents query (empty)
        mock_document_service_dependencies["db_session"].query.return_value.filter_by.return_value.all.return_value = []

        # Mock data source binding
        binding = Mock()
        binding.id = "binding1"
        mock_document_service_dependencies[
            "db_session"
        ].query.return_value.filter.return_value.first.return_value = binding

        # Mock build_document
        mock_doc = DocumentSaveTestDataFactory.create_document_mock("doc1")
        mock_async_task_dependencies["build_document"].return_value = mock_doc

        # Act
        docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

        # Assert
        assert len(docs) == 1
        self._assert_async_task_called(mock_async_task_dependencies["document_indexing_task"])

        # Verify the document was added to the database session
        mock_document_service_dependencies["db_session"].add.assert_called_with(mock_doc)

    def test_notion_import_page_exists(self, mock_document_service_dependencies, mock_async_task_dependencies):
        """Test notion_import when page already exists - should skip creation."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock(
            data_source_type="notion_import", indexing_technique="high_quality"
        )
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock(billing_enabled=False)

        page = DocumentSaveTestDataFactory.create_notion_page_mock("page1", "Test Page")
        notion_info = DocumentSaveTestDataFactory.create_notion_info_mock("ws1", [page])

        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="notion_import", indexing_technique="high_quality"
        )
        knowledge_config.data_source.info_list.notion_info_list = [notion_info]

        mock_document_service_dependencies["features"].return_value = features

        # Mock existing document with same page_id
        existing_doc = Mock()
        existing_doc.data_source_info = '{"notion_page_id": "page1"}'
        existing_doc.id = "doc1"
        mock_document_service_dependencies["db_session"].query.return_value.filter_by.return_value.all.return_value = [
            existing_doc
        ]

        # Mock data source binding
        binding = Mock()
        binding.id = "binding1"
        mock_document_service_dependencies[
            "db_session"
        ].query.return_value.filter.return_value.first.return_value = binding

        # Act
        docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

        # Assert
        assert len(docs) == 0
        # No document should be created since it already exists
        for call in mock_document_service_dependencies["db_session"].add.call_args_list:
            args, kwargs = call
            assert not any(isinstance(arg, Document) for arg in args), "Method was called with a Document!"

    def test_notion_import_no_info(self, mock_document_service_dependencies):
        """Test that notion_import with missing notion_info_list raises appropriate error."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock(
            data_source_type="notion_import", indexing_technique="high_quality"
        )
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock(billing_enabled=False)
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="notion_import", indexing_technique="high_quality"
        )
        knowledge_config.data_source.info_list.notion_info_list = None

        mock_document_service_dependencies["features"].return_value = features

        # Act & Assert
        with pytest.raises(ValueError, match="No notion info list found"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    def test_notion_import_data_source_binding_not_found(self, mock_document_service_dependencies):
        """Test that missing data source binding for notion_import raises appropriate error."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock(
            data_source_type="notion_import", indexing_technique="high_quality"
        )
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock(billing_enabled=False)

        notion_info = DocumentSaveTestDataFactory.create_notion_info_mock("ws1", [])
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="notion_import", indexing_technique="high_quality"
        )
        knowledge_config.data_source.info_list.notion_info_list = [notion_info]

        mock_document_service_dependencies["features"].return_value = features
        mock_document_service_dependencies[
            "db_session"
        ].query.return_value.filter.return_value.first.return_value = None

        # Act & Assert
        with pytest.raises(ValueError, match="Data source binding not found."):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    # ==================== Website Crawl Tests ====================

    def test_website_crawl_success(self, mock_document_service_dependencies, mock_async_task_dependencies):
        """Test successful website_crawl document creation for multiple URLs."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock(
            data_source_type="website_crawl", indexing_technique="high_quality"
        )
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock(billing_enabled=False)
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="website_crawl", website_urls=["http://example1.com", "http://example2.com"]
        )

        mock_document_service_dependencies["features"].return_value = features

        # Mock build_document
        mock_doc1 = DocumentSaveTestDataFactory.create_document_mock("doc1")
        mock_doc2 = DocumentSaveTestDataFactory.create_document_mock("doc2")
        mock_async_task_dependencies["build_document"].side_effect = [mock_doc1, mock_doc2]

        # Act
        docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

        # Assert
        assert len(docs) == 2
        assert mock_async_task_dependencies["build_document"].call_count == 2
        self._assert_async_task_called(mock_async_task_dependencies["document_indexing_task"])

        # Verify database session operations
        self._assert_document_created(mock_document_service_dependencies["db_session"], [mock_doc1, mock_doc2])

    def test_website_crawl_no_info(self, mock_document_service_dependencies):
        """Test that website_crawl with missing website_info raises appropriate error."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock(
            data_source_type="website_crawl", indexing_technique="high_quality"
        )
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock(billing_enabled=False)
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="website_crawl", indexing_technique="high_quality"
        )
        knowledge_config.data_source.info_list.website_info_list = None

        mock_document_service_dependencies["features"].return_value = features

        # Act & Assert
        with pytest.raises(ValueError, match="No website info list found"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    def test_website_crawl_url_too_long(self, mock_document_service_dependencies, mock_async_task_dependencies):
        """Test that long URLs are properly truncated in website_crawl document names."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock(
            data_source_type="website_crawl", indexing_technique="high_quality"
        )
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock(billing_enabled=False)
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="website_crawl", website_urls=["http://" + "a" * 300]
        )

        mock_document_service_dependencies["features"].return_value = features
        mock_document_service_dependencies[
            "db_session"
        ].query.return_value.filter.return_value.first.return_value = True

        # Act
        with patch("services.dataset_service.DocumentService.build_document") as mock_build_doc:
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

            # Assert
            args, kwargs = mock_build_doc.call_args
            assert args[9].startswith("http://")
            assert len(args[9]) < 256

    # ==================== Billing and Quota Tests ====================

    def test_billing_batch_limit_exceeded(self, mock_document_service_dependencies):
        """Test that batch upload limit exceeded raises appropriate error."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock()
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock(billing_enabled=True, plan="sandbox")
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="upload_file", file_ids=["file1", "file2"]
        )

        mock_document_service_dependencies["features"].return_value = features

        # Act & Assert
        with pytest.raises(ValueError, match="Your current plan does not support batch upload"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    def test_billing_quota_limit_exceeded(self, mock_document_service_dependencies):
        """Test that document upload quota exceeded raises appropriate error."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock()
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock(
            billing_enabled=True, plan="pro", quota_limit=1, quota_size=1
        )
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="upload_file", file_ids=["file1", "file2"]
        )

        mock_document_service_dependencies["features"].return_value = features

        # Act & Assert
        with pytest.raises(ValueError, match="You have reached the limit of your subscription"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    def test_upload_file_batch_limit_exceeded(self, mock_document_service_dependencies):
        """Test that upload_file batch limit exceeded raises appropriate error."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock()
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock()
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="upload_file", file_ids=["file" + str(i) for i in range(100)]
        )

        mock_document_service_dependencies["features"].return_value = features

        # Act & Assert
        with patch("services.dataset_service.dify_config.BATCH_UPLOAD_LIMIT", 50):
            with pytest.raises(ValueError, match="You have reached the batch upload limit"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    def test_notion_import_batch_limit_exceeded(self, mock_document_service_dependencies):
        """Test that notion_import batch limit exceeded raises appropriate error."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock()
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock()

        notion_info = DocumentSaveTestDataFactory.create_notion_info_mock("ws1", [Mock() for _ in range(100)])

        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(data_source_type="notion_import")
        knowledge_config.data_source.info_list.notion_info_list = [notion_info]

        mock_document_service_dependencies["features"].return_value = features

        # Act & Assert
        with patch("services.dataset_service.dify_config.BATCH_UPLOAD_LIMIT", 50):
            with pytest.raises(ValueError, match="You have reached the batch upload limit"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    def test_website_crawl_batch_limit_exceeded(self, mock_document_service_dependencies):
        """Test that website_crawl batch limit exceeded raises appropriate error."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock()
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock()
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="website_crawl", website_urls=["http://example" + str(i) + ".com" for i in range(100)]
        )

        mock_document_service_dependencies["features"].return_value = features

        # Act & Assert
        with patch("services.dataset_service.dify_config.BATCH_UPLOAD_LIMIT", 50):
            with pytest.raises(ValueError, match="You have reached the batch upload limit"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    # ==================== Process Rule Tests ====================

    def test_invalid_indexing_technique(self, mock_document_service_dependencies):
        """Test that invalid indexing technique raises appropriate error."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock()
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock(billing_enabled=False)
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="upload_file", indexing_technique="invalid"
        )

        mock_document_service_dependencies["features"].return_value = features

        # Act & Assert
        with pytest.raises(ValueError, match="Indexing technique is invalid"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    def test_no_process_rule_found(self, mock_document_service_dependencies):
        """Test that missing process rule raises appropriate error."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock(
            data_source_type="upload_file", indexing_technique="high_quality"
        )
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock(billing_enabled=False)
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="upload_file", indexing_technique="high_quality"
        )
        knowledge_config.process_rule.rules = None

        mock_document_service_dependencies["features"].return_value = features

        # Act & Assert
        with pytest.raises(ValueError, match="No process rule found"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    def test_invalid_process_rule_mode(self, mock_document_service_dependencies):
        """Test that invalid process rule mode returns None without creating document."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock(
            data_source_type="upload_file", indexing_technique="high_quality"
        )
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock(billing_enabled=False)
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="upload_file", indexing_technique="high_quality"
        )
        knowledge_config.process_rule.mode = "invalid"

        mock_document_service_dependencies["features"].return_value = features

        # Act
        with patch("logging.warning") as mock_log:
            result = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

            # Assert
            assert result is None
            mock_log.assert_called()

    # ==================== Update Document Tests ====================

    def test_update_document_branch(self, mock_document_service_dependencies):
        """Test the update document flow when original_document_id is provided."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock()
        account = DocumentSaveTestDataFactory.create_account_mock()
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="upload_file", original_document_id="docid"
        )

        with patch("services.dataset_service.DocumentService.update_document_with_dataset_id") as mock_update_doc:
            mock_update_doc.return_value = Mock(batch=self.batch_id)

            # Act
            docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

            # Assert
            assert len(docs) == 1
            assert batch == self.batch_id

    # ==================== Edge Case Tests ====================

    def test_unknown_data_source_type(self, mock_document_service_dependencies):
        """Test that unknown data source type is handled gracefully."""
        # Arrange
        dataset = DocumentSaveTestDataFactory.create_dataset_mock(
            data_source_type="unknown_type", indexing_technique="high_quality"
        )
        account = DocumentSaveTestDataFactory.create_account_mock()
        features = DocumentSaveTestDataFactory.create_features_mock(billing_enabled=False)
        knowledge_config = DocumentSaveTestDataFactory.create_knowledge_config_mock(
            data_source_type="unknown_type", indexing_technique="high_quality"
        )

        mock_document_service_dependencies["features"].return_value = features

        # Act
        result = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

        # Assert
        assert result is None or len(result[0]) == 0
