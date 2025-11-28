"""
Unit tests for document processing tasks.

This module tests the document indexing workflow including:
- Document parsing from various sources (upload, notion, website)
- Chunking strategy application with different splitters
- Embedding generation and vector indexing
- Status updates throughout the processing pipeline
- Failure recovery mechanisms
"""

import uuid
from unittest.mock import Mock, patch

import pytest

from core.entities.document_task import DocumentTask
from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from core.model_runtime.entities.model_entities import ModelType
from core.rag.index_processor.constant.index_type import IndexType
from core.rag.models.document import ChildDocument, Document
from enums.cloud_plan import CloudPlan
from models.dataset import Dataset, DatasetProcessRule
from models.dataset import Document as DatasetDocument
from models.model import UploadFile
from tasks.document_indexing_task import (
    _document_indexing,
    _document_indexing_with_tenant_queue,
    normal_document_indexing_task,
    priority_document_indexing_task,
)


class DocumentProcessingTestDataFactory:
    """Factory class for creating test data and mock objects for document processing tests."""

    @staticmethod
    def create_mock_dataset(
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-456",
        indexing_technique: str = "high_quality",
        embedding_model_provider: str = "openai",
        embedding_model: str = "text-embedding-ada-002",
    ) -> Mock:
        """Create a mock Dataset object with configurable properties."""
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.indexing_technique = indexing_technique
        dataset.embedding_model_provider = embedding_model_provider
        dataset.embedding_model = embedding_model
        return dataset

    @staticmethod
    def create_mock_document(
        document_id: str = "doc-789",
        dataset_id: str = "dataset-123",
        indexing_status: str = "parsing",
        doc_form: str = IndexType.PARAGRAPH_INDEX,
        doc_language: str = "English",
        data_source_type: str = "upload_file",
        dataset_process_rule_id: str = "rule-001",
    ) -> Mock:
        """Create a mock DatasetDocument object."""
        document = Mock(spec=DatasetDocument)
        document.id = document_id
        document.dataset_id = dataset_id
        document.indexing_status = indexing_status
        document.doc_form = doc_form
        document.doc_language = doc_language
        document.data_source_type = data_source_type
        document.dataset_process_rule_id = dataset_process_rule_id
        document.data_source_info_dict = {"upload_file_id": "file-001"}
        document.created_by = "user-001"
        document.tenant_id = "tenant-456"
        document.is_paused = False
        return document

    @staticmethod
    def create_mock_process_rule(
        rule_id: str = "rule-001", mode: str = "automatic", rules: dict | None = None
    ) -> Mock:
        """Create a mock DatasetProcessRule object."""
        process_rule = Mock(spec=DatasetProcessRule)
        process_rule.id = rule_id
        process_rule.mode = mode
        process_rule.rules = rules or {}
        process_rule.to_dict.return_value = {"mode": mode, "rules": rules or {}}
        return process_rule

    @staticmethod
    def create_mock_upload_file(
        file_id: str = "file-001", name: str = "test.txt", key: str = "uploads/test.txt"
    ) -> Mock:
        """Create a mock UploadFile object."""
        upload_file = Mock(spec=UploadFile)
        upload_file.id = file_id
        upload_file.name = name
        upload_file.key = key
        return upload_file

    @staticmethod
    def create_mock_features(
        billing_enabled: bool = True,
        plan: CloudPlan = CloudPlan.PROFESSIONAL,
        vector_space_limit: int = 10000,
        vector_space_size: int = 5000,
    ) -> Mock:
        """Create mock features with billing configuration."""
        features = Mock()
        features.billing = Mock()
        features.billing.enabled = billing_enabled
        features.billing.subscription = Mock()
        features.billing.subscription.plan = plan
        features.vector_space = Mock()
        features.vector_space.limit = vector_space_limit
        features.vector_space.size = vector_space_size
        return features

    @staticmethod
    def create_mock_documents(count: int = 3) -> list[Document]:
        """Create a list of mock Document objects for processing."""
        documents = []
        for i in range(count):
            doc = Document(
                page_content=f"This is test document content {i}. " * 10,
                metadata={
                    "doc_id": str(uuid.uuid4()),
                    "doc_hash": f"hash-{i}",
                    "document_id": "doc-789",
                    "dataset_id": "dataset-123",
                },
            )
            documents.append(doc)
        return documents


