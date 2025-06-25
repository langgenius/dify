import unittest
from unittest.mock import Mock, patch

import pytest

from models.account import Account
from models.dataset import Dataset, Document
from services.dataset_service import DocumentService
from services.entities.knowledge_entities.knowledge_entities import KnowledgeConfig


class TestDocumentServiceSaveDocumentWithDatasetId(unittest.TestCase):
    """
    Comprehensive unit tests for DocumentService.save_document_with_dataset_id.

    This test suite covers all major code branches including:
    - Billing and quota validation
    - Different data source types (upload_file, notion_import, website_crawl)
    - Duplicate document handling
    - Process rule validation and error cases
    - Exception handling and edge cases
    """

    def setUp(self):
        """Set up common test fixtures and mock objects."""
        self.dataset_id = "ds1"
        self.tenant_id = "tenant1"
        self.user_id = "user1"
        self.batch_id = "batch1"

    def _create_mock_dataset(self, data_source_type=None, indexing_technique=None):
        """Create a mock Dataset object with common attributes."""
        dataset = Mock(spec=Dataset)
        dataset.id = self.dataset_id
        dataset.tenant_id = self.tenant_id
        dataset.data_source_type = data_source_type
        dataset.indexing_technique = indexing_technique
        dataset.retrieval_model = None
        dataset.embedding_model = None
        dataset.embedding_model_provider = None
        dataset.collection_binding_id = None
        dataset.latest_process_rule = None
        return dataset

    def _create_mock_account(self):
        """Create a mock Account object."""
        account = Mock(spec=Account)
        account.id = self.user_id
        account.name = "Test User"
        return account

    def _create_mock_features(self, billing_enabled=True, plan="pro", quota_limit=100, quota_size=0):
        """Create a mock features object for billing tests."""
        features = Mock()
        features.billing.enabled = billing_enabled
        if billing_enabled:
            features.billing.subscription.plan = plan
            features.documents_upload_quota.limit = quota_limit
            features.documents_upload_quota.size = quota_size
        return features

    def _create_mock_knowledge_config(
        self,
        data_source_type,
        original_document_id=None,
        file_ids=None,
        notion_pages=None,
        website_urls=None,
        indexing_technique="high_quality",
        duplicate=False,
    ):
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

        return knowledge_config

    def _setup_common_mocks(self, mock_current_user, mock_features, mock_redis=None, mock_db=None):
        """Set up common mock objects used across multiple tests."""
        mock_current_user.current_tenant_id = self.tenant_id

        if mock_redis:
            mock_lock = Mock()
            mock_redis.lock.return_value.__enter__ = Mock(return_value=None)
            mock_redis.lock.return_value.__exit__ = Mock(return_value=None)

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.time")
    @patch("services.dataset_service.secrets.randbelow", return_value=123456)
    @patch("services.dataset_service.DocumentService.build_document")
    @patch("services.dataset_service.document_indexing_task.delay")
    @patch("services.dataset_service.duplicate_document_indexing_task.delay")
    @patch("services.dataset_service.current_user")
    @patch("services.dataset_service.ModelManager")
    @patch("services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding")
    @patch("services.dataset_service.DocumentService.get_documents_position", return_value=0)
    def test_upload_file_success(
        self,
        mock_get_position,
        mock_collection_binding,
        mock_model_manager,
        mock_current_user,
        mock_dup_task,
        mock_doc_task,
        mock_build_doc,
        mock_rand,
        mock_time,
        mock_redis,
        mock_db,
        mock_features,
    ):
        """Test successful upload_file document creation with multiple files."""
        # Arrange
        dataset = self._create_mock_dataset()
        account = self._create_mock_account()
        features = self._create_mock_features()
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="upload_file", file_ids=["file1", "file2"]
        )

        self._setup_common_mocks(mock_current_user, mock_features, mock_redis, mock_db)
        mock_features.return_value = features

        # Mock ModelManager
        mock_model_manager_instance = Mock()
        mock_embedding_model = Mock()
        mock_embedding_model.model = "embed-model"
        mock_embedding_model.provider = "openai"
        mock_model_manager_instance.get_default_model_instance.return_value = mock_embedding_model
        mock_model_manager.return_value = mock_model_manager_instance

        # Mock collection binding
        mock_collection_binding_instance = Mock()
        mock_collection_binding_instance.id = "binding-123"
        mock_collection_binding.return_value = mock_collection_binding_instance

        # Mock build_document
        mock_doc1 = Mock(spec=Document, id="doc1")
        mock_doc2 = Mock(spec=Document, id="doc2")
        mock_build_doc.side_effect = [mock_doc1, mock_doc2]

        # Mock upload files
        upload_file1 = Mock()
        upload_file1.id = "file1"
        upload_file1.name = "file1.pdf"
        upload_file2 = Mock()
        upload_file2.id = "file2"
        upload_file2.name = "file2.pdf"
        mock_db.query.return_value.filter.return_value.first.side_effect = [upload_file1, upload_file2]

        # Mock time
        mock_time.strftime.return_value = "20231201120000"

        # Act
        docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

        # Assert
        assert len(docs) == 2
        mock_doc_task.assert_called_once()
        mock_dup_task.assert_not_called()

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_billing_batch_limit_exceeded(self, mock_current_user, mock_features):
        """Test that batch upload limit exceeded raises appropriate error."""
        # Arrange
        dataset = self._create_mock_dataset()
        account = self._create_mock_account()
        features = self._create_mock_features(billing_enabled=True, plan="sandbox")
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="upload_file", file_ids=["file1", "file2"]
        )

        self._setup_common_mocks(mock_current_user, mock_features)
        mock_features.return_value = features

        # Act & Assert
        with pytest.raises(ValueError, match="Your current plan does not support batch upload"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_billing_quota_limit_exceeded(self, mock_current_user, mock_features):
        """Test that document upload quota exceeded raises appropriate error."""
        # Arrange
        dataset = self._create_mock_dataset()
        account = self._create_mock_account()
        features = self._create_mock_features(billing_enabled=True, plan="pro", quota_limit=1, quota_size=1)
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="upload_file", file_ids=["file1", "file2"]
        )

        self._setup_common_mocks(mock_current_user, mock_features)
        mock_features.return_value = features

        # Act & Assert
        with pytest.raises(ValueError, match="You have reached the limit of your subscription"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_invalid_indexing_technique(self, mock_current_user, mock_features):
        """Test that invalid indexing technique raises appropriate error."""
        # Arrange
        dataset = self._create_mock_dataset()
        account = self._create_mock_account()
        features = self._create_mock_features(billing_enabled=False)
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="upload_file", indexing_technique="invalid"
        )

        self._setup_common_mocks(mock_current_user, mock_features)
        mock_features.return_value = features

        # Act & Assert
        with pytest.raises(ValueError, match="Indexing technique is invalid"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_no_process_rule_found(self, mock_current_user, mock_features):
        """Test that missing process rule raises appropriate error."""
        # Arrange
        dataset = self._create_mock_dataset(data_source_type="upload_file", indexing_technique="high_quality")
        account = self._create_mock_account()
        features = self._create_mock_features(billing_enabled=False)
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="upload_file", indexing_technique="high_quality"
        )
        knowledge_config.process_rule.rules = None

        self._setup_common_mocks(mock_current_user, mock_features)
        mock_features.return_value = features

        # Act & Assert
        with pytest.raises(ValueError, match="No process rule found"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_invalid_process_rule_mode(self, mock_current_user, mock_features, mock_db):
        """Test that invalid process rule mode returns None without creating document."""
        # Arrange
        dataset = self._create_mock_dataset(data_source_type="upload_file", indexing_technique="high_quality")
        account = self._create_mock_account()
        features = self._create_mock_features(billing_enabled=False)
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="upload_file", indexing_technique="high_quality"
        )
        knowledge_config.process_rule.mode = "invalid"

        self._setup_common_mocks(mock_current_user, mock_features)
        mock_features.return_value = features

        # Act
        with patch("logging.warning") as mock_log:
            result = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

            # Assert
            assert result is None
            mock_log.assert_called()

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_notion_import_no_info(self, mock_current_user, mock_features, mock_redis, mock_db):
        """Test that notion_import with missing notion_info_list raises appropriate error."""
        # Arrange
        dataset = self._create_mock_dataset(data_source_type="notion_import", indexing_technique="high_quality")
        account = self._create_mock_account()
        features = self._create_mock_features(billing_enabled=False)
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="notion_import", indexing_technique="high_quality"
        )
        knowledge_config.data_source.info_list.notion_info_list = None

        self._setup_common_mocks(mock_current_user, mock_features, mock_redis, mock_db)
        mock_features.return_value = features

        # Act & Assert
        with pytest.raises(ValueError, match="No notion info list found"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_website_crawl_no_info(self, mock_current_user, mock_features, mock_redis, mock_db):
        """Test that website_crawl with missing website_info raises appropriate error."""
        # Arrange
        dataset = self._create_mock_dataset(data_source_type="website_crawl", indexing_technique="high_quality")
        account = self._create_mock_account()
        features = self._create_mock_features(billing_enabled=False)
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="website_crawl", indexing_technique="high_quality"
        )
        knowledge_config.data_source.info_list.website_info_list = None

        self._setup_common_mocks(mock_current_user, mock_features, mock_redis, mock_db)
        mock_features.return_value = features

        # Act & Assert
        with pytest.raises(ValueError, match="No website info list found"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.DocumentService.update_document_with_dataset_id")
    def test_update_document_branch(self, mock_update_doc, mock_db):
        """Test the update document flow when original_document_id is provided."""
        # Arrange
        dataset = self._create_mock_dataset()
        account = self._create_mock_account()
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="upload_file", original_document_id="docid"
        )
        mock_update_doc.return_value = Mock(batch=self.batch_id)

        # Mock current_user
        mock_current_user = Mock()
        mock_current_user.current_tenant_id = self.tenant_id

        # Act
        with patch("services.dataset_service.current_user", mock_current_user):
            docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

        # Assert
        assert len(docs) == 1
        assert batch == self.batch_id

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_upload_file_file_not_found(self, mock_current_user, mock_features, mock_redis, mock_db):
        """Test that missing upload file raises FileNotExistsError."""
        # Arrange
        from services.dataset_service import FileNotExistsError

        dataset = self._create_mock_dataset()
        account = self._create_mock_account()
        features = self._create_mock_features(billing_enabled=False)
        knowledge_config = self._create_mock_knowledge_config(data_source_type="upload_file", file_ids=["file1"])

        self._setup_common_mocks(mock_current_user, mock_features, mock_redis, mock_db)
        mock_features.return_value = features
        mock_db.query.return_value.filter.return_value.first.return_value = None

        # Act & Assert
        with pytest.raises(FileNotExistsError):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.time")
    @patch("services.dataset_service.secrets.randbelow", return_value=123456)
    @patch("services.dataset_service.DocumentService.build_document")
    @patch("services.dataset_service.document_indexing_task.delay")
    @patch("services.dataset_service.duplicate_document_indexing_task.delay")
    @patch("services.dataset_service.current_user")
    @patch("services.dataset_service.ModelManager")
    @patch("services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding")
    @patch("services.dataset_service.DocumentService.get_documents_position", return_value=0)
    def test_upload_file_duplicate(
        self,
        mock_get_position,
        mock_collection_binding,
        mock_model_manager,
        mock_current_user,
        mock_dup_task,
        mock_doc_task,
        mock_build_doc,
        mock_rand,
        mock_time,
        mock_redis,
        mock_db,
        mock_features,
    ):
        """Test upload_file with duplicate=True when document already exists."""
        # Arrange
        dataset = self._create_mock_dataset()
        account = self._create_mock_account()
        features = self._create_mock_features()
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="upload_file", file_ids=["file1"], duplicate=True
        )

        self._setup_common_mocks(mock_current_user, mock_features, mock_redis, mock_db)
        mock_features.return_value = features

        # Mock ModelManager
        mock_model_manager_instance = Mock()
        mock_embedding_model = Mock()
        mock_embedding_model.model = "embed-model"
        mock_embedding_model.provider = "openai"
        mock_model_manager_instance.get_default_model_instance.return_value = mock_embedding_model
        mock_model_manager.return_value = mock_model_manager_instance

        # Mock collection binding
        mock_collection_binding_instance = Mock()
        mock_collection_binding_instance.id = "binding-123"
        mock_collection_binding.return_value = mock_collection_binding_instance

        # Mock upload file and existing document
        upload_file = Mock()
        upload_file.id = "file1"
        upload_file.name = "file1.pdf"
        existing_doc = Mock(id="docid", name="file1.pdf")
        mock_db.query.return_value.filter.return_value.first.side_effect = [upload_file, existing_doc]

        # Mock time
        mock_time.strftime.return_value = "20231201120000"

        # Act
        docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

        # Assert
        assert len(docs) == 1
        mock_dup_task.assert_called_once()

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_notion_import_data_source_binding_not_found(self, mock_current_user, mock_features, mock_redis, mock_db):
        """Test that missing data source binding for notion_import raises appropriate error."""
        # Arrange
        dataset = self._create_mock_dataset(data_source_type="notion_import", indexing_technique="high_quality")
        account = self._create_mock_account()
        features = self._create_mock_features(billing_enabled=False)

        notion_info = Mock()
        notion_info.workspace_id = "ws1"
        notion_info.pages = []
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="notion_import", indexing_technique="high_quality"
        )
        knowledge_config.data_source.info_list.notion_info_list = [notion_info]

        self._setup_common_mocks(mock_current_user, mock_features, mock_redis, mock_db)
        mock_features.return_value = features
        mock_db.query.return_value.filter.return_value.first.return_value = None

        # Act & Assert
        with pytest.raises(ValueError, match="Data source binding not found."):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    @patch("services.dataset_service.document_indexing_task.delay")
    def test_website_crawl_url_too_long(
        self, mock_document_indexing_task, mock_current_user, mock_features, mock_redis, mock_db
    ):
        """Test that long URLs are properly truncated in website_crawl document names."""
        # Arrange
        dataset = self._create_mock_dataset(data_source_type="website_crawl", indexing_technique="high_quality")
        account = self._create_mock_account()
        features = self._create_mock_features(billing_enabled=False)
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="website_crawl", website_urls=["http://" + "a" * 300]
        )

        self._setup_common_mocks(mock_current_user, mock_features, mock_redis, mock_db)
        mock_features.return_value = features
        mock_db.query.return_value.filter.return_value.first.return_value = True

        # Act
        with patch("services.dataset_service.DocumentService.build_document") as mock_build_doc:
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

            # Assert
            args, kwargs = mock_build_doc.call_args
            assert args[9].startswith("http://")
            assert len(args[9]) < 256

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    @patch("services.dataset_service.DocumentService.build_document")
    @patch("services.dataset_service.document_indexing_task.delay")
    @patch("services.dataset_service.clean_notion_document_task.delay")
    def test_notion_import_success(
        self, mock_clean_task, mock_doc_task, mock_build_doc, mock_current_user, mock_features, mock_redis, mock_db
    ):
        """Test successful notion_import document creation for new pages."""
        # Arrange
        dataset = self._create_mock_dataset(data_source_type="notion_import", indexing_technique="high_quality")
        account = self._create_mock_account()
        features = self._create_mock_features(billing_enabled=False)

        notion_info = Mock()
        notion_info.workspace_id = "ws1"
        page = Mock()
        page.page_id = "page1"
        page.page_name = "Test Page"
        page.page_icon = None
        page.type = "page"
        notion_info.pages = [page]

        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="notion_import", indexing_technique="high_quality"
        )
        knowledge_config.data_source.info_list.notion_info_list = [notion_info]

        self._setup_common_mocks(mock_current_user, mock_features, mock_redis, mock_db)
        mock_features.return_value = features

        # Mock existing documents query (empty)
        mock_db.query.return_value.filter_by.return_value.all.return_value = []

        # Mock data source binding
        binding = Mock()
        binding.id = "binding1"
        mock_db.query.return_value.filter.return_value.first.return_value = binding

        # Mock build_document
        mock_doc = Mock(spec=Document, id="doc1")
        mock_build_doc.return_value = mock_doc

        # Act
        docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

        # Assert
        assert len(docs) == 1
        mock_doc_task.assert_called_once()

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    @patch("services.dataset_service.DocumentService.build_document")
    @patch("services.dataset_service.clean_notion_document_task.delay")
    @patch("services.dataset_service.document_indexing_task.delay")
    def test_notion_import_page_exists(
        self, mock_doc_task, mock_clean_task, mock_build_doc, mock_current_user, mock_features, mock_redis, mock_db
    ):
        """Test notion_import when page already exists - should skip creation."""
        # Arrange
        dataset = self._create_mock_dataset(data_source_type="notion_import", indexing_technique="high_quality")
        account = self._create_mock_account()
        features = self._create_mock_features(billing_enabled=False)

        notion_info = Mock()
        notion_info.workspace_id = "ws1"
        page = Mock()
        page.page_id = "page1"
        page.page_name = "Test Page"
        notion_info.pages = [page]

        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="notion_import", indexing_technique="high_quality"
        )
        knowledge_config.data_source.info_list.notion_info_list = [notion_info]

        self._setup_common_mocks(mock_current_user, mock_features, mock_redis, mock_db)
        mock_features.return_value = features

        # Mock existing document with same page_id
        existing_doc = Mock()
        existing_doc.data_source_info = '{"notion_page_id": "page1"}'
        existing_doc.id = "doc1"
        mock_db.query.return_value.filter_by.return_value.all.return_value = [existing_doc]

        # Mock data source binding
        binding = Mock()
        binding.id = "binding1"
        mock_db.query.return_value.filter.return_value.first.return_value = binding

        # Act
        docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

        # Assert
        assert len(docs) == 0
        mock_clean_task.assert_not_called()

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    @patch("services.dataset_service.DocumentService.build_document")
    @patch("services.dataset_service.document_indexing_task.delay")
    def test_website_crawl_success(
        self, mock_doc_task, mock_build_doc, mock_current_user, mock_features, mock_redis, mock_db
    ):
        """Test successful website_crawl document creation for multiple URLs."""
        # Arrange
        dataset = self._create_mock_dataset(data_source_type="website_crawl", indexing_technique="high_quality")
        account = self._create_mock_account()
        features = self._create_mock_features(billing_enabled=False)
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="website_crawl", website_urls=["http://example1.com", "http://example2.com"]
        )

        self._setup_common_mocks(mock_current_user, mock_features, mock_redis, mock_db)
        mock_features.return_value = features

        # Mock build_document
        mock_doc1 = Mock(spec=Document, id="doc1")
        mock_doc2 = Mock(spec=Document, id="doc2")
        mock_build_doc.side_effect = [mock_doc1, mock_doc2]

        # Act
        docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

        # Assert
        assert len(docs) == 2
        assert mock_build_doc.call_count == 2
        mock_doc_task.assert_called_once()

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_unknown_data_source_type(self, mock_current_user, mock_features, mock_redis, mock_db):
        """Test that unknown data source type is handled gracefully."""
        # Arrange
        dataset = self._create_mock_dataset(data_source_type="unknown_type", indexing_technique="high_quality")
        account = self._create_mock_account()
        features = self._create_mock_features(billing_enabled=False)
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="unknown_type", indexing_technique="high_quality"
        )

        self._setup_common_mocks(mock_current_user, mock_features, mock_redis, mock_db)
        mock_features.return_value = features

        # Act
        result = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

        # Assert
        assert result is None or len(result[0]) == 0

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_upload_file_batch_limit_exceeded(self, mock_current_user, mock_features):
        """Test that upload_file batch limit exceeded raises appropriate error."""
        # Arrange
        dataset = self._create_mock_dataset()
        account = self._create_mock_account()
        features = self._create_mock_features()
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="upload_file", file_ids=["file" + str(i) for i in range(100)]
        )

        self._setup_common_mocks(mock_current_user, mock_features)
        mock_features.return_value = features

        # Act & Assert
        with patch("services.dataset_service.dify_config.BATCH_UPLOAD_LIMIT", 50):
            with pytest.raises(ValueError, match="You have reached the batch upload limit"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_notion_import_batch_limit_exceeded(self, mock_current_user, mock_features):
        """Test that notion_import batch limit exceeded raises appropriate error."""
        # Arrange
        dataset = self._create_mock_dataset()
        account = self._create_mock_account()
        features = self._create_mock_features()

        notion_info = Mock()
        notion_info.pages = [Mock() for _ in range(100)]  # 100 pages

        knowledge_config = self._create_mock_knowledge_config(data_source_type="notion_import")
        knowledge_config.data_source.info_list.notion_info_list = [notion_info]

        self._setup_common_mocks(mock_current_user, mock_features)
        mock_features.return_value = features

        # Act & Assert
        with patch("services.dataset_service.dify_config.BATCH_UPLOAD_LIMIT", 50):
            with pytest.raises(ValueError, match="You have reached the batch upload limit"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_website_crawl_batch_limit_exceeded(self, mock_current_user, mock_features):
        """Test that website_crawl batch limit exceeded raises appropriate error."""
        # Arrange
        dataset = self._create_mock_dataset()
        account = self._create_mock_account()
        features = self._create_mock_features()
        knowledge_config = self._create_mock_knowledge_config(
            data_source_type="website_crawl", website_urls=["http://example" + str(i) + ".com" for i in range(100)]
        )

        self._setup_common_mocks(mock_current_user, mock_features)
        mock_features.return_value = features

        # Act & Assert
        with patch("services.dataset_service.dify_config.BATCH_UPLOAD_LIMIT", 50):
            with pytest.raises(ValueError, match="You have reached the batch upload limit"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)
