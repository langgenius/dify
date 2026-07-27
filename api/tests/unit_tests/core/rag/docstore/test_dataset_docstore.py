"""
Unit tests for DatasetDocumentStore.

Tests cover all public methods and error paths of the DatasetDocumentStore class
which provides document storage and retrieval functionality for datasets in the RAG system.
"""

from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.rag.docstore.dataset_docstore import DatasetDocumentStore, DocumentSegment
from core.rag.models.document import AttachmentDocument, ChildDocument, Document
from models.dataset import ChildChunk, Dataset, SegmentAttachmentBinding

TENANT_ID = "00000000-0000-0000-0000-000000000001"
DATASET_ID = "00000000-0000-0000-0000-000000000002"
DOCUMENT_ID = "00000000-0000-0000-0000-000000000003"
USER_ID = "00000000-0000-0000-0000-000000000004"


def _dataset() -> Dataset:
    dataset = MagicMock(spec=Dataset)
    dataset.id = DATASET_ID
    dataset.tenant_id = TENANT_ID
    return dataset


def _persist_segment(
    session: Session,
    *,
    index_node_id: str = "doc-1",
    index_node_hash: str = "hash-1",
    content: str = "Test content",
    tokens: int = 5,
) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=TENANT_ID,
        dataset_id=DATASET_ID,
        document_id=DOCUMENT_ID,
        position=1,
        content=content,
        word_count=len(content),
        tokens=tokens,
        created_by=USER_ID,
        index_node_id=index_node_id,
        index_node_hash=index_node_hash,
    )
    session.add(segment)
    session.flush()
    return segment


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

        mock_session = MagicMock()
        mock_session.scalars.return_value.all.return_value = [mock_segment]

        store = DatasetDocumentStore(
            dataset=mock_dataset,
            user_id="test-user-id",
        )

        result = store.get_docs(mock_session)

        assert "node-1" in result
        assert isinstance(result["node-1"], Document)

    def test_docs_empty_dataset(self):
        """Test docs property with no segments."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        mock_session = MagicMock()
        mock_session.scalars.return_value.all.return_value = []

        store = DatasetDocumentStore(
            dataset=mock_dataset,
            user_id="test-user-id",
        )

        result = store.get_docs(mock_session)

        assert result == {}


@pytest.mark.parametrize(
    "sqlite_session",
    [(DocumentSegment, ChildChunk, SegmentAttachmentBinding)],
    indirect=True,
)
class TestDatasetDocumentStoreAddDocuments:
    """Tests for add_documents method."""

    def test_add_documents_new_document_with_token_count(self, sqlite_session: Session):
        """Test adding a new document with a precomputed token count."""

        document = Document(
            page_content="Test content",
            metadata={"doc_id": "doc-1", "doc_hash": "hash-1"},
        )
        store = DatasetDocumentStore(dataset=_dataset(), user_id=USER_ID, document_id=DOCUMENT_ID)

        store.add_documents(session=sqlite_session, docs=[document], token_counts=[10])
        sqlite_session.expire_all()

        segment = sqlite_session.scalar(
            select(DocumentSegment).where(
                DocumentSegment.dataset_id == DATASET_ID,
                DocumentSegment.index_node_id == "doc-1",
            )
        )
        assert segment is not None
        assert segment.content == "Test content"
        assert segment.tokens == 10
        assert segment.position == 1

    def test_add_documents_update_existing_document(self, sqlite_session: Session):
        """Test updating existing document with allow_update=True."""

        existing_segment = _persist_segment(sqlite_session)
        document = Document(
            page_content="Updated content",
            metadata={"doc_id": "doc-1", "doc_hash": "new-hash"},
        )
        store = DatasetDocumentStore(dataset=_dataset(), user_id=USER_ID, document_id=DOCUMENT_ID)

        store.add_documents(session=sqlite_session, docs=[document], token_counts=[0])
        sqlite_session.expire_all()

        updated_segment = sqlite_session.get(DocumentSegment, existing_segment.id)
        assert updated_segment is not None
        assert updated_segment.content == "Updated content"
        assert updated_segment.index_node_hash == "new-hash"
        assert updated_segment.tokens == 0

    def test_add_documents_raises_when_not_allowed(self, sqlite_session: Session):
        """Test that adding existing doc without allow_update raises ValueError."""

        _persist_segment(sqlite_session)
        document = Document(
            page_content="Test content",
            metadata={"doc_id": "doc-1", "doc_hash": "hash-1"},
        )
        store = DatasetDocumentStore(dataset=_dataset(), user_id=USER_ID, document_id=DOCUMENT_ID)

        with pytest.raises(ValueError, match="already exists"):
            store.add_documents(
                session=sqlite_session,
                docs=[document],
                token_counts=[0],
                allow_update=False,
            )

        assert sqlite_session.scalar(select(func.count()).select_from(DocumentSegment)) == 1

    def test_add_documents_with_answer_metadata(self, sqlite_session: Session):
        """Test adding document with answer in metadata."""

        document = Document(
            page_content="Test content",
            metadata={
                "doc_id": "doc-1",
                "doc_hash": "hash-1",
                "answer": "Test answer",
            },
        )
        store = DatasetDocumentStore(dataset=_dataset(), user_id=USER_ID, document_id=DOCUMENT_ID)

        store.add_documents(session=sqlite_session, docs=[document], token_counts=[0])
        sqlite_session.expire_all()

        segment = sqlite_session.scalar(select(DocumentSegment))
        assert segment is not None
        assert segment.answer == "Test answer"

    def test_add_documents_with_invalid_document_type(self, sqlite_session: Session):
        """Test that non-Document raises ValueError."""

        store = DatasetDocumentStore(dataset=_dataset(), user_id=USER_ID, document_id=DOCUMENT_ID)

        with pytest.raises(ValueError, match="must be a Document"):
            store.add_documents(session=sqlite_session, docs=["not a document"], token_counts=[0])  # type: ignore[list-item]

    def test_add_documents_with_none_metadata(self, sqlite_session: Session):
        """Test that document with None metadata raises ValueError."""

        document = MagicMock(spec=Document)
        document.metadata = None
        store = DatasetDocumentStore(dataset=_dataset(), user_id=USER_ID, document_id=DOCUMENT_ID)

        with pytest.raises(ValueError, match="metadata must be a dict"):
            store.add_documents(session=sqlite_session, docs=[document], token_counts=[0])

    def test_add_documents_with_save_child(self, sqlite_session: Session):
        """Test adding documents with save_child=True."""

        document = Document(
            page_content="Test content",
            metadata={"doc_id": "doc-1", "doc_hash": "hash-1"},
            children=[
                ChildDocument(
                    page_content="Child content",
                    metadata={"doc_id": "child-1", "doc_hash": "child-hash"},
                )
            ],
        )
        store = DatasetDocumentStore(dataset=_dataset(), user_id=USER_ID, document_id=DOCUMENT_ID)

        store.add_documents(
            session=sqlite_session,
            docs=[document],
            token_counts=[0],
            save_child=True,
        )
        sqlite_session.expire_all()

        child = sqlite_session.scalar(select(ChildChunk))
        assert child is not None
        assert child.content == "Child content"
        assert child.index_node_id == "child-1"

    def test_add_documents_rejects_mismatched_token_counts(self, sqlite_session: Session):
        document = Document(
            page_content="Test content",
            metadata={"doc_id": "doc-1", "doc_hash": "hash-1"},
        )
        store = DatasetDocumentStore(dataset=_dataset(), user_id=USER_ID, document_id=DOCUMENT_ID)

        with pytest.raises(ValueError):
            store.add_documents(session=sqlite_session, docs=[document], token_counts=[])

        assert sqlite_session.scalar(select(func.count()).select_from(DocumentSegment)) == 0


class TestDatasetDocumentStoreExists:
    """Tests for document_exists method."""

    def test_document_exists_returns_true(self):
        """Test document_exists returns True when segment exists."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        mock_segment = MagicMock()
        mock_session = MagicMock()

        with patch.object(DatasetDocumentStore, "get_document_segment", return_value=mock_segment):
            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            result = store.document_exists("doc-1", session=mock_session)

            assert result is True

    def test_document_exists_returns_false(self):
        """Test document_exists returns False when segment doesn't exist."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_session = MagicMock()

        with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            result = store.document_exists("doc-1", session=mock_session)

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
        mock_session = MagicMock()

        with patch.object(DatasetDocumentStore, "get_document_segment", return_value=mock_segment):
            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            result = store.get_document("node-1", session=mock_session, raise_error=False)

            assert isinstance(result, Document)
            assert result.page_content == "Test content"

    def test_get_document_returns_none_when_not_found(self):
        """Test get_document returns None when not found and raise_error=False."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_session = MagicMock()

        with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            result = store.get_document("nonexistent", session=mock_session, raise_error=False)

            assert result is None

    def test_get_document_raises_when_not_found(self):
        """Test get_document raises ValueError when not found and raise_error=True."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_session = MagicMock()

        with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            with pytest.raises(ValueError, match="not found"):
                store.get_document("nonexistent", session=mock_session, raise_error=True)


class TestDatasetDocumentStoreDeleteDocument:
    """Tests for delete_document method."""

    def test_delete_document_success(self):
        """Test deleting a document successfully."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        mock_segment = MagicMock()
        mock_session = MagicMock()

        with patch.object(DatasetDocumentStore, "get_document_segment", return_value=mock_segment):
            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            store.delete_document("doc-1", session=mock_session)

            mock_session.delete.assert_called_with(mock_segment)
            mock_session.flush.assert_called()

    def test_delete_document_returns_none_when_not_found(self):
        """Test delete_document returns None when not found and raise_error=False."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_session = MagicMock()

        with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            result = store.delete_document("nonexistent", session=mock_session, raise_error=False)

            assert result is None

    def test_delete_document_raises_when_not_found(self):
        """Test delete_document raises ValueError when not found and raise_error=True."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_session = MagicMock()

        with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            with pytest.raises(ValueError, match="not found"):
                store.delete_document("nonexistent", session=mock_session, raise_error=True)