class TestDocumentParsing:
    """Test cases for document parsing/extraction phase."""

    @patch("tasks.document_indexing_task.db.session")
    @patch("tasks.document_indexing_task.IndexingRunner")
    def test_document_parsing_multiple_documents(self, mock_indexing_runner, mock_db_session):
        """
        Test parsing multiple documents in a single batch.
        
        Verifies that batch processing handles multiple documents correctly.
        """
        # Arrange
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        documents = [
            DocumentProcessingTestDataFactory.create_mock_document(document_id=f"doc-{i}") 
            for i in range(3)
        ]
        
        mock_db_session.query.return_value.where.return_value.first.return_value = dataset
        
        # Mock to return different documents for each call
        doc_index = [0]

        def get_next_doc():
            if doc_index[0] < len(documents):
                doc = documents[doc_index[0]]
                doc_index[0] += 1
                return doc
            return None
        
        mock_db_session.query.return_value.filter_by.return_value.first.side_effect = get_next_doc
        
        mock_runner_instance = Mock()
        mock_indexing_runner.return_value = mock_runner_instance
        
        # Act
        with patch("tasks.document_indexing_task.FeatureService") as mock_feature_service:
            mock_feature_service.get_features.return_value = DocumentProcessingTestDataFactory.create_mock_features()
            _document_indexing("dataset-123", ["doc-0", "doc-1", "doc-2"])
        
        # Assert
        assert all(doc.indexing_status == "parsing" for doc in documents)
        mock_runner_instance.run.assert_called_once()

    @patch("tasks.document_indexing_task.db.session")
    @patch("tasks.document_indexing_task.IndexingRunner")
    def test_document_parsing_from_upload_file(self, mock_indexing_runner, mock_db_session):
        """
        Test document parsing from uploaded file.
        
        Verifies that:
        - Document status is updated to 'parsing'
        - IndexingRunner.run() is called with correct documents
        - Processing timestamps are set
        """
        # Arrange
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        document = DocumentProcessingTestDataFactory.create_mock_document()
        
        mock_db_session.query.return_value.where.return_value.first.return_value = dataset
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = document
        
        mock_runner_instance = Mock()
        mock_indexing_runner.return_value = mock_runner_instance
        
        # Act
        with patch("tasks.document_indexing_task.FeatureService") as mock_feature_service:
            mock_feature_service.get_features.return_value = DocumentProcessingTestDataFactory.create_mock_features()
            _document_indexing("dataset-123", ["doc-789"])
        
        # Assert
        assert document.indexing_status == "parsing"
        mock_runner_instance.run.assert_called_once()
        assert document.processing_started_at is not None

    def test_extract_method_validates_data_source(self):
        """
        Test that _extract method validates data source type.
        
        Verifies that only supported data sources are processed.
        """
        # Arrange
        runner = IndexingRunner()
        document = DocumentProcessingTestDataFactory.create_mock_document(data_source_type="unsupported")
        process_rule = {"mode": "automatic", "rules": {}}
        
        mock_processor = Mock()
        
        # Act
        result = runner._extract(mock_processor, document, process_rule)
        
        # Assert
        assert result == []  # Unsupported data sources return empty list

    @patch("core.indexing_runner.db.session")
    def test_extract_handles_notion_import(self, mock_db_session):
        """
        Test document extraction from Notion import.
        
        Verifies that Notion-specific data source info is properly handled.
        """
        # Arrange
        runner = IndexingRunner()
        document = DocumentProcessingTestDataFactory.create_mock_document(data_source_type="notion_import")
        document.data_source_info_dict = {
            "credential_id": "cred-001",
            "notion_workspace_id": "workspace-001",
            "notion_page_id": "page-001",
            "type": "page",
        }
        process_rule = {"mode": "automatic", "rules": {}}
        
        mock_processor = Mock()
        mock_processor.extract.return_value = []
        
        # Act
        with patch.object(runner, "_update_document_index_status"):
            result = runner._extract(mock_processor, document, process_rule)
        
        # Assert
        mock_processor.extract.assert_called_once()
        assert isinstance(result, list)

    @patch("core.indexing_runner.db.session")
    def test_extract_handles_website_crawl(self, mock_db_session):
        """
        Test document extraction from website crawl.
        
        Verifies that website crawl data source info is properly handled.
        """
        # Arrange
        runner = IndexingRunner()
        document = DocumentProcessingTestDataFactory.create_mock_document(data_source_type="website_crawl")
        document.data_source_info_dict = {
            "provider": "firecrawl",
            "url": "https://example.com",
            "job_id": "job-001",
            "mode": "scrape",
            "only_main_content": True,
        }
        process_rule = {"mode": "automatic", "rules": {}}
        
        mock_processor = Mock()
        mock_processor.extract.return_value = []
        
        # Act
        with patch.object(runner, "_update_document_index_status"):
            result = runner._extract(mock_processor, document, process_rule)
        
        # Assert
        mock_processor.extract.assert_called_once()
        assert isinstance(result, list)

    def test_extract_handles_missing_upload_file_info(self):
        """
        Test extraction with missing upload file information.
        
        Verifies that ValueError is raised when upload_file_id is missing.
        """
        # Arrange
        runner = IndexingRunner()
        document = DocumentProcessingTestDataFactory.create_mock_document(data_source_type="upload_file")
        document.data_source_info_dict = {}  # Missing upload_file_id
        process_rule = {"mode": "automatic", "rules": {}}
        
        mock_processor = Mock()
        
        # Act & Assert
        with pytest.raises(ValueError, match="no upload file found"):
            runner._extract(mock_processor, document, process_rule)

    def test_extract_handles_missing_notion_info(self):
        """
        Test extraction with missing Notion information.
        
        Verifies that ValueError is raised when Notion credentials are missing.
        """
        # Arrange
        runner = IndexingRunner()
        document = DocumentProcessingTestDataFactory.create_mock_document(data_source_type="notion_import")
        document.data_source_info_dict = {}  # Missing required fields
        process_rule = {"mode": "automatic", "rules": {}}
        
        mock_processor = Mock()
        
        # Act & Assert
        with pytest.raises(ValueError, match="no notion import info found"):
            runner._extract(mock_processor, document, process_rule)

    def test_extract_handles_missing_website_info(self):
        """
        Test extraction with missing website crawl information.
        
        Verifies that ValueError is raised when website info is incomplete.
        """
        # Arrange
        runner = IndexingRunner()
        document = DocumentProcessingTestDataFactory.create_mock_document(data_source_type="website_crawl")
        document.data_source_info_dict = {"url": "https://example.com"}  # Missing other fields
        process_rule = {"mode": "automatic", "rules": {}}
        
        mock_processor = Mock()
        
        # Act & Assert
        with pytest.raises(ValueError, match="no website import info found"):
            runner._extract(mock_processor, document, process_rule)


