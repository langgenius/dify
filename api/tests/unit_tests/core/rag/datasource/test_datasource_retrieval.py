from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, Mock, call, patch
from uuid import uuid4

import pytest

from core.rag.datasource import retrieval_service as retrieval_service_module
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.rerank.rerank_type import RerankMode
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from models.dataset import Dataset


def create_mock_document(
    content: str,
    doc_id: str,
    score: float = 0.8,
    provider: str = "dify",
    additional_metadata: dict[str, Any] | None = None,
) -> Document:
    """
    Create a mock Document object for testing.

    This helper function standardizes document creation across tests,
    ensuring consistent structure and reducing code duplication.

    Args:
        content: The text content of the document
        doc_id: Unique identifier for the document chunk
        score: Relevance score (0.0 to 1.0)
        provider: Document provider ("dify" or "external")
        additional_metadata: Optional extra metadata fields

    Returns:
        Document: A properly structured Document object

    Example:
        >>> doc = create_mock_document("Python is great", "doc1", score=0.95)
        >>> assert doc.metadata["score"] == 0.95
    """
    metadata = {
        "doc_id": doc_id,
        "document_id": str(uuid4()),
        "dataset_id": str(uuid4()),
        "score": score,
    }

    # Merge additional metadata if provided
    if additional_metadata:
        metadata.update(additional_metadata)

    return Document(
        page_content=content,
        metadata=metadata,
        provider=provider,
    )


class _ImmediateFuture:
    def __init__(self, exception: Exception | None = None) -> None:
        self._exception = exception
        self.cancel_called = False

    def exception(self) -> Exception | None:
        return self._exception

    def cancel(self) -> None:
        self.cancel_called = True


class _ImmediateExecutor:
    def __init__(self) -> None:
        self.futures: list[_ImmediateFuture] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def submit(self, fn, *args, **kwargs):
        try:
            fn(*args, **kwargs)
            future = _ImmediateFuture()
        except Exception as exc:  # pragma: no cover - only for defensive parity with Future semantics
            future = _ImmediateFuture(exc)
        self.futures.append(future)
        return future


class _FakeExecuteScalarResult:
    def __init__(self, data: list) -> None:
        self._data = data

    def all(self) -> list:
        return self._data


class _FakeExecuteResult:
    def __init__(self, data: list) -> None:
        self._data = data

    def scalars(self) -> _FakeExecuteScalarResult:
        return _FakeExecuteScalarResult(self._data)


class _FakeScalarsResult:
    def __init__(self, data: list) -> None:
        self._data = data

    def all(self) -> list:
        return self._data


class _FakeSession:
    def __init__(self, execute_payloads: list[list], summaries: list) -> None:
        self._payloads = list(execute_payloads)
        self._summaries = summaries

    def execute(self, stmt):
        data = self._payloads.pop(0) if self._payloads else []
        return _FakeExecuteResult(data)

    def scalars(self, stmt):
        return _FakeScalarsResult(self._summaries)


class _FakeSessionContext:
    def __init__(self, session: _FakeSession) -> None:
        self._session = session

    def __enter__(self) -> _FakeSession:
        return self._session

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _SimpleRetrievalChildChunk:
    def __init__(self, id: str, content: str, score: float, position: int) -> None:
        self.id = id
        self.content = content
        self.score = score
        self.position = position


class _SimpleRetrievalSegment:
    def __init__(
        self,
        segment,
        child_chunks: list[_SimpleRetrievalChildChunk] | None = None,
        score: float | None = None,
        files: list[dict[str, str | int]] | None = None,
        summary: str | None = None,
    ) -> None:
        self.segment = segment
        self.child_chunks = child_chunks
        self.score = score
        self.files = files
        self.summary = summary