class TestDatasetDocumentStoreHashOperations:
    """Tests for set_document_hash and get_document_hash methods."""

    def test_set_document_hash_success(self):
        """Test setting document hash successfully."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        mock_segment = MagicMock()
        mock_segment.index_node_hash = "old-hash"
        mock_session = MagicMock()

        with patch.object(DatasetDocumentStore, "get_document_segment", return_value=mock_segment):
            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            store.set_document_hash("doc-1", "new-hash", session=mock_session)

            assert mock_segment.index_node_hash == "new-hash"
            mock_session.flush.assert_called()

    def test_set_document_hash_returns_none_when_not_found(self):
        """Test set_document_hash returns None when segment not found."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_session = MagicMock()

        with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            result = store.set_document_hash("nonexistent", "new-hash", session=mock_session)

            assert result is None

    def test_get_document_hash_success(self):
        """Test getting document hash successfully."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        mock_segment = MagicMock()
        mock_segment.index_node_hash = "test-hash"
        mock_session = MagicMock()

        with patch.object(DatasetDocumentStore, "get_document_segment", return_value=mock_segment):
            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            result = store.get_document_hash("doc-1", session=mock_session)

            assert result == "test-hash"

    def test_get_document_hash_returns_none_when_not_found(self):
        """Test get_document_hash returns None when segment not found."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_session = MagicMock()

        with patch.object(DatasetDocumentStore, "get_document_segment", return_value=None):
            store = DatasetDocumentStore(
                dataset=mock_dataset,
                user_id="test-user-id",
            )

            result = store.get_document_hash("nonexistent", session=mock_session)

            assert result is None