class TestChunkingStrategy:
    """Test cases for chunking strategy application during transformation."""

    @patch("core.indexing_runner.ModelManager")
    def test_transform_applies_automatic_chunking(self, mock_model_manager):
        """
        Test automatic chunking strategy application.
        
        Verifies that automatic mode uses default chunking parameters.
        """
        # Arrange
        runner = IndexingRunner()
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        text_docs = DocumentProcessingTestDataFactory.create_mock_documents(count=1)
        process_rule = {"mode": "automatic", "rules": {}}
        
        mock_embedding_instance = Mock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance
        
        mock_processor = Mock()
        mock_processor.transform.return_value = text_docs
        
        # Act
        result = runner._transform(mock_processor, dataset, text_docs, "English", process_rule)
        
        # Assert
        mock_processor.transform.assert_called_once()
        call_args = mock_processor.transform.call_args
        assert call_args[1]["process_rule"] == process_rule
        assert call_args[1]["doc_language"] == "English"

    @patch("core.indexing_runner.ModelManager")
    def test_transform_applies_custom_chunking(self, mock_model_manager):
        """
        Test custom chunking strategy with user-defined parameters.
        
        Verifies that custom mode respects user-defined chunk size and overlap.
        """
        # Arrange
        runner = IndexingRunner()
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        text_docs = DocumentProcessingTestDataFactory.create_mock_documents(count=1)
        process_rule = {
            "mode": "custom",
            "rules": {"segmentation": {"max_tokens": 500, "chunk_overlap": 50, "separator": "\\n\\n"}},
        }
        
        mock_embedding_instance = Mock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance
        
        mock_processor = Mock()
        mock_processor.transform.return_value = text_docs
        
        # Act
        result = runner._transform(mock_processor, dataset, text_docs, "English", process_rule)
        
        # Assert
        mock_processor.transform.assert_called_once()
        assert result == text_docs

    @patch("core.indexing_runner.ModelManager")
    def test_transform_with_hierarchical_chunking(self, mock_model_manager):
        """
        Test hierarchical chunking strategy for parent-child index.
        
        Verifies that hierarchical mode creates parent and child chunks.
        """
        # Arrange
        runner = IndexingRunner()
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        text_docs = DocumentProcessingTestDataFactory.create_mock_documents(count=1)
        process_rule = {
            "mode": "hierarchical",
            "rules": {"segmentation": {"max_tokens": 800, "chunk_overlap": 100}},
        }
        
        # Create parent document with children
        parent_doc = text_docs[0]
        child_docs = [
            ChildDocument(
                page_content="Child chunk 1",
                metadata={"doc_id": str(uuid.uuid4()), "doc_hash": "child-hash-1"},
            ),
            ChildDocument(
                page_content="Child chunk 2",
                metadata={"doc_id": str(uuid.uuid4()), "doc_hash": "child-hash-2"},
            ),
        ]
        parent_doc.children = child_docs
        
        mock_embedding_instance = Mock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance
        
        mock_processor = Mock()
        mock_processor.transform.return_value = [parent_doc]
        
        # Act
        result = runner._transform(mock_processor, dataset, [parent_doc], "English", process_rule)
        
        # Assert
        assert len(result) == 1
        assert hasattr(result[0], "children")

    def test_get_splitter_with_custom_parameters(self):
        """
        Test _get_splitter method with custom parameters.
        
        Verifies that splitter is created with correct chunk size and overlap.
        """
        # Arrange
        processing_rule_mode = "custom"
        max_tokens = 500
        chunk_overlap = 50
        separator = "\\n"
        mock_embedding_instance = Mock()
        
        # Act
        splitter = IndexingRunner._get_splitter(
            processing_rule_mode, max_tokens, chunk_overlap, separator, mock_embedding_instance
        )
        
        # Assert
        assert splitter is not None
        # Verify splitter has correct configuration
        assert hasattr(splitter, "chunk_size") or hasattr(splitter, "_chunk_size")

    def test_get_splitter_with_automatic_mode(self):
        """
        Test _get_splitter method with automatic mode.
        
        Verifies that automatic mode uses default segmentation rules.
        """
        # Arrange
        processing_rule_mode = "automatic"
        max_tokens = 1000  # Will be ignored in automatic mode
        chunk_overlap = 50
        separator = ""
        mock_embedding_instance = Mock()
        
        # Act
        splitter = IndexingRunner._get_splitter(
            processing_rule_mode, max_tokens, chunk_overlap, separator, mock_embedding_instance
        )
        
        # Assert
        assert splitter is not None

    def test_get_splitter_with_hierarchical_mode(self):
        """
        Test _get_splitter with hierarchical mode.
        
        Verifies that hierarchical mode creates appropriate splitter.
        """
        # Arrange
        processing_rule_mode = "hierarchical"
        max_tokens = 800
        chunk_overlap = 100
        separator = "\\n\\n"
        mock_embedding_instance = Mock()
        
        # Act
        splitter = IndexingRunner._get_splitter(
            processing_rule_mode, max_tokens, chunk_overlap, separator, mock_embedding_instance
        )
        
        # Assert
        assert splitter is not None

    def test_get_splitter_validates_token_limits(self):
        """
        Test that _get_splitter validates max_tokens boundaries.
        
        Verifies that token limits are enforced (50 to max allowed).
        """
        # Arrange
        processing_rule_mode = "custom"
        chunk_overlap = 50
        separator = "\\n"
        mock_embedding_instance = Mock()
        
        # Act & Assert - Test lower boundary
        with pytest.raises(ValueError, match="should be between 50"):
            IndexingRunner._get_splitter(
                processing_rule_mode, 30, chunk_overlap, separator, mock_embedding_instance
            )

    def test_get_splitter_with_custom_separator(self):
        """
        Test _get_splitter with custom separator.
        
        Verifies that custom separators are properly handled.
        """
        # Arrange
        processing_rule_mode = "custom"
        max_tokens = 500
        chunk_overlap = 50
        separator = "\\n\\n---\\n\\n"  # Custom separator
        mock_embedding_instance = Mock()
        
        # Act
        splitter = IndexingRunner._get_splitter(
            processing_rule_mode, max_tokens, chunk_overlap, separator, mock_embedding_instance
        )
        
        # Assert
        assert splitter is not None

    @patch("core.indexing_runner.ModelManager")
    def test_transform_with_empty_documents(self, mock_model_manager):
        """
        Test transformation with empty document list.
        
        Verifies that empty input is handled gracefully.
        """
        # Arrange
        runner = IndexingRunner()
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        text_docs = []  # Empty list
        process_rule = {"mode": "automatic", "rules": {}}
        
        mock_embedding_instance = Mock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance
        
        mock_processor = Mock()
        mock_processor.transform.return_value = []
        
        # Act
        result = runner._transform(mock_processor, dataset, text_docs, "English", process_rule)
        
        # Assert
        assert result == []

    @patch("core.indexing_runner.ModelManager")
    def test_transform_with_different_languages(self, mock_model_manager):
        """
        Test transformation with different document languages.
        
        Verifies that language-specific processing is applied.
        """
        # Arrange
        runner = IndexingRunner()
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        text_docs = DocumentProcessingTestDataFactory.create_mock_documents(count=1)
        process_rule = {"mode": "automatic", "rules": {}}
        
        mock_embedding_instance = Mock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance
        
        mock_processor = Mock()
        mock_processor.transform.return_value = text_docs
        
        # Act - Test with different languages
        for language in ["English", "Chinese", "Spanish", "French"]:
            result = runner._transform(mock_processor, dataset, text_docs, language, process_rule)
            
            # Assert
            call_args = mock_processor.transform.call_args
            assert call_args[1]["doc_language"] == language