class TestRetrievalServiceInternals:
    @pytest.fixture
    def internal_dataset(self) -> Dataset:
        dataset = Mock(spec=Dataset)
        dataset.id = "dataset-id"
        dataset.tenant_id = "tenant-id"
        dataset.is_multimodal = False
        dataset.doc_form = IndexStructureType.PARENT_CHILD_INDEX
        return dataset

    @pytest.fixture
    def internal_flask_app(self):
        app = MagicMock()
        app.app_context.return_value.__enter__ = Mock()
        app.app_context.return_value.__exit__.return_value = False
        return app

    def test_retrieve_with_attachment_ids_only(self, monkeypatch: pytest.MonkeyPatch, internal_dataset):
        with (
            patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset", return_value=internal_dataset),
            patch("core.rag.datasource.retrieval_service.RetrievalService._retrieve") as mock_retrieve,
        ):
            executor = _ImmediateExecutor()
            monkeypatch.setattr(retrieval_service_module, "ThreadPoolExecutor", lambda *args, **kwargs: executor)
            monkeypatch.setattr(
                retrieval_service_module.concurrent.futures,
                "as_completed",
                lambda futures, timeout=None: iter(futures),
            )

            def side_effect(
                flask_app,
                retrieval_method,
                dataset,
                all_documents,
                exceptions,
                query=None,
                top_k=4,
                score_threshold=0.0,
                reranking_model=None,
                reranking_mode="reranking_model",
                weights=None,
                document_ids_filter=None,
                attachment_id=None,
            ):
                all_documents.append(create_mock_document(f"content-{attachment_id}", attachment_id or "none", 0.9))

            mock_retrieve.side_effect = side_effect

            results = RetrievalService.retrieve(
                retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
                dataset_id=internal_dataset.id,
                query="",
                attachment_ids=["att-1", "att-2"],
            )

        assert len(results) == 2
        assert {doc.metadata["doc_id"] for doc in results} == {"att-1", "att-2"}
        assert mock_retrieve.call_count == 2

    @patch("core.rag.datasource.retrieval_service.ExternalDatasetService.fetch_external_knowledge_retrieval")
    @patch("core.rag.datasource.retrieval_service.MetadataFilteringCondition.model_validate")
    @patch("core.rag.datasource.retrieval_service.db.session.scalar")
    def test_external_retrieve_with_metadata_conditions(self, mock_scalar, mock_validate, mock_fetch):
        mock_scalar.return_value = SimpleNamespace(tenant_id="tenant-1")
        mock_validate.return_value = "validated-condition"
        expected_documents = [create_mock_document("external-doc", "external-1", 0.8, provider="external")]
        mock_fetch.return_value = expected_documents

        results = RetrievalService.external_retrieve(
            dataset_id="dataset-1",
            query="test query",
            external_retrieval_model={"top_k": 3},
            metadata_filtering_conditions={"field": "source", "operator": "contains", "value": "manual"},
        )

        assert results == expected_documents
        mock_validate.assert_called_once()
        mock_fetch.assert_called_once_with(
            "tenant-1",
            "dataset-1",
            "test query",
            {"top_k": 3},
            metadata_condition="validated-condition",
        )

    @patch("core.rag.datasource.retrieval_service.db.session.scalar")
    def test_external_retrieve_returns_empty_when_dataset_not_found(self, mock_scalar):
        mock_scalar.return_value = None

        results = RetrievalService.external_retrieve(dataset_id="missing", query="q")

        assert results == []

    @patch("core.rag.datasource.retrieval_service.Session")
    def test_get_dataset_queries_by_id(self, mock_session_class):
        expected_dataset = Mock(spec=Dataset)
        mock_session = Mock()
        mock_session.scalar.return_value = expected_dataset
        mock_session_class.return_value.__enter__.return_value = mock_session

        with patch.object(retrieval_service_module, "db", SimpleNamespace(engine=Mock())):
            result = RetrievalService._get_dataset("dataset-123")

        assert result == expected_dataset
        mock_session.scalar.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.Keyword")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_keyword_search_success(self, mock_get_dataset, mock_keyword_class, internal_dataset, internal_flask_app):
        mock_get_dataset.return_value = internal_dataset
        keyword_instance = Mock()
        keyword_instance.search.return_value = [create_mock_document("keyword-content", "kw-1", 0.91)]
        mock_keyword_class.return_value = keyword_instance
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.keyword_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query='query "with quotes"',
            top_k=5,
            all_documents=all_documents,
            exceptions=exceptions,
        )

        assert len(all_documents) == 1
        assert exceptions == []
        keyword_instance.search.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_keyword_search_appends_exception_when_dataset_missing(self, mock_get_dataset, internal_flask_app):
        mock_get_dataset.return_value = None
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.keyword_search(
            flask_app=internal_flask_app,
            dataset_id="dataset-id",
            query="query",
            top_k=2,
            all_documents=all_documents,
            exceptions=exceptions,
        )

        assert all_documents == []
        assert exceptions == ["dataset not found"]

    @patch("core.rag.datasource.retrieval_service.Keyword")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_keyword_search_appends_exception_when_search_fails(
        self, mock_get_dataset, mock_keyword_class, internal_dataset, internal_flask_app
    ):
        mock_get_dataset.return_value = internal_dataset
        keyword_instance = Mock()
        keyword_instance.search.side_effect = RuntimeError("keyword failed")
        mock_keyword_class.return_value = keyword_instance
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.keyword_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="query",
            top_k=2,
            all_documents=all_documents,
            exceptions=exceptions,
        )

        assert all_documents == []
        assert exceptions == ["keyword failed"]

    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_embedding_search_text_without_reranking(
        self, mock_get_dataset, mock_vector_class, internal_dataset, internal_flask_app
    ):
        internal_dataset.is_multimodal = False
        mock_get_dataset.return_value = internal_dataset
        vector_instance = Mock()
        vector_instance.search_by_vector.return_value = [create_mock_document("vector-content", "vec-1", 0.7)]
        mock_vector_class.return_value = vector_instance
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.embedding_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="query",
            top_k=4,
            score_threshold=0.5,
            reranking_model=None,
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            exceptions=exceptions,
            document_ids_filter=["doc-1"],
            query_type=QueryType.TEXT_QUERY,
        )

        assert len(all_documents) == 1
        assert exceptions == []
        vector_instance.search_by_vector.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_embedding_search_image_non_multimodal_returns_early(
        self, mock_get_dataset, mock_vector_class, internal_dataset, internal_flask_app
    ):
        internal_dataset.is_multimodal = False
        mock_get_dataset.return_value = internal_dataset
        vector_instance = Mock()
        mock_vector_class.return_value = vector_instance
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.embedding_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="file-1",
            top_k=4,
            score_threshold=0.5,
            reranking_model=None,
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            exceptions=exceptions,
            query_type=QueryType.IMAGE_QUERY,
        )

        assert all_documents == []
        assert exceptions == []
        vector_instance.search_by_file.assert_not_called()

    @patch("core.rag.datasource.retrieval_service.ModelManager.for_tenant")
    @patch("core.rag.datasource.retrieval_service.DataPostProcessor")
    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_embedding_search_image_multimodal_with_vision_reranking(
        self,
        mock_get_dataset,
        mock_vector_class,
        mock_processor_class,
        mock_model_manager_class,
        internal_dataset,
        internal_flask_app,
    ):
        internal_dataset.is_multimodal = True
        mock_get_dataset.return_value = internal_dataset
        original_docs = [create_mock_document("image-content", "img-doc", 0.73)]
        reranked_docs = [create_mock_document("image-content-reranked", "img-doc", 0.97)]

        vector_instance = Mock()
        vector_instance.search_by_file.return_value = original_docs
        mock_vector_class.return_value = vector_instance

        processor_instance = Mock()
        processor_instance.invoke.return_value = reranked_docs
        mock_processor_class.return_value = processor_instance

        model_manager = Mock()
        model_manager.check_model_support_vision.return_value = True
        mock_model_manager_class.return_value = model_manager

        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.embedding_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="file-id",
            top_k=4,
            score_threshold=0.5,
            reranking_model={
                "reranking_provider_name": "provider",
                "reranking_model_name": "model",
            },
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            exceptions=exceptions,
            query_type=QueryType.IMAGE_QUERY,
        )

        assert all_documents == reranked_docs
        assert exceptions == []
        processor_instance.invoke.assert_called_once()
        mock_model_manager_class.assert_called_once_with(tenant_id=internal_dataset.tenant_id)
        model_manager.check_model_support_vision.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.ModelManager.for_tenant")
    @patch("core.rag.datasource.retrieval_service.DataPostProcessor")
    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_embedding_search_image_multimodal_without_vision_support(
        self,
        mock_get_dataset,
        mock_vector_class,
        mock_processor_class,
        mock_model_manager_class,
        internal_dataset,
        internal_flask_app,
    ):
        internal_dataset.is_multimodal = True
        mock_get_dataset.return_value = internal_dataset
        original_docs = [create_mock_document("image-content", "img-doc", 0.73)]

        vector_instance = Mock()
        vector_instance.search_by_file.return_value = original_docs
        mock_vector_class.return_value = vector_instance

        processor_instance = Mock()
        processor_instance.invoke.return_value = [create_mock_document("unused", "unused", 0.1)]
        mock_processor_class.return_value = processor_instance

        model_manager = Mock()
        model_manager.check_model_support_vision.return_value = False
        mock_model_manager_class.return_value = model_manager

        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.embedding_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="file-id",
            top_k=4,
            score_threshold=0.5,
            reranking_model={
                "reranking_provider_name": "provider",
                "reranking_model_name": "model",
            },
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            exceptions=exceptions,
            query_type=QueryType.IMAGE_QUERY,
        )

        assert all_documents == original_docs
        assert exceptions == []
        mock_model_manager_class.assert_called_once_with(tenant_id=internal_dataset.tenant_id)
        processor_instance.invoke.assert_not_called()

    @patch("core.rag.datasource.retrieval_service.DataPostProcessor")
    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_embedding_search_text_with_reranking_non_multimodal(
        self, mock_get_dataset, mock_vector_class, mock_processor_class, internal_dataset, internal_flask_app
    ):
        internal_dataset.is_multimodal = False
        mock_get_dataset.return_value = internal_dataset
        original_docs = [create_mock_document("vector-content", "vec-doc", 0.62)]
        reranked_docs = [create_mock_document("vector-content-reranked", "vec-doc", 0.89)]

        vector_instance = Mock()
        vector_instance.search_by_vector.return_value = original_docs
        mock_vector_class.return_value = vector_instance

        processor_instance = Mock()
        processor_instance.invoke.return_value = reranked_docs
        mock_processor_class.return_value = processor_instance

        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.embedding_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="query",
            top_k=4,
            score_threshold=0.5,
            reranking_model={
                "reranking_provider_name": "provider",
                "reranking_model_name": "model",
            },
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            exceptions=exceptions,
            query_type=QueryType.TEXT_QUERY,
        )

        assert all_documents == reranked_docs
        assert exceptions == []
        processor_instance.invoke.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_embedding_search_appends_exception_when_vector_fails(
        self, mock_get_dataset, mock_vector_class, internal_dataset, internal_flask_app
    ):
        mock_get_dataset.return_value = internal_dataset
        vector_instance = Mock()
        vector_instance.search_by_vector.side_effect = RuntimeError("vector failed")
        mock_vector_class.return_value = vector_instance
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.embedding_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="query",
            top_k=4,
            score_threshold=0.5,
            reranking_model=None,
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            exceptions=exceptions,
            query_type=QueryType.TEXT_QUERY,
        )

        assert all_documents == []
        assert exceptions == ["vector failed"]

    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_full_text_index_search_without_reranking(
        self, mock_get_dataset, mock_vector_class, internal_dataset, internal_flask_app
    ):
        mock_get_dataset.return_value = internal_dataset
        vector_instance = Mock()
        vector_instance.search_by_full_text.return_value = [create_mock_document("fulltext", "ft-1", 0.68)]
        mock_vector_class.return_value = vector_instance
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.full_text_index_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query='query "x"',
            top_k=4,
            score_threshold=0.4,
            reranking_model=None,
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.FULL_TEXT_SEARCH,
            exceptions=exceptions,
        )

        assert len(all_documents) == 1
        assert exceptions == []
        vector_instance.search_by_full_text.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.DataPostProcessor")
    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_full_text_index_search_with_reranking(
        self, mock_get_dataset, mock_vector_class, mock_processor_class, internal_dataset, internal_flask_app
    ):
        mock_get_dataset.return_value = internal_dataset
        original_docs = [create_mock_document("fulltext", "ft-1", 0.68)]
        reranked_docs = [create_mock_document("fulltext-reranked", "ft-1", 0.9)]

        vector_instance = Mock()
        vector_instance.search_by_full_text.return_value = original_docs
        mock_vector_class.return_value = vector_instance

        processor_instance = Mock()
        processor_instance.invoke.return_value = reranked_docs
        mock_processor_class.return_value = processor_instance

        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.full_text_index_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="query",
            top_k=4,
            score_threshold=0.4,
            reranking_model={
                "reranking_provider_name": "provider",
                "reranking_model_name": "model",
            },
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.FULL_TEXT_SEARCH,
            exceptions=exceptions,
        )

        assert all_documents == reranked_docs
        assert exceptions == []
        processor_instance.invoke.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_full_text_index_search_dataset_not_found(self, mock_get_dataset, internal_flask_app):
        mock_get_dataset.return_value = None
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.full_text_index_search(
            flask_app=internal_flask_app,
            dataset_id="dataset-id",
            query="query",
            top_k=4,
            score_threshold=0.4,
            reranking_model=None,
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.FULL_TEXT_SEARCH,
            exceptions=exceptions,
        )

        assert all_documents == []
        assert exceptions == ["dataset not found"]

    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_full_text_index_search_appends_exception_when_search_fails(
        self, mock_get_dataset, mock_vector_class, internal_dataset, internal_flask_app
    ):
        mock_get_dataset.return_value = internal_dataset
        vector_instance = Mock()
        vector_instance.search_by_full_text.side_effect = RuntimeError("fulltext failed")
        mock_vector_class.return_value = vector_instance
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.full_text_index_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="query",
            top_k=4,
            score_threshold=0.4,
            reranking_model=None,
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.FULL_TEXT_SEARCH,
            exceptions=exceptions,
        )

        assert all_documents == []
        assert exceptions == ["fulltext failed"]

    def test_format_retrieval_documents_with_empty_input_returns_empty_list(self):
        assert RetrievalService.format_retrieval_documents([]) == []

    def test_format_retrieval_documents_without_document_id_returns_empty_list(self):
        documents = [Document(page_content="content", metadata={"doc_id": "doc-1", "score": 0.4}, provider="dify")]

        assert RetrievalService.format_retrieval_documents(documents) == []

    def test_format_retrieval_documents_with_parent_child_summary_and_attachments(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        dataset_doc_parent = SimpleNamespace(
            id="doc-parent",
            doc_form=IndexStructureType.PARENT_CHILD_INDEX,
            dataset_id="dataset-id",
        )
        dataset_doc_text = SimpleNamespace(id="doc-text", doc_form="paragraph", dataset_id="dataset-id")
        dataset_doc_parent_summary = SimpleNamespace(
            id="doc-parent-summary",
            doc_form=IndexStructureType.PARENT_CHILD_INDEX,
            dataset_id="dataset-id",
        )

        scalars_result = Mock()
        scalars_result.all.return_value = [
            dataset_doc_parent,
            dataset_doc_text,
            dataset_doc_parent_summary,
        ]
        monkeypatch.setattr(retrieval_service_module.db.session, "scalars", Mock(return_value=scalars_result))
        monkeypatch.setattr(retrieval_service_module, "RetrievalChildChunk", _SimpleRetrievalChildChunk)
        monkeypatch.setattr(retrieval_service_module, "RetrievalSegments", _SimpleRetrievalSegment)

        input_documents = [
            Document(
                page_content="child node content",
                metadata={"document_id": "doc-parent", "doc_id": "child-node-1", "score": 0.7},
                provider="dify",
            ),
            Document(
                page_content="parent image",
                metadata={
                    "document_id": "doc-parent",
                    "doc_id": "attach-node-1",
                    "doc_type": DocType.IMAGE,
                    "score": 0.8,
                },
                provider="dify",
            ),
            Document(
                page_content="text index node",
                metadata={"document_id": "doc-text", "doc_id": "index-node-1", "score": 0.6},
                provider="dify",
            ),
            Document(
                page_content="text image node",
                metadata={
                    "document_id": "doc-text",
                    "doc_id": "attach-text-1",
                    "doc_type": DocType.IMAGE,
                    "score": 0.65,
                },
                provider="dify",
            ),
            Document(
                page_content="summary candidate 1",
                metadata={
                    "document_id": "doc-text",
                    "doc_id": "summary-node-1",
                    "is_summary": True,
                    "original_chunk_id": "segment-summary",
                    "score": "0.9",
                },
                provider="dify",
            ),
            Document(
                page_content="summary candidate 2",
                metadata={
                    "document_id": "doc-text",
                    "doc_id": "summary-node-2",
                    "is_summary": True,
                    "original_chunk_id": "segment-summary",
                    "score": "0.95",
                },
                provider="dify",
            ),
            Document(
                page_content="invalid score summary",
                metadata={
                    "document_id": "doc-parent-summary",
                    "doc_id": "summary-parent-invalid",
                    "is_summary": True,
                    "original_chunk_id": "segment-parent-summary",
                    "score": "invalid",
                },
                provider="dify",
            ),
            Document(
                page_content="valid parent summary",
                metadata={
                    "document_id": "doc-parent-summary",
                    "doc_id": "summary-parent-valid",
                    "is_summary": True,
                    "original_chunk_id": "segment-parent-summary",
                    "score": "0.4",
                },
                provider="dify",
            ),
        ]

        child_chunk = SimpleNamespace(
            id="child-chunk-1",
            segment_id="segment-parent",
            index_node_id="child-node-1",
            content="child details",
            position=2,
        )
        segment_parent = SimpleNamespace(id="segment-parent", document_id="doc-parent", index_node_id="parent-node")
        segment_text = SimpleNamespace(id="segment-text", document_id="doc-text", index_node_id="index-node-1")
        segment_summary = SimpleNamespace(id="segment-summary", document_id="doc-text", index_node_id="summary-node")
        segment_parent_summary = SimpleNamespace(
            id="segment-parent-summary",
            document_id="doc-parent-summary",
            index_node_id="summary-parent-node",
        )

        fake_session = _FakeSession(
            execute_payloads=[
                [child_chunk],
                [segment_text],
                [segment_parent, segment_text],
                [segment_summary, segment_parent_summary],
            ],
            summaries=[
                SimpleNamespace(chunk_id="segment-summary", summary_content="summary for text"),
                SimpleNamespace(chunk_id="segment-parent-summary", summary_content="summary for parent"),
            ],
        )
        monkeypatch.setattr(
            retrieval_service_module.session_factory,
            "create_session",
            lambda: _FakeSessionContext(fake_session),
        )
        monkeypatch.setattr(
            RetrievalService,
            "get_segment_attachment_infos",
            lambda attachment_ids, session: [
                {
                    "attachment_id": "attach-node-1",
                    "attachment_info": {
                        "id": "attach-node-1",
                        "name": "img-parent",
                        "extension": ".png",
                        "mime_type": "image/png",
                        "source_url": "signed://parent",
                        "size": 11,
                    },
                    "segment_id": "segment-parent",
                },
                {
                    "attachment_id": "attach-text-1",
                    "attachment_info": {
                        "id": "attach-text-1",
                        "name": "img-text",
                        "extension": ".png",
                        "mime_type": "image/png",
                        "source_url": "signed://text",
                        "size": 22,
                    },
                    "segment_id": "segment-text",
                },
            ],
        )

        result = RetrievalService.format_retrieval_documents(input_documents)

        assert len(result) == 4
        result_by_segment_id = {item.segment.id: item for item in result}
        assert result_by_segment_id["segment-summary"].score == pytest.approx(0.95)
        assert result_by_segment_id["segment-summary"].summary == "summary for text"
        assert result_by_segment_id["segment-parent"].score == pytest.approx(0.8)
        assert result_by_segment_id["segment-parent"].files is not None
        assert len(result_by_segment_id["segment-parent"].child_chunks or []) == 1
        assert result_by_segment_id["segment-text"].score == pytest.approx(0.65)
        assert result_by_segment_id["segment-parent-summary"].score == pytest.approx(0.4)
        assert result_by_segment_id["segment-parent-summary"].summary == "summary for parent"
        assert result_by_segment_id["segment-parent-summary"].child_chunks == []

    def test_format_retrieval_documents_rolls_back_and_raises_when_db_fails(self, monkeypatch: pytest.MonkeyPatch):
        rollback = Mock()
        monkeypatch.setattr(retrieval_service_module.db.session, "rollback", rollback)
        monkeypatch.setattr(retrieval_service_module.db.session, "scalars", Mock(side_effect=RuntimeError("db error")))

        documents = [Document(page_content="content", metadata={"document_id": "doc-1"}, provider="dify")]

        with pytest.raises(RuntimeError, match="db error"):
            RetrievalService.format_retrieval_documents(documents)

        rollback.assert_called_once()

    def test_retrieve_internal_returns_early_without_query_or_attachment(self, internal_dataset, internal_flask_app):
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService()._retrieve(
            flask_app=internal_flask_app,
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            dataset=internal_dataset,
            all_documents=all_documents,
            exceptions=exceptions,
            query=None,
            attachment_id=None,
        )

        assert all_documents == []
        assert exceptions == []

    def test_retrieve_internal_cancels_futures_when_future_has_exception(self, internal_dataset, internal_flask_app):
        future_error = Mock()
        future_error.exception.return_value = RuntimeError("future failed")
        future_ok = Mock()
        future_ok.exception.return_value = None

        with (
            patch("core.rag.datasource.retrieval_service.ThreadPoolExecutor") as mock_executor,
            patch(
                "core.rag.datasource.retrieval_service.concurrent.futures.as_completed",
                return_value=[future_error, future_ok],
            ),
        ):
            mock_executor_instance = Mock()
            mock_executor_instance.submit.side_effect = [future_error, future_ok]
            mock_executor.return_value.__enter__.return_value = mock_executor_instance
            RetrievalService()._retrieve(
                flask_app=internal_flask_app,
                retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
                dataset=internal_dataset,
                all_documents=[],
                exceptions=[],
                query="query",
                attachment_id="file-1",
            )

        future_error.cancel.assert_called()
        future_ok.cancel.assert_called()

    def test_retrieve_internal_raises_value_error_when_exceptions_exist(
        self, monkeypatch: pytest.MonkeyPatch, internal_dataset, internal_flask_app
    ):
        executor = _ImmediateExecutor()
        monkeypatch.setattr(retrieval_service_module, "ThreadPoolExecutor", lambda *args, **kwargs: executor)
        monkeypatch.setattr(
            retrieval_service_module.concurrent.futures,
            "as_completed",
            lambda futures, timeout=None: iter(futures),
        )

        with patch("core.rag.datasource.retrieval_service.RetrievalService.keyword_search") as mock_keyword_search:
            mock_keyword_search.side_effect = lambda *args, **kwargs: None
            with pytest.raises(ValueError, match="keyword error"):
                RetrievalService()._retrieve(
                    flask_app=internal_flask_app,
                    retrieval_method=RetrievalMethod.KEYWORD_SEARCH,
                    dataset=internal_dataset,
                    all_documents=[],
                    exceptions=["keyword error"],
                    query="query",
                )

    def test_retrieve_internal_hybrid_weighted_attachment_flow(
        self, monkeypatch: pytest.MonkeyPatch, internal_dataset, internal_flask_app
    ):
        executor = _ImmediateExecutor()
        monkeypatch.setattr(retrieval_service_module, "ThreadPoolExecutor", lambda *args, **kwargs: executor)
        monkeypatch.setattr(
            retrieval_service_module.concurrent.futures,
            "as_completed",
            lambda futures, timeout=None: iter(futures),
        )

        text_doc = create_mock_document("text", "text-doc", 0.81)
        image_doc = create_mock_document("image", "image-doc", 0.72)
        fulltext_doc = create_mock_document("full", "full-doc", 0.65)
        processed_doc = create_mock_document("processed", "processed-doc", 0.99)

        with (
            patch("core.rag.datasource.retrieval_service.RetrievalService.embedding_search") as mock_embedding_search,
            patch("core.rag.datasource.retrieval_service.RetrievalService.full_text_index_search") as mock_fulltext,
            patch("core.rag.datasource.retrieval_service.DataPostProcessor") as mock_processor_class,
        ):

            def embedding_side_effect(
                flask_app,
                dataset_id,
                query,
                top_k,
                score_threshold,
                reranking_model,
                all_documents,
                retrieval_method,
                exceptions,
                document_ids_filter=None,
                query_type=QueryType.TEXT_QUERY,
            ):
                if query_type == QueryType.IMAGE_QUERY:
                    all_documents.append(image_doc)
                else:
                    all_documents.append(text_doc)

            mock_embedding_search.side_effect = embedding_side_effect

            def fulltext_side_effect(
                flask_app,
                dataset_id,
                query,
                top_k,
                score_threshold,
                reranking_model,
                all_documents,
                retrieval_method,
                exceptions,
                document_ids_filter=None,
            ):
                all_documents.append(fulltext_doc)

            mock_fulltext.side_effect = fulltext_side_effect
            processor_instance = Mock()
            processor_instance.invoke.return_value = [processed_doc]
            mock_processor_class.return_value = processor_instance

            all_documents: list[Document] = []
            RetrievalService()._retrieve(
                flask_app=internal_flask_app,
                retrieval_method=RetrievalMethod.HYBRID_SEARCH,
                dataset=internal_dataset,
                all_documents=all_documents,
                exceptions=[],
                query="query",
                attachment_id="file-1",
                reranking_mode=RerankMode.WEIGHTED_SCORE,
                top_k=3,
            )

        assert len(all_documents) == 4
        assert any(doc.metadata["doc_id"] == "processed-doc" for doc in all_documents)
        processor_instance.invoke.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.sign_upload_file_preview_url", return_value="signed://file")
    def test_get_segment_attachment_info_success(self, mock_sign):
        upload_file = SimpleNamespace(
            id="upload-1",
            name="file-name",
            extension="png",
            mime_type="image/png",
            size=42,
        )
        binding = SimpleNamespace(segment_id="segment-1", attachment_id="upload-1")
        session = Mock()
        session.scalar.side_effect = [upload_file, binding]

        result = RetrievalService.get_segment_attachment_info("dataset-id", "tenant-id", "upload-1", session)

        assert result == {
            "attachment_info": {
                "id": "upload-1",
                "name": "file-name",
                "extension": ".png",
                "mime_type": "image/png",
                "source_url": "signed://file",
                "size": 42,
            },
            "segment_id": "segment-1",
        }
        mock_sign.assert_called_once_with("upload-1", "png")

    def test_get_segment_attachment_info_returns_none_when_binding_missing(self):
        upload_file = SimpleNamespace(
            id="upload-1",
            name="file-name",
            extension="png",
            mime_type="image/png",
            size=42,
        )
        session = Mock()
        session.scalar.side_effect = [upload_file, None]

        result = RetrievalService.get_segment_attachment_info("dataset-id", "tenant-id", "upload-1", session)

        assert result is None

    def test_get_segment_attachment_info_returns_none_when_upload_file_missing(self):
        session = Mock()
        session.scalar.return_value = None

        result = RetrievalService.get_segment_attachment_info("dataset-id", "tenant-id", "upload-1", session)

        assert result is None

    def test_get_segment_attachment_infos_returns_empty_when_upload_files_missing(self):
        scalars_result = Mock()
        scalars_result.all.return_value = []
        session = Mock()
        session.scalars.return_value = scalars_result

        result = RetrievalService.get_segment_attachment_infos(["upload-1"], session)

        assert result == []

    def test_get_segment_attachment_infos_returns_empty_when_bindings_missing(self):
        upload_file = SimpleNamespace(
            id="upload-1",
            name="file-name",
            extension="png",
            mime_type="image/png",
            size=42,
        )
        upload_scalars = Mock()
        upload_scalars.all.return_value = [upload_file]
        binding_scalars = Mock()
        binding_scalars.all.return_value = []
        session = Mock()
        session.scalars.side_effect = [upload_scalars, binding_scalars]

        result = RetrievalService.get_segment_attachment_infos(["upload-1"], session)

        assert result == []

    @patch("core.rag.datasource.retrieval_service.sign_upload_file_preview_url", return_value="signed://file")
    def test_get_segment_attachment_infos_success(self, mock_sign):
        upload_file_1 = SimpleNamespace(
            id="upload-1",
            name="file-1",
            extension="png",
            mime_type="image/png",
            size=42,
        )
        upload_file_2 = SimpleNamespace(
            id="upload-2",
            name="file-2",
            extension="jpg",
            mime_type="image/jpeg",
            size=99,
        )
        binding = SimpleNamespace(attachment_id="upload-1", segment_id="segment-1")

        upload_scalars = Mock()
        upload_scalars.all.return_value = [upload_file_1, upload_file_2]
        binding_scalars = Mock()
        binding_scalars.all.return_value = [binding]
        session = Mock()
        session.scalars.side_effect = [upload_scalars, binding_scalars]

        result = RetrievalService.get_segment_attachment_infos(["upload-1", "upload-2"], session)

        assert result == [
            {
                "attachment_id": "upload-1",
                "attachment_info": {
                    "id": "upload-1",
                    "name": "file-1",
                    "extension": ".png",
                    "mime_type": "image/png",
                    "source_url": "signed://file",
                    "size": 42,
                },
                "segment_id": "segment-1",
            }
        ]
        mock_sign.assert_has_calls(
            [
                call("upload-1", "png"),
                call("upload-2", "jpg"),
            ]
        )
        assert mock_sign.call_count == 2