class TestDatasetDocumentStoreSegment:
    """Tests for get_document_segment method."""

    def test_get_document_segment_returns_segment(self):
        """Test getting a document segment."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        mock_segment = MagicMock(spec=DocumentSegment)

        mock_session = MagicMock()
        mock_session.scalar.return_value = mock_segment

        store = DatasetDocumentStore(
            dataset=mock_dataset,
            user_id="test-user-id",
        )

        result = store.get_document_segment("doc-1", session=mock_session)

        assert result == mock_segment

    def test_get_document_segment_returns_none(self):
        """Test getting a non-existent document segment."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"

        mock_session = MagicMock()
        mock_session.scalar.return_value = None

        store = DatasetDocumentStore(
            dataset=mock_dataset,
            user_id="test-user-id",
        )

        result = store.get_document_segment("nonexistent", session=mock_session)

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

        mock_session = MagicMock()

        store = DatasetDocumentStore(
            dataset=mock_dataset,
            user_id="test-user-id",
            document_id="test-doc-id",
        )

        store.add_multimodel_documents_binding("seg-1", [mock_attachment], session=mock_session)

        mock_session.add.assert_called()

    def test_add_multimodel_documents_binding_without_attachments(self):
        """Test adding bindings with None attachments."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_dataset.tenant_id = "tenant-1"

        mock_session = MagicMock()

        store = DatasetDocumentStore(
            dataset=mock_dataset,
            user_id="test-user-id",
            document_id="test-doc-id",
        )

        store.add_multimodel_documents_binding("seg-1", None, session=mock_session)

        mock_session.add.assert_not_called()

    def test_add_multimodel_documents_binding_with_empty_list(self):
        """Test adding bindings with empty list."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_dataset.tenant_id = "tenant-1"

        mock_session = MagicMock()

        store = DatasetDocumentStore(
            dataset=mock_dataset,
            user_id="test-user-id",
            document_id="test-doc-id",
        )

        store.add_multimodel_documents_binding("seg-1", [], session=mock_session)

        mock_session.add.assert_not_called()

    def test_add_multimodel_documents_binding_with_none_document_id(self):
        """Test that no bindings are added when document_id is None."""

        mock_dataset = MagicMock(spec=Dataset)
        mock_dataset.id = "test-dataset-id"
        mock_dataset.tenant_id = "tenant-1"

        mock_attachment = MagicMock(spec=AttachmentDocument)
        mock_attachment.metadata = {"doc_id": "attachment-1"}

        mock_session = MagicMock()

        store = DatasetDocumentStore(
            dataset=mock_dataset,
            user_id="test-user-id",
            document_id=None,
        )

        store.add_multimodel_documents_binding("seg-1", [mock_attachment], session=mock_session)

        mock_session.add.assert_not_called()