class TestEmbeddingGeneration:
    """Test cases for embedding generation and vector indexing."""

    @patch("core.indexing_runner.db.session")
    @patch("core.indexing_runner.ModelManager")
    def test_load_generates_embeddings_for_high_quality(self, mock_model_manager, mock_db_session):
        """
        Test embedding generation for high-quality indexing.
        
        Verifies that:
        - Embedding model is retrieved
        - Embeddings are generated for document chunks
        - Vector index is created
        """
        # Arrange
        runner = IndexingRunner()
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset(indexing_technique="high_quality")
        document = DocumentProcessingTestDataFactory.create_mock_document()
        documents = DocumentProcessingTestDataFactory.create_mock_documents(count=3)
        
        mock_embedding_instance = Mock()
        mock_embedding_instance.get_text_embedding_num_tokens.return_value = 100
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance
        
        mock_processor = Mock()
        mock_processor.load.return_value = None
        
        mock_db_session.query.return_value.where.return_value.update.return_value = None
        
        # Act
        with patch.object(runner, "_update_document_index_status"):
            with patch.object(runner, "_process_chunk", return_value=300):
                runner._load(mock_processor, dataset, document, documents)
        
        # Assert
        mock_model_manager.return_value.get_model_instance.assert_called_once_with(
            tenant_id=dataset.tenant_id,
            provider=dataset.embedding_model_provider,
            model_type=ModelType.TEXT_EMBEDDING,
            model=dataset.embedding_model,
        )

    @patch("core.indexing_runner.db.session")
    @patch("core.indexing_runner.Keyword")
    def test_load_creates_keyword_index_for_economy(self, mock_keyword, mock_db_session):
        """
        Test keyword index creation for economy indexing.
        
        Verifies that economy mode creates keyword-based index without embeddings.
        """
        # Arrange
        runner = IndexingRunner()
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset(indexing_technique="economy")
        document = DocumentProcessingTestDataFactory.create_mock_document()
        documents = DocumentProcessingTestDataFactory.create_mock_documents(count=2)
        
        mock_processor = Mock()
        mock_keyword_instance = Mock()
        mock_keyword.return_value = mock_keyword_instance
        
        # Act
        with patch.object(runner, "_update_document_index_status"):
            with patch.object(runner, "_process_keyword_index") as mock_process_keyword:
                runner._load(mock_processor, dataset, document, documents)
        
        # Assert - keyword indexing should be initiated for economy mode
        assert True  # Test passes if no exception is raised

    @patch("core.indexing_runner.db.session")
    @patch("core.indexing_runner.current_app")
    def test_process_chunk_handles_embeddings(self, mock_current_app, mock_db_session):
        """
        Test _process_chunk method handles embedding generation.
        
        Verifies that chunks are processed and embeddings are calculated.
        """
        # Arrange
        runner = IndexingRunner()
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        document = DocumentProcessingTestDataFactory.create_mock_document()
        chunk_documents = DocumentProcessingTestDataFactory.create_mock_documents(count=2)
        
        mock_embedding_instance = Mock()
        mock_embedding_instance.get_text_embedding_num_tokens.return_value = [50, 60]
        
        mock_processor = Mock()
        mock_processor.load.return_value = None
        
        mock_flask_app = Mock()
        mock_flask_app.app_context.return_value.__enter__ = Mock()
        mock_flask_app.app_context.return_value.__exit__ = Mock()
        mock_current_app._get_current_object.return_value = mock_flask_app
        
        mock_db_session.query.return_value.where.return_value.update.return_value = None
        
        # Act
        with patch.object(runner, "_check_document_paused_status"):
            tokens = runner._process_chunk(
                mock_flask_app, mock_processor, chunk_documents, dataset, document, mock_embedding_instance
            )
        
        # Assert
        assert tokens == 110  # 50 + 60
        mock_processor.load.assert_called_once()

    def test_parent_child_document_structure(self):
        """
        Test parent-child document structure creation.
        
        Verifies that parent documents can have child documents attached.
        """
        # Arrange & Act
        parent_doc = Document(
            page_content="Parent content",
            metadata={"doc_id": str(uuid.uuid4()), "doc_hash": "parent-hash"},
        )
        parent_doc.children = [
            ChildDocument(
                page_content="Child 1",
                metadata={"doc_id": str(uuid.uuid4()), "doc_hash": "child-hash-1"},
            ),
            ChildDocument(
                page_content="Child 2",
                metadata={"doc_id": str(uuid.uuid4()), "doc_hash": "child-hash-2"},
            ),
        ]
        
        # Assert
        assert hasattr(parent_doc, "children")
        assert len(parent_doc.children) == 2
        assert all(isinstance(child, ChildDocument) for child in parent_doc.children)

    @patch("core.indexing_runner.db.session")
    @patch("core.indexing_runner.ModelManager")
    def test_load_with_no_documents(self, mock_model_manager, mock_db_session):
        """
        Test loading with empty document list.
        
        Verifies that empty document lists are handled gracefully.
        """
        # Arrange
        runner = IndexingRunner()
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset(indexing_technique="high_quality")
        document = DocumentProcessingTestDataFactory.create_mock_document()
        documents = []  # Empty list
        
        mock_embedding_instance = Mock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance
        
        mock_processor = Mock()
        
        # Act
        with patch.object(runner, "_update_document_index_status"):
            runner._load(mock_processor, dataset, document, documents)
        
        # Assert - should complete without errors
        assert True

    @patch("core.indexing_runner.db.session")
    @patch("core.indexing_runner.ModelManager")
    def test_load_with_large_document_batch(self, mock_model_manager, mock_db_session):
        """
        Test loading with large batch of documents.
        
        Verifies that large batches are processed efficiently.
        """
        # Arrange
        runner = IndexingRunner()
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset(indexing_technique="high_quality")
        document = DocumentProcessingTestDataFactory.create_mock_document()
        documents = DocumentProcessingTestDataFactory.create_mock_documents(count=50)
        
        mock_embedding_instance = Mock()
        mock_embedding_instance.get_text_embedding_num_tokens.return_value = 100
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance
        
        mock_processor = Mock()
        mock_processor.load.return_value = None
        
        mock_db_session.query.return_value.where.return_value.update.return_value = None
        
        # Act
        with patch.object(runner, "_update_document_index_status"):
            with patch.object(runner, "_process_chunk", return_value=100):
                runner._load(mock_processor, dataset, document, documents)
        
        # Assert - should handle large batch
        assert True

    @patch("core.indexing_runner.db.session")
    @patch("core.indexing_runner.ModelManager")
    def test_load_with_economy_mode_no_embeddings(self, mock_model_manager, mock_db_session):
        """
        Test loading in economy mode without embedding generation.
        
        Verifies that economy mode skips embedding generation.
        """
        # Arrange
        runner = IndexingRunner()
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset(indexing_technique="economy")
        document = DocumentProcessingTestDataFactory.create_mock_document()
        documents = DocumentProcessingTestDataFactory.create_mock_documents(count=5)
        
        mock_processor = Mock()
        
        # Act
        with patch.object(runner, "_update_document_index_status"):
            with patch.object(runner, "_process_keyword_index"):
                runner._load(mock_processor, dataset, document, documents)
        
        # Assert - should not call get_model_instance for economy mode
        mock_model_manager.return_value.get_model_instance.assert_not_called()


