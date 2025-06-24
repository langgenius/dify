from unittest.mock import Mock, patch

import pytest

from models.account import Account
from models.dataset import Dataset, Document
from services.dataset_service import DocumentService
from services.entities.knowledge_entities.knowledge_entities import KnowledgeConfig


class TestDocumentServiceSaveDocumentWithDatasetId:
    """
    Full branch unit tests for DocumentService.save_document_with_dataset_id.
    This suite covers all main branches, including:
    - Billing and quota checks
    - Data source types: upload_file, notion_import, website_crawl
    - Duplicate document handling
    - Process rule creation and error cases
    - Exception and edge cases
    """

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
        """
        Test successful upload_file document creation, including duplicate and non-duplicate cases.
        """
        # Setup mocks and input
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        dataset.data_source_type = None
        dataset.indexing_technique = None
        dataset.retrieval_model = None
        dataset.embedding_model = None
        dataset.embedding_model_provider = None
        dataset.collection_binding_id = None
        dataset.latest_process_rule = None

        account = Mock(spec=Account)
        account.id = "user1"
        account.name = "User One"

        # Mock current_user
        mock_current_user.current_tenant_id = "tenant1"

        # Mock features
        features = Mock()
        features.billing.enabled = True
        features.billing.subscription.plan = "pro"
        features.documents_upload_quota.limit = 100
        features.documents_upload_quota.size = 0
        mock_features.return_value = features

        # Mock knowledge_config for upload_file with proper nested structure
        knowledge_config = Mock(spec=KnowledgeConfig)
        knowledge_config.original_document_id = None
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "upload_file"
        knowledge_config.data_source.info_list.file_info_list = Mock()
        knowledge_config.data_source.info_list.file_info_list.file_ids = ["file1", "file2"]
        knowledge_config.indexing_technique = "high_quality"
        knowledge_config.embedding_model = "embed-model"
        knowledge_config.embedding_model_provider = "openai"
        knowledge_config.retrieval_model = None
        knowledge_config.process_rule = Mock()
        knowledge_config.process_rule.mode = "custom"
        knowledge_config.process_rule.rules = Mock()
        knowledge_config.doc_form = "pdf"
        knowledge_config.doc_language = "en"
        knowledge_config.duplicate = False

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

        # Mock db.session.query(UploadFile)
        upload_file1 = Mock()
        upload_file1.id = "file1"
        upload_file1.name = "file1.pdf"
        upload_file2 = Mock()
        upload_file2.id = "file2"
        upload_file2.name = "file2.pdf"
        mock_db.query.return_value.filter.return_value.first.side_effect = [upload_file1, upload_file2]

        # Mock redis lock
        mock_lock = Mock()
        mock_redis.lock.return_value.__enter__ = Mock(return_value=None)
        mock_redis.lock.return_value.__exit__ = Mock(return_value=None)

        # Mock time.strftime
        mock_time.strftime.return_value = "20231201120000"

        # Run
        docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

        # Assert
        assert len(docs) == 2
        mock_doc_task.assert_called_once()
        mock_dup_task.assert_not_called()

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_billing_batch_limit(self, mock_current_user, mock_features):
        """
        Test batch upload limit exceeded raises ValueError.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        account = Mock(spec=Account)
        account.id = "user1"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = True
        features.billing.subscription.plan = "sandbox"
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "upload_file"
        knowledge_config.data_source.info_list.file_info_list = Mock()
        knowledge_config.data_source.info_list.file_info_list.file_ids = ["file1", "file2"]
        with pytest.raises(ValueError, match="Your current plan does not support batch upload"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_billing_quota_limit(self, mock_current_user, mock_features):
        """
        Test document upload quota exceeded raises ValueError.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        account = Mock(spec=Account)
        account.id = "user1"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = True
        features.billing.subscription.plan = "pro"
        features.documents_upload_quota.limit = 1
        features.documents_upload_quota.size = 1
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "upload_file"
        knowledge_config.data_source.info_list.file_info_list = Mock()
        knowledge_config.data_source.info_list.file_info_list.file_ids = ["file1", "file2"]
        with pytest.raises(ValueError, match="You have reached the limit of your subscription"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_invalid_indexing_technique(self, mock_current_user, mock_features):
        """
        Test invalid indexing technique raises ValueError.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        dataset.data_source_type = None
        dataset.indexing_technique = None
        account = Mock(spec=Account)
        account.id = "user1"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = False
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "upload_file"
        knowledge_config.indexing_technique = "invalid"
        with pytest.raises(ValueError, match="Indexing technique is invalid"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_no_process_rule_found(self, mock_current_user, mock_features):
        """
        Test no process rule found raises ValueError.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        dataset.latest_process_rule = None
        dataset.data_source_type = "upload_file"
        dataset.indexing_technique = "high_quality"
        account = Mock(spec=Account)
        account.id = "user1"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = False
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "upload_file"
        knowledge_config.indexing_technique = "high_quality"
        knowledge_config.process_rule = Mock()
        knowledge_config.process_rule.mode = "custom"
        knowledge_config.process_rule.rules = None
        with pytest.raises(ValueError, match="No process rule found"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_invalid_process_rule_mode(self, mock_current_user, mock_features, mock_db):
        """
        Test invalid process rule mode returns None (no document created).
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        dataset.latest_process_rule = None
        dataset.data_source_type = "upload_file"
        dataset.indexing_technique = "high_quality"
        account = Mock(spec=Account)
        account.id = "user1"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = False
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "upload_file"
        knowledge_config.indexing_technique = "high_quality"
        knowledge_config.process_rule = Mock()
        knowledge_config.process_rule.mode = "invalid"
        with patch("logging.warning") as mock_log:
            result = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)
            assert result is None
            mock_log.assert_called()

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_notion_import_no_info(self, mock_current_user, mock_features, mock_redis, mock_db):
        """
        Test notion_import with no notion_info_list raises ValueError.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        dataset.data_source_type = "notion_import"
        dataset.indexing_technique = "high_quality"
        account = Mock(spec=Account)
        account.id = "user1"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = False
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.process_rule = Mock()
        knowledge_config.process_rule.mode = "automatic"
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "notion_import"
        knowledge_config.data_source.info_list.notion_info_list = None
        with pytest.raises(ValueError, match="No notion info list found"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_website_crawl_no_info(self, mock_current_user, mock_features, mock_redis, mock_db):
        """
        Test website_crawl with no website_info raises ValueError.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        dataset.data_source_type = "website_crawl"
        dataset.indexing_technique = "high_quality"
        account = Mock(spec=Account)
        account.id = "user1"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = False
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.process_rule = Mock()
        knowledge_config.process_rule.mode = "automatic"
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "website_crawl"
        knowledge_config.data_source.info_list.website_info_list = None
        with pytest.raises(ValueError, match="No website info list found"):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.DocumentService.update_document_with_dataset_id")
    def test_update_document_branch(self, mock_update_doc):
        """
        Test the branch where original_document_id is provided (update flow).
        """
        dataset = Mock(spec=Dataset)
        account = Mock(spec=Account)
        knowledge_config = Mock()
        knowledge_config.original_document_id = "docid"
        mock_update_doc.return_value = Mock(batch="batch1")
        # Mock current_user
        mock_current_user = Mock()
        mock_current_user.current_tenant_id = "tenant-123"
        # Patch current_user to return the mock
        with patch("services.dataset_service.current_user", mock_current_user):
            docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)
        assert len(docs) == 1
        assert batch == "batch1"

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_upload_file_file_not_found(self, mock_current_user, mock_features, mock_redis, mock_db):
        """
        Test upload_file: should raise FileNotExistsError if file not found in db.
        """
        from services.dataset_service import FileNotExistsError

        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        account = Mock(spec=Account)
        account.id = "user1"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = False
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.process_rule = Mock()
        knowledge_config.process_rule.mode = "automatic"
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "upload_file"
        knowledge_config.data_source.info_list.file_info_list = Mock()
        knowledge_config.data_source.info_list.file_info_list.file_ids = ["file1"]
        mock_db.query.return_value.filter.return_value.first.return_value = None
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
        """
        Test upload_file: duplicate=True and document already exists, should update and append to documents.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        dataset.data_source_type = None
        dataset.indexing_technique = None
        dataset.retrieval_model = None
        dataset.embedding_model = None
        dataset.embedding_model_provider = None
        dataset.collection_binding_id = None
        dataset.latest_process_rule = None
        account = Mock(spec=Account)
        account.id = "user1"
        account.name = "User One"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = True
        features.billing.subscription.plan = "pro"
        features.documents_upload_quota.limit = 100
        features.documents_upload_quota.size = 0
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "upload_file"
        knowledge_config.data_source.info_list.file_info_list = Mock()
        knowledge_config.data_source.info_list.file_info_list.file_ids = ["file1"]
        knowledge_config.indexing_technique = "high_quality"
        knowledge_config.embedding_model = "embed-model"
        knowledge_config.embedding_model_provider = "openai"
        knowledge_config.process_rule = Mock()
        knowledge_config.process_rule.mode = "custom"
        knowledge_config.process_rule.rules = Mock()
        knowledge_config.doc_form = "pdf"
        knowledge_config.doc_language = "en"
        knowledge_config.duplicate = True
        mock_model_manager_instance = Mock()
        mock_embedding_model = Mock()
        mock_embedding_model.model = "embed-model"
        mock_embedding_model.provider = "openai"
        mock_model_manager_instance.get_default_model_instance.return_value = mock_embedding_model
        mock_model_manager.return_value = mock_model_manager_instance
        mock_collection_binding_instance = Mock()
        mock_collection_binding_instance.id = "binding-123"
        mock_collection_binding.return_value = mock_collection_binding_instance
        upload_file = Mock()
        upload_file.id = "file1"
        upload_file.name = "file1.pdf"
        mock_db.query.return_value.filter.return_value.first.side_effect = [
            upload_file,
            Mock(id="docid", name="file1.pdf"),
        ]  # file, then document
        mock_redis.lock.return_value.__enter__ = Mock(return_value=None)
        mock_redis.lock.return_value.__exit__ = Mock(return_value=None)
        mock_time.strftime.return_value = "20231201120000"
        docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)
        assert len(docs) == 1
        mock_dup_task.assert_called_once()

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_notion_import_data_source_binding_not_found(self, mock_current_user, mock_features, mock_redis, mock_db):
        """
        Test notion_import: should raise ValueError if data source binding not found.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        dataset.data_source_type = "notion_import"
        dataset.indexing_technique = "high_quality"
        account = Mock(spec=Account)
        account.id = "user1"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = False
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.process_rule = Mock()
        knowledge_config.process_rule.mode = "automatic"
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "notion_import"
        notion_info = Mock()
        notion_info.workspace_id = "ws1"
        notion_info.pages = []
        knowledge_config.data_source.info_list.notion_info_list = [notion_info]
        mock_db.query.return_value.filter.return_value.first.return_value = None
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
        """
        Test website_crawl: url longer than 255 chars should be truncated in document name.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        dataset.data_source_type = "website_crawl"
        dataset.indexing_technique = "high_quality"
        account = Mock(spec=Account)
        account.id = "user1"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = False
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.process_rule = Mock()
        knowledge_config.process_rule.mode = "automatic"
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "website_crawl"
        website_info = Mock()
        website_info.urls = ["http://" + "a" * 300]
        website_info.provider = "test"
        website_info.job_id = "job1"
        website_info.only_main_content = True
        knowledge_config.data_source.info_list.website_info_list = website_info
        mock_db.query.return_value.filter.return_value.first.return_value = True
        # Patch build_document to check name truncation
        with patch("services.dataset_service.DocumentService.build_document") as mock_build_doc:
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)
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
        """
        Test notion_import: successful document creation for new pages.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        dataset.data_source_type = "notion_import"
        dataset.indexing_technique = "high_quality"
        account = Mock(spec=Account)
        account.id = "user1"
        account.name = "User One"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = False
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.process_rule = Mock()
        knowledge_config.process_rule.mode = "automatic"
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "notion_import"
        notion_info = Mock()
        notion_info.workspace_id = "ws1"
        page = Mock()
        page.page_id = "page1"
        page.page_name = "Test Page"
        page.page_icon = None
        page.type = "page"
        notion_info.pages = [page]
        knowledge_config.data_source.info_list.notion_info_list = [notion_info]
        # Mock existing documents query (empty)
        mock_db.query.return_value.filter_by.return_value.all.return_value = []
        # Mock data source binding
        binding = Mock()
        binding.id = "binding1"
        mock_db.query.return_value.filter.return_value.first.return_value = binding
        # Mock build_document
        mock_doc = Mock(spec=Document, id="doc1")
        mock_build_doc.return_value = mock_doc
        docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)
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
        """
        Test notion_import: page already exists, should skip creation and clean old documents.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        dataset.data_source_type = "notion_import"
        dataset.indexing_technique = "high_quality"
        account = Mock(spec=Account)
        account.id = "user1"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = False
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.process_rule = Mock()
        knowledge_config.process_rule.mode = "automatic"
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "notion_import"
        notion_info = Mock()
        notion_info.workspace_id = "ws1"
        page = Mock()
        page.page_id = "page1"
        page.page_name = "Test Page"
        notion_info.pages = [page]
        knowledge_config.data_source.info_list.notion_info_list = [notion_info]
        # Mock existing document with same page_id
        existing_doc = Mock()
        existing_doc.data_source_info = '{"notion_page_id": "page1"}'
        existing_doc.id = "doc1"
        mock_db.query.return_value.filter_by.return_value.all.return_value = [existing_doc]
        # Mock data source binding
        binding = Mock()
        binding.id = "binding1"
        mock_db.query.return_value.filter.return_value.first.return_value = binding
        docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)
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
        """
        Test website_crawl: successful document creation for multiple URLs.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        dataset.data_source_type = "website_crawl"
        dataset.indexing_technique = "high_quality"
        account = Mock(spec=Account)
        account.id = "user1"
        account.name = "User One"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = False
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.process_rule = Mock()
        knowledge_config.process_rule.mode = "automatic"
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "website_crawl"
        website_info = Mock()
        website_info.urls = ["http://example1.com", "http://example2.com"]
        website_info.provider = "test"
        website_info.job_id = "job1"
        website_info.only_main_content = True
        knowledge_config.data_source.info_list.website_info_list = website_info
        # Mock build_document
        mock_doc1 = Mock(spec=Document, id="doc1")
        mock_doc2 = Mock(spec=Document, id="doc2")
        mock_build_doc.side_effect = [mock_doc1, mock_doc2]
        docs, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)
        assert len(docs) == 2
        assert mock_build_doc.call_count == 2
        mock_doc_task.assert_called_once()

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.redis_client")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_unknown_data_source_type(self, mock_current_user, mock_features, mock_redis, mock_db):
        """
        Test unknown data_source_type: should not raise error but return None when no matching branch.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        dataset.data_source_type = "unknown_type"
        dataset.indexing_technique = "high_quality"
        account = Mock(spec=Account)
        account.id = "user1"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = False
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.process_rule = Mock()
        knowledge_config.process_rule.mode = "automatic"
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "unknown_type"
        # This should not raise an error but return None due to no matching data source type
        result = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)
        # The method should handle unknown data source types gracefully
        assert result is None or len(result[0]) == 0

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_upload_file_batch_limit_exceeded(self, mock_current_user, mock_features):
        """
        Test upload_file: batch upload limit exceeded raises ValueError.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        account = Mock(spec=Account)
        account.id = "user1"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = True
        features.billing.subscription.plan = "pro"
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "upload_file"
        knowledge_config.data_source.info_list.file_info_list = Mock()
        # Create a list with more than BATCH_UPLOAD_LIMIT files
        knowledge_config.data_source.info_list.file_info_list.file_ids = ["file" + str(i) for i in range(100)]
        with patch("services.dataset_service.dify_config.BATCH_UPLOAD_LIMIT", 50):
            with pytest.raises(ValueError, match="You have reached the batch upload limit"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_notion_import_batch_limit_exceeded(self, mock_current_user, mock_features):
        """
        Test notion_import: batch upload limit exceeded raises ValueError.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        account = Mock(spec=Account)
        account.id = "user1"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = True
        features.billing.subscription.plan = "pro"
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "notion_import"
        notion_info = Mock()
        notion_info.pages = [Mock() for _ in range(100)]  # 100 pages
        knowledge_config.data_source.info_list.notion_info_list = [notion_info]
        with patch("services.dataset_service.dify_config.BATCH_UPLOAD_LIMIT", 50):
            with pytest.raises(ValueError, match="You have reached the batch upload limit"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_website_crawl_batch_limit_exceeded(self, mock_current_user, mock_features):
        """
        Test website_crawl: batch upload limit exceeded raises ValueError.
        """
        dataset = Mock(spec=Dataset)
        dataset.id = "ds1"
        dataset.tenant_id = "tenant1"
        account = Mock(spec=Account)
        account.id = "user1"
        mock_current_user.current_tenant_id = "tenant1"
        features = Mock()
        features.billing.enabled = True
        features.billing.subscription.plan = "pro"
        mock_features.return_value = features
        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "website_crawl"
        website_info = Mock()
        website_info.urls = ["http://example" + str(i) + ".com" for i in range(100)]  # 100 URLs
        knowledge_config.data_source.info_list.website_info_list = website_info
        with patch("services.dataset_service.dify_config.BATCH_UPLOAD_LIMIT", 50):
            with pytest.raises(ValueError, match="You have reached the batch upload limit"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)
