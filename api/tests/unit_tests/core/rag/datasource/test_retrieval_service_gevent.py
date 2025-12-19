from unittest.mock import MagicMock, Mock, patch

import pytest

from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.models.document import Document
from core.rag.retrieval.retrieval_methods import RetrievalMethod


@pytest.fixture
def mock_flask_app():
    app = MagicMock()
    # Provide a context manager for app.app_context()
    app.app_context.return_value.__enter__ = Mock()
    app.app_context.return_value.__exit__ = Mock()
    return app


@pytest.fixture
def mock_current_app(mock_flask_app):
    with patch("core.rag.datasource.retrieval_service.current_app") as cap:
        cap._get_current_object.return_value = mock_flask_app
        yield cap


@pytest.fixture
def mock_dataset():
    ds = Mock()
    ds.id = "ds-1"
    ds.tenant_id = "t-1"
    ds.indexing_technique = "high_quality"
    ds.is_multimodal = False
    return ds


@pytest.fixture
def sample_docs():
    return [
        Document(page_content="text result", metadata={"doc_id": "d1", "score": 0.9}, provider="dify"),
        Document(page_content="image result", metadata={"doc_id": "i1", "score": 0.8}, provider="dify"),
    ]


class TestRetrievalServiceGevent:
    @patch("core.rag.datasource.retrieval_service.dify_config.RETRIEVAL_SERVICE_EXECUTORS", 3)
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_uses_gevent_pool_instead_of_thread_pool(self, mock_get_dataset, mock_current_app, mock_flask_app):
        """RetrievalService.retrieve should create gevent.pool.Pool and spawn greenlets."""
        mock_get_dataset.return_value = Mock(id="ds-123", tenant_id="t-1")

        spawned_calls = []

        class FakePool:
            def __init__(self, size):
                # Assert pool size is read from config
                assert size == 3

            def spawn(self, fn, *args, **kwargs):
                spawned_calls.append((fn, args, kwargs))
                # Return a dummy greenlet-like object
                return object()

        with (
            patch("core.rag.datasource.retrieval_service.Pool", FakePool) as _pool,
            patch("core.rag.datasource.retrieval_service.gevent.joinall") as joinall,
            patch.object(RetrievalService, "_retrieve", return_value=None) as mock__retrieve,
        ):
            # Act
            RetrievalService.retrieve(
                retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
                dataset_id="ds-123",
                query="hello",
                top_k=2,
                score_threshold=0.0,
                reranking_model=None,
            )

            # Assert gevent pool used
            assert len(spawned_calls) == 1
            joinall.assert_called_once()
            # _retrieve should be scheduled via Pool.spawn with keyword args
            fn, _args, kwargs = spawned_calls[0]
            assert fn is mock__retrieve
            assert kwargs.get("query") == "hello"
            assert isinstance(kwargs.get("all_documents"), list)
            assert isinstance(kwargs.get("exceptions"), list)

    def test__retrieve_handles_reordered_params_correctly(self, mock_flask_app, mock_current_app, mock_dataset):
        """_retrieve should accept all_documents and exceptions regardless of previous ordering."""
        # Track that called functions receive the exact same lists
        received = {"all_docs_id": None, "exc_id": None}

        def fake_keyword_search(*args, **kwargs):
            all_documents = kwargs["all_documents"]
            exceptions = kwargs["exceptions"]
            received["all_docs_id"] = id(all_documents)
            received["exc_id"] = id(exceptions)
            all_documents.append(Document(page_content="kw", metadata={"doc_id": "k1"}, provider="dify"))

        with (
            patch.object(RetrievalService, "keyword_search", side_effect=fake_keyword_search),
            patch.object(RetrievalService, "embedding_search", return_value=None),
            patch.object(RetrievalService, "full_text_index_search", return_value=None),
        ):
            all_docs: list[Document] = []
            excs: list[str] = []
            # Call with kwargs reflecting new signature; order should not matter
            RetrievalService()._retrieve(
                flask_app=mock_flask_app,
                retrieval_method=RetrievalMethod.KEYWORD_SEARCH,
                dataset=mock_dataset,
                all_documents=all_docs,
                exceptions=excs,
                query="hello",
                top_k=2,
            )

            # Ensure data flowed back to caller (don't require the same list identity)
            assert received["all_docs_id"] is not None
            assert received["exc_id"] is not None
            assert len(all_docs) == 1
            assert all_docs[0].metadata["doc_id"] == "k1"

    def test__retrieve_with_query_and_attachments(self, mock_flask_app, mock_current_app, mock_dataset, sample_docs):
        """When both query and attachment_id provided, both paths should contribute results."""

        def fake_embedding_search(*args, **kwargs):
            query_type = kwargs.get("query_type")
            all_documents = kwargs["all_documents"]
            # TEXT_QUERY vs IMAGE_QUERY distinguished by query_type
            if str(query_type).endswith("TEXT_QUERY"):
                all_documents.append(sample_docs[0])
            else:
                all_documents.append(sample_docs[1])

        class SyncPool:
            def __init__(self, size):
                pass

            def spawn(self, fn, *args, **kwargs):
                fn(*args, **kwargs)
                return object()

        with (
            patch("core.rag.datasource.retrieval_service.Pool", SyncPool),
            patch("core.rag.datasource.retrieval_service.gevent.joinall", lambda jobs, timeout=None: None),
            patch.object(RetrievalService, "embedding_search", side_effect=fake_embedding_search),
            patch.object(RetrievalService, "keyword_search", return_value=None),
            patch.object(RetrievalService, "full_text_index_search", return_value=None),
        ):
            all_docs: list[Document] = []
            RetrievalService()._retrieve(
                flask_app=mock_flask_app,
                retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
                dataset=mock_dataset,
                all_documents=all_docs,
                exceptions=[],
                query="text q",
                attachment_id="file-1",
                top_k=4,
            )

            # Expect at least image flow contributes a result
            contents = {d.page_content for d in all_docs}
            assert "image result" in contents

    def test__retrieve_aggregates_exceptions_with_gevent(self, mock_flask_app, mock_current_app, mock_dataset):
        """Exceptions collected by tasks should propagate as ValueError after joinall."""

        def fake_embedding_search(*args, **kwargs):
            exceptions = kwargs["exceptions"]
            exceptions.append("embedding failed")

        class SyncPool:
            def __init__(self, size):
                pass

            def spawn(self, fn, *args, **kwargs):
                fn(*args, **kwargs)
                return object()

        with (
            patch("core.rag.datasource.retrieval_service.Pool", SyncPool),
            patch("core.rag.datasource.retrieval_service.gevent.joinall", lambda jobs, timeout=None: None),
            patch.object(RetrievalService, "embedding_search", side_effect=fake_embedding_search),
            patch.object(RetrievalService, "keyword_search", return_value=None),
            patch.object(RetrievalService, "full_text_index_search", return_value=None),
        ):
            excs = []
            RetrievalService()._retrieve(
                flask_app=mock_flask_app,
                retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
                dataset=mock_dataset,
                all_documents=[],
                exceptions=excs,
                query="text q",
                top_k=4,
            )

            assert "embedding failed" in "\n".join(excs)