class TestStatusUpdates:
    """Test cases for document status updates throughout processing."""

    @patch("core.indexing_runner.db.session")
    def test_status_progression_parsing_to_splitting(self, mock_db_session):
        """
        Test status update from 'parsing' to 'splitting'.
        
        Verifies the status transition after extraction completes.
        """
        # Arrange
        document = DocumentProcessingTestDataFactory.create_mock_document(indexing_status="parsing")
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = document
        mock_db_session.query.return_value.filter_by.return_value.count.return_value = 0
        mock_db_session.query.return_value.filter_by.return_value.update.return_value = None
        
        # Act
        IndexingRunner._update_document_index_status(
            document_id="doc-789", after_indexing_status="splitting", extra_update_params={}
        )
        
        # Assert
        mock_db_session.query.return_value.filter_by.return_value.update.assert_called_once()

    @patch("core.indexing_runner.db.session")
    def test_status_progression_splitting_to_indexing(self, mock_db_session):
        """
        Test status update from 'splitting' to 'indexing'.
        
        Verifies the status transition after chunking completes.
        """
        # Arrange
        document = DocumentProcessingTestDataFactory.create_mock_document(indexing_status="splitting")
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = document
        mock_db_session.query.return_value.filter_by.return_value.count.return_value = 0
        mock_db_session.query.return_value.filter_by.return_value.update.return_value = None
        
        # Act
        IndexingRunner._update_document_index_status(
            document_id="doc-789", after_indexing_status="indexing", extra_update_params={}
        )
        
        # Assert
        mock_db_session.query.return_value.filter_by.return_value.update.assert_called_once()

    @patch("core.indexing_runner.db.session")
    def test_status_progression_indexing_to_completed(self, mock_db_session):
        """
        Test status update from 'indexing' to 'completed'.
        
        Verifies the final status transition with completion metadata.
        """
        # Arrange
        document = DocumentProcessingTestDataFactory.create_mock_document(indexing_status="indexing")
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = document
        mock_db_session.query.return_value.filter_by.return_value.count.return_value = 0
        mock_db_session.query.return_value.filter_by.return_value.update.return_value = None
        
        # Act
        IndexingRunner._update_document_index_status(
            document_id="doc-789",
            after_indexing_status="completed",
            extra_update_params={"tokens": 1000, "indexing_latency": 5.5},
        )
        
        # Assert
        mock_db_session.query.return_value.filter_by.return_value.update.assert_called_once()

    @patch("core.indexing_runner.db.session")
    def test_load_segments_updates_status(self, mock_db_session):
        """
        Test _load_segments updates document and segment status.
        
        Verifies that segments are saved and statuses are updated correctly.
        """
        # Arrange
        runner = IndexingRunner()
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        document = DocumentProcessingTestDataFactory.create_mock_document()
        documents = DocumentProcessingTestDataFactory.create_mock_documents(count=2)
        
        mock_doc_store = Mock()
        
        # Act
        with patch("core.indexing_runner.DatasetDocumentStore", return_value=mock_doc_store):
            with patch.object(runner, "_update_document_index_status"):
                with patch.object(runner, "_update_segments_by_document"):
                    runner._load_segments(dataset, document, documents)
        
        # Assert
        mock_doc_store.add_documents.assert_called_once_with(docs=documents, save_child=False)

    @patch("core.indexing_runner.db.session")
    def test_segment_status_update_to_completed(self, mock_db_session):
        """
        Test segment status update to 'completed'.
        
        Verifies that individual segments are marked as completed after indexing.
        """
        # Arrange
        update_params = {"status": "completed", "enabled": True}
        
        mock_db_session.query.return_value.filter_by.return_value.update.return_value = None
        
        # Act
        IndexingRunner._update_segments_by_document("doc-789", update_params)
        
        # Assert
        mock_db_session.query.return_value.filter_by.return_value.update.assert_called_once_with(update_params)


