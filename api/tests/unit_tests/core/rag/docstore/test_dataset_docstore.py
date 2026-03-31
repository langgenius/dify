"""
Unit tests for DatasetDocumentStore.

Tests cover all public methods and error paths of the DatasetDocumentStore class
which provides document storage and retrieval functionality for datasets in the RAG system.
"""

from unittest.mock import MagicMock, patch

import pytest

from core.rag.docstore.dataset_docstore import DatasetDocumentStore, DocumentSegment
from core.rag.models.document import AttachmentDocument, Document
from models.dataset import Dataset


class TestDatasetDocumentStoreInit:
    """Tests for DatasetDocumentStore initialization."""

    def test_init_with_all_parameters(self):
        """Test initialization with dataset, user_id, and document_id."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        store = DatasetDocumentStore(
            dataset=mock_dataset,
            user_id="test-user-id",
            document_id="test-doc-id",
        )

        assert store._dataset == mock_dataset
        assert store._user_id == "test-user-id"
        assert store._document_id == "test-doc-id"
        assert store.dataset_id == "test-dataset-id"
        assert store.user_id == "test-user-id"

    def test_init_without_document_id(self):
        """Test initialization without document_id."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        store = DatasetDocumentStore(
            dataset=mock_dataset,
            user_id="test-user-id",
        )

        assert store._document_id is None
        assert store.dataset_id == "test-dataset-id"