@pytest.mark.parametrize(
    "sqlite_session",
    [(DocumentSegment, ChildChunk, SegmentAttachmentBinding)],
    indirect=True,
)
class TestDatasetDocumentStoreAddDocumentsUpdateChild:
    """Tests for add_documents when updating existing documents with children."""

    def test_add_documents_update_existing_with_children(self, sqlite_session: Session):
        """Test updating existing document with save_child=True and children."""

        segment = _persist_segment(sqlite_session)
        sqlite_session.add(
            ChildChunk(
                tenant_id=TENANT_ID,
                dataset_id=DATASET_ID,
                document_id=DOCUMENT_ID,
                segment_id=segment.id,
                position=1,
                index_node_id="old-child",
                index_node_hash="old-child-hash",
                content="Old child content",
                word_count=len("Old child content"),
                created_by=USER_ID,
            )
        )
        sqlite_session.flush()
        document = Document(
            page_content="Updated content",
            metadata={"doc_id": "doc-1", "doc_hash": "new-hash"},
            children=[
                ChildDocument(
                    page_content="Updated child content",
                    metadata={"doc_id": "child-1", "doc_hash": "new-child-hash"},
                )
            ],
        )
        store = DatasetDocumentStore(dataset=_dataset(), user_id=USER_ID, document_id=DOCUMENT_ID)

        store.add_documents(
            session=sqlite_session,
            docs=[document],
            token_counts=[0],
            save_child=True,
        )
        sqlite_session.expire_all()

        children = sqlite_session.scalars(select(ChildChunk).order_by(ChildChunk.position)).all()
        assert len(children) == 1
        assert children[0].content == "Updated child content"
        assert children[0].index_node_id == "child-1"


@pytest.mark.parametrize(
    "sqlite_session",
    [(DocumentSegment, ChildChunk, SegmentAttachmentBinding)],
    indirect=True,
)
class TestDatasetDocumentStoreAddDocumentsUpdateAnswer:
    """Tests for add_documents when updating existing documents with answer metadata."""

    def test_add_documents_update_existing_with_answer(self, sqlite_session: Session):
        """Test updating existing document with answer in metadata."""

        existing_segment = _persist_segment(sqlite_session)
        document = Document(
            page_content="Updated content",
            metadata={
                "doc_id": "doc-1",
                "doc_hash": "new-hash",
                "answer": "Updated answer",
            },
        )
        store = DatasetDocumentStore(dataset=_dataset(), user_id=USER_ID, document_id=DOCUMENT_ID)

        store.add_documents(session=sqlite_session, docs=[document], token_counts=[0])
        sqlite_session.expire_all()

        updated_segment = sqlite_session.get(DocumentSegment, existing_segment.id)
        assert updated_segment is not None
        assert updated_segment.answer == "Updated answer"
        assert updated_segment.tokens == 0