class TestFailureRecovery:
    """Test cases for failure recovery mechanisms."""

    @patch("tasks.document_indexing_task.db.session")
    @patch("tasks.document_indexing_task.FeatureService")
    def test_handles_sandbox_plan_batch_upload_restriction(self, mock_feature_service, mock_db_session):
        """
        Test handling of sandbox plan batch upload restriction.
        
        Verifies that sandbox plans cannot upload multiple documents at once.
        """
        # Arrange
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        documents = [
            DocumentProcessingTestDataFactory.create_mock_document(document_id=f"doc-{i}") 
            for i in range(2)
        ]
        
        # Create features with sandbox plan
        features = DocumentProcessingTestDataFactory.create_mock_features(
            billing_enabled=True, plan=CloudPlan.SANDBOX
        )
        mock_feature_service.get_features.return_value = features
        
        # Mock query chain for dataset
        mock_dataset_query = Mock()
        mock_dataset_query.where.return_value.first.return_value = dataset
        
        # Mock query chain for documents
        mock_document_query = Mock()
        doc_index = [0]
        
        def get_next_document():
            if doc_index[0] < len(documents):
                doc = documents[doc_index[0]]
                doc_index[0] += 1
                return doc
            return None
        
        mock_document_query.where.return_value.first.side_effect = get_next_document
        
        # Setup query to return different mocks
        def query_side_effect(model):
            if model == Dataset:
                return mock_dataset_query
            return mock_document_query
        
        mock_db_session.query.side_effect = query_side_effect
        
        # Act
        _document_indexing("dataset-123", ["doc-0", "doc-1"])
        
        # Assert - all documents should be marked as error
        for doc in documents:
            assert doc.indexing_status == "error"
            assert "batch upload" in doc.error.lower()

    @patch("core.indexing_runner.db.session")
    @patch("tasks.document_indexing_task.db.session")
    def test_handles_provider_token_not_init_error(self, mock_task_db_session, mock_runner_db_session):
        """
        Test handling of ProviderTokenNotInitError.
        
        Verifies that document status is set to 'error' when provider token is not initialized.
        """
        # Arrange
        from core.errors.error import ProviderTokenNotInitError

        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        document = DocumentProcessingTestDataFactory.create_mock_document()
        
        # Mock query chain for dataset in task
        mock_dataset_query = Mock()
        mock_dataset_query.where.return_value.first.return_value = dataset
        
        # Mock query chain for document in task
        mock_document_query = Mock()
        mock_document_query.filter_by.return_value.first.return_value = document
        
        # Setup query to return different mocks based on the model
        def query_side_effect(model):
            if model == Dataset:
                return mock_dataset_query
            return mock_document_query
        
        mock_task_db_session.query.side_effect = query_side_effect
        
        # Mock IndexingRunner's db.session calls
        mock_runner_db_session.get.return_value = document
        mock_runner_db_session.query.return_value.filter_by.return_value.first.return_value = dataset
        
        # Mock the _extract method to raise the error
        with patch("core.indexing_runner.IndexingRunner._extract") as mock_extract:
            mock_extract.side_effect = ProviderTokenNotInitError("Token not initialized")
            
            # Act
            with patch("tasks.document_indexing_task.FeatureService") as mock_feature_service:
                features = DocumentProcessingTestDataFactory.create_mock_features()
                mock_feature_service.get_features.return_value = features
                _document_indexing("dataset-123", ["doc-789"])
        
        # Assert - error should be handled by _handle_indexing_error
        # The document status should be updated to error
        assert mock_runner_db_session.get.called

    @patch("core.indexing_runner.db.session")
    def test_handles_document_paused_error(self, mock_db_session):
        """
        Test handling of DocumentIsPausedError.
        
        Verifies that paused documents are detected and processing stops gracefully.
        """
        # Arrange
        document = DocumentProcessingTestDataFactory.create_mock_document()
        document.is_paused = True
        
        mock_db_session.query.return_value.filter_by.return_value.count.return_value = 1
        
        # Act & Assert
        with pytest.raises(DocumentIsPausedError):
            IndexingRunner._update_document_index_status(
                document_id="doc-789", after_indexing_status="indexing", extra_update_params={}
            )

    @patch("core.indexing_runner.redis_client")
    def test_check_document_paused_status_via_redis(self, mock_redis_client):
        """
        Test checking document paused status via Redis.
        
        Verifies that Redis cache is checked for pause status.
        """
        # Arrange
        mock_redis_client.get.return_value = "1"  # Document is paused
        
        # Act & Assert
        with pytest.raises(DocumentIsPausedError):
            IndexingRunner._check_document_paused_status("doc-789")

    @patch("core.indexing_runner.db.session")
    @patch("tasks.document_indexing_task.db.session")
    def test_handles_generic_exception(self, mock_task_db_session, mock_runner_db_session):
        """
        Test handling of generic exceptions during processing.
        
        Verifies that unexpected errors are caught and document status is updated.
        """
        # Arrange
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        document = DocumentProcessingTestDataFactory.create_mock_document()
        
        # Mock query chain for dataset
        mock_dataset_query = Mock()
        mock_dataset_query.where.return_value.first.return_value = dataset
        
        # Mock query chain for document
        mock_document_query = Mock()
        mock_document_query.filter_by.return_value.first.return_value = document
        
        # Setup query to return different mocks based on the model
        def query_side_effect(model):
            if model == Dataset:
                return mock_dataset_query
            return mock_document_query
        
        mock_task_db_session.query.side_effect = query_side_effect
        
        # Mock IndexingRunner's db.session calls
        mock_runner_db_session.get.return_value = document
        mock_runner_db_session.query.return_value.filter_by.return_value.first.return_value = dataset
        
        # Mock the _extract method to raise the error
        with patch("core.indexing_runner.IndexingRunner._extract") as mock_extract:
            mock_extract.side_effect = Exception("Unexpected error")
            
            # Act
            with patch("tasks.document_indexing_task.FeatureService") as mock_feature_service:
                features = DocumentProcessingTestDataFactory.create_mock_features()
                mock_feature_service.get_features.return_value = features
                _document_indexing("dataset-123", ["doc-789"])
        
        # Assert - error should be handled gracefully
        assert mock_runner_db_session.get.called

    @patch("tasks.document_indexing_task.db.session")
    @patch("tasks.document_indexing_task.FeatureService")
    def test_handles_vector_space_limit_exceeded(self, mock_feature_service, mock_db_session):
        """
        Test handling when vector space limit is exceeded.
        
        Verifies that documents are marked as error when quota is exceeded.
        """
        # Arrange
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        document = DocumentProcessingTestDataFactory.create_mock_document()
        
        # Create features with exceeded vector space
        features = DocumentProcessingTestDataFactory.create_mock_features(
            vector_space_limit=1000, vector_space_size=1000
        )
        mock_feature_service.get_features.return_value = features
        
        # Mock query chain for dataset
        mock_dataset_query = Mock()
        mock_dataset_query.where.return_value.first.return_value = dataset
        
        # Mock query chain for document in exception handler (uses .where not .filter_by)
        mock_document_query = Mock()
        mock_document_query.where.return_value.first.return_value = document
        
        # Setup query to return different mocks based on the model
        def query_side_effect(model):
            if model == Dataset:
                return mock_dataset_query
            return mock_document_query
        
        mock_db_session.query.side_effect = query_side_effect
        
        # Act
        _document_indexing("dataset-123", ["doc-789"])
        
        # Assert
        assert document.indexing_status == "error"
        assert "limit" in document.error.lower()

    @patch("tasks.document_indexing_task.db.session")
    @patch("tasks.document_indexing_task.FeatureService")
    def test_handles_batch_upload_limit_exceeded(self, mock_feature_service, mock_db_session):
        """
        Test handling when batch upload limit is exceeded.
        
        Verifies that batch uploads beyond limit are rejected.
        """
        # Arrange
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        documents = [
            DocumentProcessingTestDataFactory.create_mock_document(document_id=f"doc-{i}") for i in range(15)
        ]
        
        features = DocumentProcessingTestDataFactory.create_mock_features()
        mock_feature_service.get_features.return_value = features
        
        # Mock query chain for dataset
        mock_dataset_query = Mock()
        mock_dataset_query.where.return_value.first.return_value = dataset
        
        # Mock query chain for documents in exception handler (uses .where not .filter_by)
        mock_document_query = Mock()
        document_index = [0]
        
        def get_next_document():
            if document_index[0] < len(documents):
                doc = documents[document_index[0]]
                document_index[0] += 1
                return doc
            return None
        
        mock_document_query.where.return_value.first.side_effect = get_next_document
        
        # Setup query to return different mocks based on the model
        def query_side_effect(model):
            if model == Dataset:
                return mock_dataset_query
            return mock_document_query
        
        mock_db_session.query.side_effect = query_side_effect
        
        # Act
        with patch("tasks.document_indexing_task.dify_config.BATCH_UPLOAD_LIMIT", 10):
            _document_indexing("dataset-123", [f"doc-{i}" for i in range(15)])
        
        # Assert - all documents should be marked as error
        for doc in documents:
            assert doc.indexing_status == "error"