class TestDatasetDocumentStoreSerialization:
    """Tests for to_dict and from_dict methods."""

    def test_to_dict(self):
        """Test serialization to dictionary."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        store = DatasetDocumentStore(
            dataset=mock_dataset,
            user_id="test-user-id",
        )

        result = store.to_dict()

        assert result == {"dataset_id": "test-dataset-id"}

    def test_from_dict(self):
        """Test deserialization from dictionary."""

        config_dict = {
            "dataset": MagicMock(spec=["id"]),
            "user_id": "test-user",
            "document_id": "test-doc",
        }
        config_dict["dataset"].id = "ds-123"

        store = DatasetDocumentStore.from_dict(config_dict)

        assert store._user_id == "test-user"
        assert store._document_id == "test-doc"


class TestDatasetDocumentStoreDocs:
    """Tests for the docs property."""

    def test_docs_returns_document_dict(self):
        """Test that docs property returns a dictionary of documents."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        mock_segment = MagicMock(spec=DocumentSegment)
        mock_segment.index_node_id = "node-1"
        mock_segment.index_node_hash = "hash-1"
        mock_segment.document_id = "doc-1"
        mock_segment.dataset_id = "test-dataset-id"
        mock_segment.content = "Test content"

        with patch("core.rag.docstore.dataset_docstore.db") as mock_db:
            mock_session = MagicMock()
            mock_db.session = mock_session
            mock_db.session.scalars.return_value.all.return_value = [mock_segment]

            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            result = store.docs

            assert "node-1" in result
            assert isinstance(result["node-1"], Document)

    def test_docs_empty_dataset(self):
        """Test docs property with no segments."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        with patch("core.rag.docstore.dataset_docstore.db") as mock_db:
            mock_session = MagicMock()
            mock_db.session = mock_session
            mock_db.session.scalars.return_value.all.return_value = []

            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            result = store.docs

            assert result == {}


class TestDatasetDocumentStoreAddDocuments:
    """Tests for add_documents method."""

    def test_add_documents_new_document_with_embedding(self):
        """Test adding new documents with embedding model."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_dataset.tenant_id = "tenant-1"
        mock_dataset.indexing_technique = "high_quality"
        mock_dataset.embedding_model_provider = "provider"
        mock_dataset.embedding_model = "model"

        mock_doc = MagicMock(spec=Document)
        mock_doc.page_content = "Test content"
        mock_doc.metadata = {
            "doc_id": "doc-1",
            "doc_hash": "hash-1",
        }
        mock_doc.attachments = None
        mock_doc.children = None

        mock_model_instance = MagicMock()
        mock_model_instance.get_text_embedding_num_tokens.return_value = [10]

        with (
            patch("core.rag.docstore.dataset_docstore.db") as mock_db,
            patch("core.rag.docstore.dataset_docstore.ModelManager.for_tenant") as mock_manager_class,
        ):
            mock_session = MagicMock()
            mock_db.session = mock_session
            mock_db.session.scalar.return_value = None

            mock_manager = MagicMock()
            mock_manager.get_model_instance.return_value = mock_model_instance
            mock_manager_class.return_value = mock_manager

            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
                with patch.object(DatasetDocumentStore, "add_multimodel_documents_binding"):
                    store = DatasetDocumentStore(
                        dataset=mock_dataset,
                        user_id="test-user-id",
                        document_id="test-doc-id",
                    )

                    store.add_documents([mock_doc])

                    mock_db.session.add.assert_called()
                    mock_db.session.commit.assert_called()

    def test_add_documents_update_existing_document(self):
        """Test updating existing document with allow_update=True."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_dataset.tenant_id = "tenant-1"
        mock_dataset.indexing_technique = "economy"
        mock_dataset.embedding_model_provider = None
        mock_dataset.embedding_model = None

        mock_doc = MagicMock(spec=Document)
        mock_doc.page_content = "Updated content"
        mock_doc.metadata = {
            "doc_id": "doc-1",
            "doc_hash": "new-hash",
        }
        mock_doc.attachments = None
        mock_doc.children = None

        mock_existing_segment = MagicMock()
        mock_existing_segment.id = "seg-1"

        with patch("core.rag.docstore.dataset_docstore.db") as mock_db:
            mock_session = MagicMock()
            mock_db.session = mock_session
            mock_db.session.scalar.return_value = 5

            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=mock_existing_segment):
                with patch.object(DatasetDocumentStore, "add_multimodel_documents_binding"):
                    store = DatasetDocumentStore(
                        dataset=mock_dataset,
                        user_id="test-user-id",
                        document_id="test-doc-id",
                    )

                    store.add_documents([mock_doc])

                    mock_db.session.commit.assert_called()

    def test_add_documents_raises_when_not_allowed(self):
        """Test that adding existing doc without allow_update raises ValueError."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_dataset.tenant_id = "tenant-1"
        mock_dataset.indexing_technique = "economy"

        mock_doc = MagicMock(spec=Document)
        mock_doc.page_content = "Test content"
        mock_doc.metadata = {
            "doc_id": "doc-1",
            "doc_hash": "hash-1",
        }
        mock_doc.attachments = None
        mock_doc.children = None

        mock_existing_segment = MagicMock()

        with patch("core.rag.docstore.dataset_docstore.db"):
            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=mock_existing_segment):
                store = DatasetDocumentStore(
                    dataset=mock_dataset,
                    user_id="test-user-id",
                    document_id="test-doc-id",
                )

                with pytest.raises(ValueError, match="already exists"):
                    store.add_documents([mock_doc], allow_update=False)

    def test_add_documents_with_answer_metadata(self):
        """Test adding document with answer in metadata."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_dataset.tenant_id = "tenant-1"
        mock_dataset.indexing_technique = "economy"

        mock_doc = MagicMock(spec=Document)
        mock_doc.page_content = "Test content"
        mock_doc.metadata = {
            "doc_id": "doc-1",
            "doc_hash": "hash-1",
            "answer": "Test answer",
        }
        mock_doc.attachments = None
        mock_doc.children = None

        with patch("core.rag.docstore.dataset_docstore.db") as mock_db:
            mock_session = MagicMock()
            mock_db.session = mock_session
            mock_db.session.scalar.return_value = None

            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
                with patch.object(DatasetDocumentStore, "add_multimodel_documents_binding"):
                    store = DatasetDocumentStore(
                        dataset=mock_dataset,
                        user_id="test-user-id",
                        document_id="test-doc-id",
                    )

                    store.add_documents([mock_doc])

                    mock_db.session.add.assert_called()

    def test_add_documents_with_invalid_document_type(self):
        """Test that non-Document raises ValueError."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        with patch("core.rag.docstore.dataset_docstore.db"):
            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
                document_id="test-doc-id",
            )

            with pytest.raises(ValueError, match="must be a Document"):
                store.add_documents(["not a document"])

    def test_add_documents_with_none_metadata(self):
        """Test that document with None metadata raises ValueError."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        mock_doc = MagicMock(spec=Document)
        mock_doc.page_content = "Test content"
        mock_doc.metadata = None

        with patch("core.rag.docstore.dataset_docstore.db"):
            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
                document_id="test-doc-id",
            )

            with pytest.raises(ValueError, match="metadata must be a dict"):
                store.add_documents([mock_doc])

    def test_add_documents_with_save_child(self):
        """Test adding documents with save_child=True."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_dataset.tenant_id = "tenant-1"
        mock_dataset.indexing_technique = "economy"

        mock_child = MagicMock(spec=Document)
        mock_child.page_content = "Child content"
        mock_child.metadata = {
            "doc_id": "child-1",
            "doc_hash": "child-hash",
        }

        mock_doc = MagicMock(spec=Document)
        mock_doc.page_content = "Test content"
        mock_doc.metadata = {
            "doc_id": "doc-1",
            "doc_hash": "hash-1",
        }
        mock_doc.attachments = None
        mock_doc.children = [mock_child]

        with patch("core.rag.docstore.dataset_docstore.db") as mock_db:
            mock_session = MagicMock()
            mock_db.session = mock_session
            mock_db.session.scalar.return_value = None

            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
                with patch.object(DatasetDocumentStore, "add_multimodel_documents_binding"):
                    store = DatasetDocumentStore(
                        dataset=mock_dataset,
                        user_id="test-user-id",
                        document_id="test-doc-id",
                    )

                    store.add_documents([mock_doc], save_child=True)

                    mock_db.session.add.assert_called()