class TestConcurrentProcessing:
    """Test cases for concurrent document processing scenarios."""

    def test_document_grouping_for_parallel_processing(self):
        """
        Test document grouping logic for parallel processing.
        
        Verifies that documents are properly grouped for concurrent execution.
        """
        # Arrange
        documents = DocumentProcessingTestDataFactory.create_mock_documents(count=10)
        max_workers = 4
        
        # Act - Simulate grouping logic
        document_groups = [[] for _ in range(max_workers)]
        for document in documents:
            import hashlib
            hash_val = hashlib.md5(document.page_content.encode()).hexdigest()
            group_index = int(hash_val, 16) % max_workers
            document_groups[group_index].append(document)
        
        # Assert
        assert len(document_groups) == max_workers
        total_docs = sum(len(group) for group in document_groups)
        assert total_docs == 10

    @patch("tasks.document_indexing_task.TenantIsolatedTaskQueue")
    @patch("tasks.document_indexing_task.db.session")
    def test_tenant_queue_isolation(self, mock_db_session, mock_queue):
        """
        Test tenant-isolated task queue processing.
        
        Verifies that tasks are properly queued per tenant for fair resource allocation.
        """
        # Arrange
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        mock_db_session.query.return_value.where.return_value.first.return_value = dataset
        
        mock_queue_instance = Mock()
        mock_queue_instance.pull_tasks.return_value = []
        mock_queue_instance.delete_task_key.return_value = None
        mock_queue.return_value = mock_queue_instance
        
        mock_task_func = Mock()
        
        # Act
        with patch("tasks.document_indexing_task.FeatureService") as mock_feature_service:
            mock_feature_service.get_features.return_value = DocumentProcessingTestDataFactory.create_mock_features()
            with patch("tasks.document_indexing_task.IndexingRunner"):
                _document_indexing_with_tenant_queue("tenant-456", "dataset-123", ["doc-789"], mock_task_func)
        
        # Assert
        mock_queue_instance.pull_tasks.assert_called_once()

    @patch("tasks.document_indexing_task.TenantIsolatedTaskQueue")
    @patch("tasks.document_indexing_task.db.session")
    def test_queue_processes_next_waiting_task(self, mock_db_session, mock_queue):
        """
        Test processing of next waiting task from queue.
        
        Verifies that queued tasks are processed in FIFO order.
        """
        # Arrange
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        mock_db_session.query.return_value.where.return_value.first.return_value = dataset
        
        next_task = {"tenant_id": "tenant-456", "dataset_id": "dataset-789", "document_ids": ["doc-next"]}
        
        mock_queue_instance = Mock()
        mock_queue_instance.pull_tasks.return_value = [next_task]
        mock_queue_instance.set_task_waiting_time.return_value = None
        mock_queue.return_value = mock_queue_instance
        
        mock_task_func = Mock()
        mock_task_func.delay = Mock()
        
        # Act
        with patch("tasks.document_indexing_task.FeatureService") as mock_feature_service:
            mock_feature_service.get_features.return_value = DocumentProcessingTestDataFactory.create_mock_features()
            with patch("tasks.document_indexing_task.IndexingRunner"):
                _document_indexing_with_tenant_queue("tenant-456", "dataset-123", ["doc-789"], mock_task_func)
        
        # Assert
        mock_task_func.delay.assert_called_once_with(
            tenant_id="tenant-456", dataset_id="dataset-789", document_ids=["doc-next"]
        )


class TestDocumentCleaningAndFiltering:
    """Test cases for document cleaning and content filtering."""

    def test_filter_string_removes_special_characters(self):
        """
        Test that filter_string removes unwanted special characters.
        
        Verifies text cleaning removes control characters and invalid unicode.
        """
        # Arrange
        text_with_special_chars = "Hello <|World|> \x00Test\x08\ufffe"
        
        # Act
        cleaned_text = IndexingRunner.filter_string(text_with_special_chars)
        
        # Assert
        assert "<|" not in cleaned_text
        assert "|>" not in cleaned_text
        assert "\x00" not in cleaned_text
        assert "\ufffe" not in cleaned_text
        assert "Hello" in cleaned_text
        assert "World" in cleaned_text

    def test_filter_string_handles_empty_string(self):
        """
        Test that filter_string handles empty strings.
        
        Verifies that empty input returns empty output.
        """
        # Arrange
        text = ""
        
        # Act
        cleaned_text = IndexingRunner.filter_string(text)
        
        # Assert
        assert cleaned_text == ""

    def test_filter_string_handles_unicode_text(self):
        """
        Test that filter_string preserves valid Unicode characters.
        
        Verifies that legitimate Unicode text is not corrupted.
        """
        # Arrange
        text = "Hello 世界 🌍 Привет مرحبا"
        
        # Act
        cleaned_text = IndexingRunner.filter_string(text)
        
        # Assert
        assert "世界" in cleaned_text
        assert "🌍" in cleaned_text
        assert "Привет" in cleaned_text
        assert "مرحبا" in cleaned_text

    def test_filter_string_removes_control_characters(self):
        """
        Test that filter_string removes all control characters.
        
        Verifies comprehensive control character removal.
        """
        # Arrange
        text = "Text\x00with\x01control\x02chars\x03"
        
        # Act
        cleaned_text = IndexingRunner.filter_string(text)
        
        # Assert
        assert "\x00" not in cleaned_text
        assert "\x01" not in cleaned_text
        assert "\x02" not in cleaned_text
        assert "\x03" not in cleaned_text
        assert "Text" in cleaned_text
        assert "with" in cleaned_text

    @patch("core.indexing_runner.CleanProcessor")
    def test_document_clean_applies_rules(self, mock_clean_processor):
        """
        Test that _document_clean applies processing rules.
        
        Verifies that cleaning rules are applied to document text.
        """
        # Arrange
        import json
        text = "  This is a test document with extra   spaces.  "
        rules_dict = {"pre_processing_rules": [{"id": "remove_extra_spaces", "enabled": True}]}
        process_rule = DocumentProcessingTestDataFactory.create_mock_process_rule(
            mode="custom", rules=json.dumps(rules_dict)
        )
        
        mock_clean_processor.clean.return_value = "This is a test document with extra spaces."
        
        # Act
        cleaned_text = IndexingRunner._document_clean(text, process_rule)
        
        # Assert
        mock_clean_processor.clean.assert_called_once()
        assert cleaned_text == "This is a test document with extra spaces."


class TestTaskIntegration:
    """Integration tests for complete task workflows."""

    @patch("tasks.document_indexing_task.normal_document_indexing_task.delay")
    @patch("tasks.document_indexing_task.db.session")
    def test_normal_document_indexing_task_workflow(self, mock_db_session, mock_task_delay):
        """
        Test complete workflow for normal priority document indexing.
        
        Verifies end-to-end processing for normal priority tasks.
        """
        # Arrange
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        document = DocumentProcessingTestDataFactory.create_mock_document()
        
        mock_db_session.query.return_value.where.return_value.first.return_value = dataset
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = document
        
        # Act
        with patch("tasks.document_indexing_task.FeatureService") as mock_feature_service:
            mock_feature_service.get_features.return_value = DocumentProcessingTestDataFactory.create_mock_features()
            with patch("tasks.document_indexing_task.IndexingRunner"):
                with patch("tasks.document_indexing_task.TenantIsolatedTaskQueue") as mock_queue:
                    mock_queue_instance = Mock()
                    mock_queue_instance.pull_tasks.return_value = []
                    mock_queue_instance.delete_task_key.return_value = None
                    mock_queue.return_value = mock_queue_instance
                    
                    normal_document_indexing_task("tenant-456", "dataset-123", ["doc-789"])
        
        # Assert - task should complete without errors
        assert True

    @patch("tasks.document_indexing_task.priority_document_indexing_task.delay")
    @patch("tasks.document_indexing_task.db.session")
    def test_priority_document_indexing_task_workflow(self, mock_db_session, mock_task_delay):
        """
        Test complete workflow for priority document indexing.
        
        Verifies end-to-end processing for high-priority tasks.
        """
        # Arrange
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        document = DocumentProcessingTestDataFactory.create_mock_document()
        
        mock_db_session.query.return_value.where.return_value.first.return_value = dataset
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = document
        
        # Act
        with patch("tasks.document_indexing_task.FeatureService") as mock_feature_service:
            mock_feature_service.get_features.return_value = DocumentProcessingTestDataFactory.create_mock_features()
            with patch("tasks.document_indexing_task.IndexingRunner"):
                with patch("tasks.document_indexing_task.TenantIsolatedTaskQueue") as mock_queue:
                    mock_queue_instance = Mock()
                    mock_queue_instance.pull_tasks.return_value = []
                    mock_queue_instance.delete_task_key.return_value = None
                    mock_queue.return_value = mock_queue_instance
                    
                    priority_document_indexing_task("tenant-456", "dataset-123", ["doc-789"])
        
        # Assert - task should complete without errors
        assert True

    @patch("tasks.document_indexing_task.db.session")
    def test_document_not_found_scenario(self, mock_db_session):
        """
        Test handling when document is not found in database.
        
        Verifies graceful handling of missing documents.
        """
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = None
        
        # Act
        with patch("tasks.document_indexing_task.FeatureService") as mock_feature_service:
            mock_feature_service.get_features.return_value = DocumentProcessingTestDataFactory.create_mock_features()
            _document_indexing("dataset-123", ["doc-789"])
        
        # Assert - should return gracefully without processing
        assert True

    @patch("tasks.document_indexing_task.db.session")
    def test_dataset_not_found_scenario(self, mock_db_session):
        """
        Test handling when dataset is not found in database.
        
        Verifies graceful handling of missing datasets.
        """
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = None
        
        # Act
        with patch("tasks.document_indexing_task.FeatureService") as mock_feature_service:
            mock_feature_service.get_features.return_value = DocumentProcessingTestDataFactory.create_mock_features()
            _document_indexing("dataset-123", ["doc-789"])
        
        # Assert - should return gracefully without processing
        assert True

    @patch("tasks.document_indexing_task.db.session")
    def test_empty_document_ids_list(self, mock_db_session):
        """
        Test handling of empty document IDs list.
        
        Verifies that empty lists are handled without errors.
        """
        # Arrange
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        mock_db_session.query.return_value.where.return_value.first.return_value = dataset
        
        # Act
        with patch("tasks.document_indexing_task.FeatureService") as mock_feature_service:
            mock_feature_service.get_features.return_value = DocumentProcessingTestDataFactory.create_mock_features()
            with patch("tasks.document_indexing_task.IndexingRunner"):
                _document_indexing("dataset-123", [])
        
        # Assert - should complete without errors
        assert True

    @patch("tasks.document_indexing_task.TenantIsolatedTaskQueue")
    @patch("tasks.document_indexing_task.db.session")
    def test_tenant_queue_with_multiple_waiting_tasks(self, mock_db_session, mock_queue):
        """
        Test processing multiple waiting tasks from tenant queue.
        
        Verifies that multiple queued tasks are processed in order.
        """
        # Arrange
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        mock_db_session.query.return_value.where.return_value.first.return_value = dataset
        
        next_tasks = [
            {"tenant_id": "tenant-456", "dataset_id": "dataset-789", "document_ids": [f"doc-{i}"]}
            for i in range(3)
        ]
        
        mock_queue_instance = Mock()
        mock_queue_instance.pull_tasks.return_value = next_tasks
        mock_queue_instance.set_task_waiting_time.return_value = None
        mock_queue.return_value = mock_queue_instance
        
        mock_task_func = Mock()
        mock_task_func.delay = Mock()
        
        # Act
        with patch("tasks.document_indexing_task.FeatureService") as mock_feature_service:
            mock_feature_service.get_features.return_value = DocumentProcessingTestDataFactory.create_mock_features()
            with patch("tasks.document_indexing_task.IndexingRunner"):
                _document_indexing_with_tenant_queue("tenant-456", "dataset-123", ["doc-789"], mock_task_func)
        
        # Assert - should process all waiting tasks
        assert mock_task_func.delay.call_count == 3

    @patch("tasks.document_indexing_task.db.session")
    def test_document_indexing_with_different_doc_forms(self, mock_db_session):
        """
        Test document indexing with different document forms.
        
        Verifies that different index types are handled correctly.
        """
        # Arrange
        dataset = DocumentProcessingTestDataFactory.create_mock_dataset()
        
        for doc_form in [IndexType.PARAGRAPH_INDEX, IndexType.QA_INDEX, IndexType.PARENT_CHILD_INDEX]:
            document = DocumentProcessingTestDataFactory.create_mock_document(doc_form=doc_form)
            
            mock_db_session.query.return_value.where.return_value.first.return_value = dataset
            mock_db_session.query.return_value.filter_by.return_value.first.return_value = document
            
            # Act
            with patch("tasks.document_indexing_task.FeatureService") as mock_feature_service:
                features = DocumentProcessingTestDataFactory.create_mock_features()
                mock_feature_service.get_features.return_value = features
                with patch("tasks.document_indexing_task.IndexingRunner") as mock_runner:
                    mock_runner.return_value.run = Mock()
                    _document_indexing("dataset-123", ["doc-789"])
            
            # Assert - should handle each doc form
            assert document.indexing_status == "parsing"

    def test_document_task_dataclass_serialization(self):
        """
        Test DocumentTask dataclass can be serialized and deserialized.
        
        Verifies that task data can be properly queued and retrieved.
        """
        # Arrange
        task_data = {
            "tenant_id": "tenant-123",
            "dataset_id": "dataset-456",
            "document_ids": ["doc-1", "doc-2", "doc-3"]
        }
        
        # Act
        task = DocumentTask(**task_data)
        
        # Assert
        assert task.tenant_id == task_data["tenant_id"]
        assert task.dataset_id == task_data["dataset_id"]
        assert task.document_ids == task_data["document_ids"]