class TestDatasetDocumentStoreExists:
    """Tests for document_exists method."""

    def test_document_exists_returns_true(self):
        """Test document_exists returns True when segment exists."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        mock_segment = MagicMock()

        with patch("core.rag.docstore.dataset_docstore.db"):
            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=mock_segment):
                store = DatasetDocumentStore(
                    dataset=mock_dataset,
                    user_id="test-user-id",
                )

                result = store.document_exists("doc-1")

                assert result is True

    def test_document_exists_returns_false(self):
        """Test document_exists returns False when segment doesn't exist."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        with patch("core.rag.docstore.dataset_docstore.db"):
            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
                store = DatasetDocumentStore(
                    dataset=mock_dataset,
                    user_id="test-user-id",
                )

                result = store.document_exists("doc-1")

                assert result is False


class TestDatasetDocumentStoreGetDocument:
    """Tests for get_document method."""

    def test_get_document_success(self):
        """Test getting a document successfully."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        mock_segment = MagicMock(spec=DocumentSegment)
        mock_segment.index_node_id = "node-1"
        mock_segment.index_node_hash = "hash-1"
        mock_segment.document_id = "doc-1"
        mock_segment.dataset_id = "test-dataset-id"
        mock_segment.content = "Test content"

        with patch("core.rag.docstore.dataset_docstore.db"):
            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=mock_segment):
                store = DatasetDocumentStore(
                    dataset=mock_dataset,
                    user_id="test-user-id",
                )

                result = store.get_document("node-1", raise_error=False)

                assert isinstance(result, Document)
                assert result.page_content == "Test content"

    def test_get_document_returns_none_when_not_found(self):
        """Test get_document returns None when not found and raise_error=False."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        with patch("core.rag.docstore.dataset_docstore.db"):
            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
                store = DatasetDocumentStore(
                    dataset=mock_dataset,
                    user_id="test-user-id",
                )

                result = store.get_document("nonexistent", raise_error=False)

                assert result is None

    def test_get_document_raises_when_not_found(self):
        """Test get_document raises ValueError when not found and raise_error=True."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        with patch("core.rag.docstore.dataset_docstore.db"):
            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
                store = DatasetDocumentStore(
                    dataset=mock_dataset,
                    user_id="test-user-id",
                )

                with pytest.raises(ValueError, match="not found"):
                    store.get_document("nonexistent", raise_error=True)


class TestDatasetDocumentStoreDeleteDocument:
    """Tests for delete_document method."""

    def test_delete_document_success(self):
        """Test deleting a document successfully."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        mock_segment = MagicMock()

        with patch("core.rag.docstore.dataset_docstore.db") as mock_db:
            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=mock_segment):
                store = DatasetDocumentStore(
                    dataset=mock_dataset,
                    user_id="test-user-id",
                )

                store.delete_document("doc-1")

                mock_db.session.delete.assert_called_with(mock_segment)
                mock_db.session.commit.assert_called()

    def test_delete_document_returns_none_when_not_found(self):
        """Test delete_document returns None when not found and raise_error=False."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        with patch("core.rag.docstore.dataset_docstore.db"):
            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
                store = DatasetDocumentStore(
                    dataset=mock_dataset,
                    user_id="test-user-id",
                )

                result = store.delete_document("nonexistent", raise_error=False)

                assert result is None

    def test_delete_document_raises_when_not_found(self):
        """Test delete_document raises ValueError when not found and raise_error=True."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        with patch("core.rag.docstore.dataset_docstore.db"):
            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
                store = DatasetDocumentStore(
                    dataset=mock_dataset,
                    user_id="test-user-id",
                )

                with pytest.raises(ValueError, match="not found"):
                    store.delete_document("nonexistent", raise_error=True)


class TestDatasetDocumentStoreHashOperations:
    """Tests for set_document_hash and get_document_hash methods."""

    def test_set_document_hash_success(self):
        """Test setting document hash successfully."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        mock_segment = MagicMock()
        mock_segment.index_node_hash = "old-hash"

        with patch("core.rag.docstore.dataset_docstore.db") as mock_db:
            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=mock_segment):
                store = DatasetDocumentStore(
                    dataset=mock_dataset,
                    user_id="test-user-id",
                )

                store.set_document_hash("doc-1", "new-hash")

                assert mock_segment.index_node_hash == "new-hash"
                mock_db.session.commit.assert_called()

    def test_set_document_hash_returns_none_when_not_found(self):
        """Test set_document_hash returns None when segment not found."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        with patch("core.rag.docstore.dataset_docstore.db"):
            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
                store = DatasetDocumentStore(
                    dataset=mock_dataset,
                    user_id="test-user-id",
                )

                result = store.set_document_hash("nonexistent", "new-hash")

                assert result is None

    def test_get_document_hash_success(self):
        """Test getting document hash successfully."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        mock_segment = MagicMock()
        mock_segment.index_node_hash = "test-hash"

        with patch("core.rag.docstore.dataset_docstore.db"):
            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=mock_segment):
                store = DatasetDocumentStore(
                    dataset=mock_dataset,
                    user_id="test-user-id",
                )

                result = store.get_document_hash("doc-1")

                assert result == "test-hash"

    def test_get_document_hash_returns_none_when_not_found(self):
        """Test get_document_hash returns None when segment not found."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        with patch("core.rag.docstore.dataset_docstore.db"):
            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
                store = DatasetDocumentStore(
                    dataset=mock_dataset,
                    user_id="test-user-id",
                )

                result = store.get_document_hash("nonexistent")

                assert result is None


class TestDatasetDocumentStoreSegment:
    """Tests for get_document_segment method."""

    def test_get_document_segment_returns_segment(self):
        """Test getting a document segment."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        mock_segment = MagicMock(spec=DocumentSegment)

        with patch("core.rag.docstore.dataset_docstore.db") as mock_db:
            mock_session = MagicMock()
            mock_db.session = mock_session
            mock_db.session.scalar.return_value = mock_segment

            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            result = store.get_document_segment("doc-1")

            assert result == mock_segment

    def test_get_document_segment_returns_none(self):
        """Test getting a non-existent document segment."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        with patch("core.rag.docstore.dataset_docstore.db") as mock_db:
            mock_session = MagicMock()
            mock_db.session = mock_session
            mock_db.session.scalar.return_value = None

            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            result = store.get_document_segment("nonexistent")

            assert result is None


class TestDatasetDocumentStoreMultimodelBinding:
    """Tests for add_multimodel_documents_binding method."""

    def test_add_multimodel_documents_binding_with_attachments(self):
        """Test adding multimodel document bindings."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_dataset.tenant_id = "tenant-1"

        mock_attachment = MagicMock(spec=AttachmentDocument)
        mock_attachment.metadata = {"doc_id": "attachment-1"}

        with patch("core.rag.docstore.dataset_docstore.db") as mock_db:
            mock_session = MagicMock()
            mock_db.session = mock_session

            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
                document_id="test-doc-id",
            )

            store.add_multimodel_documents_binding("seg-1", [mock_attachment])

            mock_db.session.add.assert_called()

    def test_add_multimodel_documents_binding_without_attachments(self):
        """Test adding bindings with None attachments."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_dataset.tenant_id = "tenant-1"

        with patch("core.rag.docstore.dataset_docstore.db") as mock_db:
            mock_session = MagicMock()
            mock_db.session = mock_session

            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
                document_id="test-doc-id",
            )

            store.add_multimodel_documents_binding("seg-1", None)

            mock_db.session.add.assert_not_called()

    def test_add_multimodel_documents_binding_with_empty_list(self):
        """Test adding bindings with empty list."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_dataset.tenant_id = "tenant-1"

        with patch("core.rag.docstore.dataset_docstore.db") as mock_db:
            mock_session = MagicMock()
            mock_db.session = mock_session

            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
                document_id="test-doc-id",
            )

            store.add_multimodel_documents_binding("seg-1", [])

            mock_db.session.add.assert_not_called()


class TestDatasetDocumentStoreAddDocumentsUpdateChild:
    """Tests for add_documents when updating existing documents with children."""

    def test_add_documents_update_existing_with_children(self):
        """Test updating existing document with save_child=True and children."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_dataset.tenant_id = "tenant-1"
        mock_dataset.indexing_technique = "economy"

        mock_child = MagicMock(spec=Document)
        mock_child.page_content = "Updated child content"
        mock_child.metadata = {
            "doc_id": "child-1",
            "doc_hash": "new-child-hash",
        }

        mock_doc = MagicMock(spec=Document)
        mock_doc.page_content = "Updated content"
        mock_doc.metadata = {
            "doc_id": "doc-1",
            "doc_hash": "new-hash",
        }
        mock_doc.attachments = None
        mock_doc.children = [mock_child]

        mock_existing_segment = MagicMock()
        mock_existing_segment.id = "seg-1"

        with patch("core.rag.docstore.dataset_docstore.db") as mock_db:
            mock_session = MagicMock()
            mock_db.session = mock_session
            mock_db.session.scalar.return_value = 5

            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=mock_existing_segment):
                with patch.object(DatasetDocumentStore, "add_multimodel_documents_binding"):
                    store = DatasetDocumentStore(
                        dataset=mock_dataset,
                        user_id="test-user-id",
                        document_id="test-doc-id",
                    )

                    store.add_documents([mock_doc], save_child=True)

                    mock_db.session.execute.assert_called()
                    mock_db.session.commit.assert_called()


class TestDatasetDocumentStoreAddDocumentsUpdateAnswer:
    """Tests for add_documents when updating existing documents with answer metadata."""

    def test_add_documents_update_existing_with_answer(self):
        """Test updating existing document with answer in metadata."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_dataset.tenant_id = "tenant-1"
        mock_dataset.indexing_technique = "economy"

        mock_doc = MagicMock(spec=Document)
        mock_doc.page_content = "Updated content"
        mock_doc.metadata = {
            "doc_id": "doc-1",
            "doc_hash": "new-hash",
            "answer": "Updated answer",
        }
        mock_doc.attachments = None
        mock_doc.children = None

        mock_existing_segment = MagicMock()
        mock_existing_segment.id = "seg-1"

        with patch("core.rag.docstore.dataset_docstore.db") as mock_db:
            mock_session = MagicMock()
            mock_db.session = mock_session
            mock_db.session.scalar.return_value = 5

            with patch.object(DatasetDocumentStore, "get_document_segment", return_value=mock_existing_segment):
                with patch.object(DatasetDocumentStore, "add_multimodel_documents_binding"):
                    store = DatasetDocumentStore(
                        dataset=mock_dataset,
                        user_id="test-user-id",
                        document_id="test-doc-id",
                    )

                    store.add_documents([mock_doc])

                    mock_db.session.commit.assert_called()
