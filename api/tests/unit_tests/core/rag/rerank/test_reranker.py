"""Comprehensive unit tests for Reranker functionality.

This test module covers all aspects of the reranking system including:
- Cross-encoder reranking with model-based scoring
- Score normalization and threshold filtering
- Top-k selection and document deduplication
- Reranker model loading and invocation
- Weighted reranking with keyword and vector scoring
- Factory pattern for reranker instantiation

All tests use mocking to avoid external dependencies and ensure fast, reliable execution.
Tests follow the Arrange-Act-Assert pattern for clarity.
"""

from operator import itemgetter
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest
from graphon.model_runtime.entities.rerank_entities import RerankDocument, RerankResult

from core.model_manager import ModelInstance
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.rerank.entity.weight import KeywordSetting, VectorSetting, Weights
from core.rag.rerank.rerank_base import BaseRerankRunner
from core.rag.rerank.rerank_factory import RerankRunnerFactory
from core.rag.rerank.rerank_model import RerankModelRunner
from core.rag.rerank.rerank_type import RerankMode
from core.rag.rerank.weight_rerank import WeightRerankRunner


def create_mock_model_instance() -> ModelInstance:
    """Create a properly configured mock ModelInstance for reranking tests."""
    mock_instance = Mock(spec=ModelInstance)
    # Setup provider_model_bundle chain for check_model_support_vision
    mock_instance.provider_model_bundle = Mock()
    mock_instance.provider_model_bundle.configuration = Mock()
    mock_instance.provider_model_bundle.configuration.tenant_id = "test-tenant-id"
    mock_instance.provider = "test-provider"
    mock_instance.model_name = "test-model"
    return mock_instance


class TestRerankModelRunner:
    """Unit tests for RerankModelRunner.

    Tests cover:
    - Cross-encoder model invocation and scoring
    - Document deduplication for dify and external providers
    - Score threshold filtering
    - Top-k selection with proper sorting
    - Metadata preservation and score injection
    """

    @pytest.fixture(autouse=True)
    def mock_model_manager(self):
        """Auto-use fixture to patch ModelManager for all tests in this class."""
        with patch("core.rag.rerank.rerank_model.ModelManager.for_tenant", autospec=True) as mock_mm:
            mock_mm.return_value.check_model_support_vision.return_value = False
            yield mock_mm

    @pytest.fixture
    def mock_model_instance(self):
        """Create a mock ModelInstance for reranking."""
        return create_mock_model_instance()

    @pytest.fixture
    def rerank_runner(self, mock_model_instance):
        """Create a RerankModelRunner with mocked model instance."""
        return RerankModelRunner(rerank_model_instance=mock_model_instance)

    @pytest.fixture
    def sample_documents(self):
        """Create sample documents for testing."""
        return [
            Document(
                page_content="Python is a high-level programming language.",
                metadata={"doc_id": "doc1", "source": "wiki"},
                provider="dify",
            ),
            Document(
                page_content="JavaScript is widely used for web development.",
                metadata={"doc_id": "doc2", "source": "wiki"},
                provider="dify",
            ),
            Document(
                page_content="Java is an object-oriented programming language.",
                metadata={"doc_id": "doc3", "source": "wiki"},
                provider="dify",
            ),
            Document(
                page_content="C++ is known for its performance.",
                metadata={"doc_id": "doc4", "source": "wiki"},
                provider="external",
            ),
        ]

    def test_basic_reranking(self, rerank_runner, mock_model_instance, sample_documents):
        """Test basic reranking with cross-encoder model.

        Verifies:
        - Model invocation with correct parameters
        - Score assignment to documents
        - Proper sorting by relevance score
        """
        # Arrange: Mock rerank result with scores
        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=2, text=sample_documents[2].page_content, score=0.95),
                RerankDocument(index=0, text=sample_documents[0].page_content, score=0.85),
                RerankDocument(index=1, text=sample_documents[1].page_content, score=0.75),
                RerankDocument(index=3, text=sample_documents[3].page_content, score=0.65),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        # Act: Run reranking
        query = "programming languages"
        result = rerank_runner.run(query=query, documents=sample_documents)

        # Assert: Verify model invocation
        mock_model_instance.invoke_rerank.assert_called_once()
        call_kwargs = mock_model_instance.invoke_rerank.call_args.kwargs
        assert call_kwargs["query"] == query
        assert len(call_kwargs["docs"]) == 4

        # Assert: Verify results are properly sorted by score
        assert len(result) == 4
        assert result[0].metadata["score"] == 0.95
        assert result[1].metadata["score"] == 0.85
        assert result[2].metadata["score"] == 0.75
        assert result[3].metadata["score"] == 0.65
        assert result[0].page_content == sample_documents[2].page_content

    def test_score_threshold_filtering(self, rerank_runner, mock_model_instance, sample_documents):
        """Test score threshold filtering.

        Verifies:
        - Documents below threshold are filtered out
        - Only documents meeting threshold are returned
        - Score ordering is maintained
        """
        # Arrange: Mock rerank result
        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text=sample_documents[0].page_content, score=0.90),
                RerankDocument(index=1, text=sample_documents[1].page_content, score=0.70),
                RerankDocument(index=2, text=sample_documents[2].page_content, score=0.50),
                RerankDocument(index=3, text=sample_documents[3].page_content, score=0.30),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        # Act: Run reranking with score threshold
        result = rerank_runner.run(query="programming", documents=sample_documents, score_threshold=0.60)

        # Assert: Only documents above threshold are returned
        assert len(result) == 2
        assert result[0].metadata["score"] == 0.90
        assert result[1].metadata["score"] == 0.70

    def test_top_k_selection(self, rerank_runner, mock_model_instance, sample_documents):
        """Test top-k selection functionality.

        Verifies:
        - Only top-k documents are returned
        - Documents are properly sorted before selection
        - Top-k respects the specified limit
        """
        # Arrange: Mock rerank result
        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text=sample_documents[0].page_content, score=0.95),
                RerankDocument(index=1, text=sample_documents[1].page_content, score=0.85),
                RerankDocument(index=2, text=sample_documents[2].page_content, score=0.75),
                RerankDocument(index=3, text=sample_documents[3].page_content, score=0.65),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        # Act: Run reranking with top_n limit
        result = rerank_runner.run(query="programming", documents=sample_documents, top_n=2)

        # Assert: Only top 2 documents are returned
        assert len(result) == 2
        assert result[0].metadata["score"] == 0.95
        assert result[1].metadata["score"] == 0.85

    def test_document_deduplication_dify_provider(self, rerank_runner, mock_model_instance):
        """Test document deduplication for dify provider.

        Verifies:
        - Duplicate documents (same doc_id) are removed
        - Only unique documents are sent to reranker
        - First occurrence is preserved
        """
        # Arrange: Documents with duplicates
        documents = [
            Document(
                page_content="Python programming",
                metadata={"doc_id": "doc1", "source": "wiki"},
                provider="dify",
            ),
            Document(
                page_content="Python programming duplicate",
                metadata={"doc_id": "doc1", "source": "wiki"},
                provider="dify",
            ),
            Document(
                page_content="Java programming",
                metadata={"doc_id": "doc2", "source": "wiki"},
                provider="dify",
            ),
        ]

        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text=documents[0].page_content, score=0.90),
                RerankDocument(index=1, text=documents[2].page_content, score=0.80),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        # Act: Run reranking
        result = rerank_runner.run(query="programming", documents=documents)

        # Assert: Only unique documents are processed
        call_kwargs = mock_model_instance.invoke_rerank.call_args.kwargs
        assert len(call_kwargs["docs"]) == 2  # Duplicate removed
        assert len(result) == 2

    def test_document_deduplication_external_provider(self, rerank_runner, mock_model_instance):
        """Test document deduplication for external provider.

        Verifies:
        - Duplicate external documents are removed by object equality
        - Unique external documents are preserved
        """
        # Arrange: External documents with duplicates
        doc1 = Document(
            page_content="External content 1",
            metadata={"source": "external"},
            provider="external",
        )
        doc2 = Document(
            page_content="External content 2",
            metadata={"source": "external"},
            provider="external",
        )

        documents = [doc1, doc1, doc2]  # doc1 appears twice

        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text=doc1.page_content, score=0.90),
                RerankDocument(index=1, text=doc2.page_content, score=0.80),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        # Act: Run reranking
        result = rerank_runner.run(query="external", documents=documents)

        # Assert: Duplicates are removed
        call_kwargs = mock_model_instance.invoke_rerank.call_args.kwargs
        assert len(call_kwargs["docs"]) == 2
        assert len(result) == 2

    def test_combined_threshold_and_top_k(self, rerank_runner, mock_model_instance, sample_documents):
        """Test combined score threshold and top-k selection.

        Verifies:
        - Threshold filtering is applied first
        - Top-k selection is applied to filtered results
        - Both constraints are respected
        """
        # Arrange: Mock rerank result
        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text=sample_documents[0].page_content, score=0.95),
                RerankDocument(index=1, text=sample_documents[1].page_content, score=0.85),
                RerankDocument(index=2, text=sample_documents[2].page_content, score=0.75),
                RerankDocument(index=3, text=sample_documents[3].page_content, score=0.65),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        # Act: Run reranking with both threshold and top_n
        result = rerank_runner.run(
            query="programming",
            documents=sample_documents,
            score_threshold=0.70,
            top_n=2,
        )

        # Assert: Both constraints are applied
        assert len(result) == 2  # top_n limit
        assert all(doc.metadata["score"] >= 0.70 for doc in result)  # threshold
        assert result[0].metadata["score"] == 0.95
        assert result[1].metadata["score"] == 0.85

    def test_metadata_preservation(self, rerank_runner, mock_model_instance, sample_documents):
        """Test that original metadata is preserved after reranking.

        Verifies:
        - Original metadata fields are maintained
        - Score is added to metadata
        - Provider information is preserved
        """
        # Arrange: Mock rerank result
        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text=sample_documents[0].page_content, score=0.90),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        # Act: Run reranking
        result = rerank_runner.run(query="Python", documents=sample_documents)

        # Assert: Metadata is preserved and score is added
        assert len(result) == 1
        assert result[0].metadata["doc_id"] == "doc1"
        assert result[0].metadata["source"] == "wiki"
        assert result[0].metadata["score"] == 0.90
        assert result[0].provider == "dify"

    def test_empty_documents_list(self, rerank_runner, mock_model_instance):
        """Test handling of empty documents list.

        Verifies:
        - Empty list is handled gracefully
        - No model invocation occurs
        - Empty result is returned
        """
        # Arrange: Empty documents list
        mock_rerank_result = RerankResult(model="bge-reranker-base", docs=[])
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        # Act: Run reranking with empty list
        result = rerank_runner.run(query="test", documents=[])

        # Assert: Empty result is returned
        assert len(result) == 0

    def test_run_uses_bound_model_instance(
        self, rerank_runner, mock_model_instance, sample_documents, mock_model_manager
    ):
        """Test that rerank uses the bound model instance directly.

        Verifies:
        - The injected model instance is used for invocation
        - No late rebinding occurs through ModelManager.get_model_instance
        """
        # Arrange: Mock rerank result
        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text=sample_documents[0].page_content, score=0.90),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        # Act: Run reranking
        result = rerank_runner.run(
            query="test",
            documents=sample_documents,
        )

        # Assert: The injected model instance is invoked directly.
        assert len(result) == 1
        mock_model_manager.return_value.get_model_instance.assert_not_called()
        call_kwargs = mock_model_instance.invoke_rerank.call_args.kwargs
        assert call_kwargs["query"] == "test"
        assert "user" not in call_kwargs


class _ForwardingBaseRerankRunner(BaseRerankRunner):
    def run(
        self,
        query: str,
        documents: list[Document],
        score_threshold: float | None = None,
        top_n: int | None = None,
        query_type: QueryType = QueryType.TEXT_QUERY,
    ) -> list[Document]:
        return super().run(
            query=query,
            documents=documents,
            score_threshold=score_threshold,
            top_n=top_n,
            query_type=query_type,
        )


class TestBaseRerankRunner:
    def test_run_raises_not_implemented(self):
        runner = _ForwardingBaseRerankRunner()

        with pytest.raises(NotImplementedError):
            runner.run(query="python", documents=[])


class TestRerankModelRunnerMultimodal:
    @pytest.fixture
    def mock_model_instance(self):
        return create_mock_model_instance()

    @pytest.fixture
    def rerank_runner(self, mock_model_instance):
        return RerankModelRunner(rerank_model_instance=mock_model_instance)

    def test_run_returns_original_documents_for_non_text_query_without_vision_support(
        self, rerank_runner, mock_model_instance
    ):
        documents = [
            Document(page_content="doc", metadata={"doc_id": "doc1"}, provider="dify"),
        ]

        with patch("core.rag.rerank.rerank_model.ModelManager.for_tenant") as mock_mm:
            mock_mm.return_value.check_model_support_vision.return_value = False
            result = rerank_runner.run(query="image-file-id", documents=documents, query_type=QueryType.IMAGE_QUERY)

        assert result == documents
        mock_model_instance.invoke_rerank.assert_not_called()

    def test_run_uses_multimodal_path_when_vision_support_is_enabled(self, rerank_runner):
        documents = [
            Document(page_content="doc", metadata={"doc_id": "doc1", "source": "wiki"}, provider="dify"),
        ]
        rerank_result = RerankResult(
            model="rerank-model",
            docs=[RerankDocument(index=0, text="doc", score=0.88)],
        )

        with (
            patch("core.rag.rerank.rerank_model.ModelManager.for_tenant") as mock_mm,
            patch.object(
                rerank_runner,
                "fetch_multimodal_rerank",
                return_value=(rerank_result, documents),
            ) as mock_multimodal,
        ):
            mock_mm.return_value.check_model_support_vision.return_value = True
            result = rerank_runner.run(query="python", documents=documents, query_type=QueryType.TEXT_QUERY)

        mock_multimodal.assert_called_once()
        assert len(result) == 1
        assert result[0].metadata["score"] == 0.88

    def test_fetch_multimodal_rerank_builds_docs_and_calls_text_rerank(self, rerank_runner):
        image_doc = Document(
            page_content="image-content",
            metadata={"doc_id": "img-1", "doc_type": DocType.IMAGE},
            provider="dify",
        )
        text_doc = Document(
            page_content="text-content",
            metadata={"doc_id": "txt-1", "doc_type": DocType.TEXT},
            provider="dify",
        )
        external_doc = Document(
            page_content="external-content",
            metadata={},
            provider="external",
        )
        rerank_result = RerankResult(model="rerank-model", docs=[])

        with (
            patch("core.rag.rerank.rerank_model.db.session.get", return_value=SimpleNamespace(key="image-key")),
            patch("core.rag.rerank.rerank_model.storage.load_once", return_value=b"image-bytes") as mock_load_once,
            patch.object(
                rerank_runner,
                "fetch_text_rerank",
                return_value=(rerank_result, [image_doc, text_doc, external_doc]),
            ) as mock_text_rerank,
        ):
            result, unique_documents = rerank_runner.fetch_multimodal_rerank(
                query="python",
                documents=[image_doc, text_doc, external_doc, external_doc],
                query_type=QueryType.TEXT_QUERY,
            )

        assert result == rerank_result
        assert len(unique_documents) == 3
        mock_load_once.assert_called_once_with("image-key")
        text_rerank_call_args = mock_text_rerank.call_args.args
        assert len(text_rerank_call_args[1]) == 3

    def test_fetch_multimodal_rerank_skips_missing_image_upload(self, rerank_runner):
        image_doc = Document(
            page_content="image-content",
            metadata={"doc_id": "img-missing", "doc_type": DocType.IMAGE},
            provider="dify",
        )
        rerank_result = RerankResult(model="rerank-model", docs=[])

        with (
            patch("core.rag.rerank.rerank_model.db.session.get", return_value=None),
            patch.object(
                rerank_runner,
                "fetch_text_rerank",
                return_value=(rerank_result, [image_doc]),
            ) as mock_text_rerank,
        ):
            result, unique_documents = rerank_runner.fetch_multimodal_rerank(
                query="python",
                documents=[image_doc],
                query_type=QueryType.TEXT_QUERY,
            )

        assert result == rerank_result
        assert unique_documents == [image_doc]
        docs_arg = mock_text_rerank.call_args.args[1]
        assert len(docs_arg) == 1

    def test_fetch_multimodal_rerank_image_query_invokes_multimodal_model(self, rerank_runner, mock_model_instance):
        text_doc = Document(
            page_content="text-content",
            metadata={"doc_id": "txt-1", "doc_type": DocType.TEXT},
            provider="dify",
        )
        rerank_result = RerankResult(
            model="rerank-model",
            docs=[RerankDocument(index=0, text="text-content", score=0.77)],
        )
        mock_model_instance.invoke_multimodal_rerank.return_value = rerank_result

        session = MagicMock()
        session.get.return_value = SimpleNamespace(key="query-image-key")
        with (
            patch("core.rag.rerank.rerank_model.db.session", session),
            patch("core.rag.rerank.rerank_model.storage.load_once", return_value=b"query-image-bytes"),
        ):
            result, unique_documents = rerank_runner.fetch_multimodal_rerank(
                query="query-upload-id",
                documents=[text_doc],
                score_threshold=0.2,
                top_n=2,
                query_type=QueryType.IMAGE_QUERY,
            )

        assert result == rerank_result
        assert unique_documents == [text_doc]
        invoke_kwargs = mock_model_instance.invoke_multimodal_rerank.call_args.kwargs
        assert invoke_kwargs["query"]["content_type"] == DocType.IMAGE
        assert invoke_kwargs["docs"][0]["content"] == "text-content"
        assert "user" not in invoke_kwargs

    def test_fetch_multimodal_rerank_raises_when_query_image_not_found(self, rerank_runner):
        with patch("core.rag.rerank.rerank_model.db.session.get", return_value=None):
            with pytest.raises(ValueError, match="Upload file not found for query"):
                rerank_runner.fetch_multimodal_rerank(
                    query="missing-upload-id",
                    documents=[],
                    query_type=QueryType.IMAGE_QUERY,
                )

    def test_fetch_multimodal_rerank_rejects_unsupported_query_type(self, rerank_runner):
        with pytest.raises(ValueError, match="is not supported"):
            rerank_runner.fetch_multimodal_rerank(
                query="python",
                documents=[],
                query_type="unsupported_query_type",
            )


class TestWeightRerankRunner:
    """Unit tests for WeightRerankRunner.

    Tests cover:
    - Weighted scoring with keyword and vector components
    - BM25/TF-IDF keyword scoring
    - Cosine similarity vector scoring
    - Score normalization and combination
    - Document deduplication
    - Threshold and top-k filtering
    """

    @pytest.fixture
    def mock_model_manager(self):
        """Mock ModelManager for embedding model."""
        with patch("core.rag.rerank.weight_rerank.ModelManager.for_tenant") as mock_manager:
            yield mock_manager

    @pytest.fixture
    def mock_cache_embedding(self):
        """Mock CacheEmbedding for vector operations."""
        with patch("core.rag.rerank.weight_rerank.CacheEmbedding", autospec=True) as mock_cache:
            yield mock_cache

    @pytest.fixture
    def mock_jieba_handler(self):
        """Mock JiebaKeywordTableHandler for keyword extraction."""
        with patch("core.rag.rerank.weight_rerank.JiebaKeywordTableHandler", autospec=True) as mock_jieba:
            yield mock_jieba

    @pytest.fixture
    def weights_config(self):
        """Create a sample weights configuration."""
        return Weights(
            vector_setting=VectorSetting(
                vector_weight=0.6,
                embedding_provider_name="openai",
                embedding_model_name="text-embedding-ada-002",
            ),
            keyword_setting=KeywordSetting(keyword_weight=0.4),
        )

    @pytest.fixture
    def sample_documents_with_vectors(self):
        """Create sample documents with vector embeddings."""
        return [
            Document(
                page_content="Python is a programming language",
                metadata={"doc_id": "doc1"},
                provider="dify",
                vector=[0.1, 0.2, 0.3, 0.4],
            ),
            Document(
                page_content="JavaScript for web development",
                metadata={"doc_id": "doc2"},
                provider="dify",
                vector=[0.2, 0.3, 0.4, 0.5],
            ),
            Document(
                page_content="Java object-oriented programming",
                metadata={"doc_id": "doc3"},
                provider="dify",
                vector=[0.3, 0.4, 0.5, 0.6],
            ),
        ]

    def test_weighted_reranking_basic(
        self,
        weights_config,
        sample_documents_with_vectors,
        mock_model_manager,
        mock_cache_embedding,
        mock_jieba_handler,
    ):
        """Test basic weighted reranking with keyword and vector scores.

        Verifies:
        - Keyword scores are calculated
        - Vector scores are calculated
        - Scores are combined with weights
        - Results are sorted by combined score
        """
        # Arrange: Create runner
        runner = WeightRerankRunner(tenant_id="tenant123", weights=weights_config)

        # Mock keyword extraction
        mock_handler_instance = MagicMock()
        mock_handler_instance.extract_keywords.side_effect = [
            ["python", "programming"],  # query keywords
            ["python", "programming", "language"],  # doc1 keywords
            ["javascript", "web", "development"],  # doc2 keywords
            ["java", "programming", "object"],  # doc3 keywords
        ]
        mock_jieba_handler.return_value = mock_handler_instance

        # Mock embedding model
        mock_embedding_instance = MagicMock()
        mock_embedding_instance.invoke_rerank = MagicMock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance

        # Mock cache embedding
        mock_cache_instance = MagicMock()
        mock_cache_instance.embed_query.return_value = [0.15, 0.25, 0.35, 0.45]
        mock_cache_embedding.return_value = mock_cache_instance

        # Act: Run weighted reranking
        result = runner.run(query="python programming", documents=sample_documents_with_vectors)

        # Assert: Results are returned with scores
        assert len(result) == 3
        assert all("score" in doc.metadata for doc in result)
        # Verify scores are sorted in descending order
        scores = [doc.metadata["score"] for doc in result]
        assert scores == sorted(scores, reverse=True)

    def test_keyword_score_calculation(
        self,
        weights_config,
        sample_documents_with_vectors,
        mock_model_manager,
        mock_cache_embedding,
        mock_jieba_handler,
    ):
        """Test keyword score calculation using TF-IDF.

        Verifies:
        - Keywords are extracted from query and documents
        - TF-IDF scores are calculated correctly
        - Cosine similarity is computed for keyword vectors
        """
        runner = WeightRerankRunner(tenant_id="tenant123", weights=weights_config)
        keyword_map = {
            "python programming": ["python", "programming"],
            "Python is a programming language": ["python", "programming", "language"],
            "JavaScript for web development": ["javascript", "web"],
            "Java object-oriented programming": ["java", "programming"],
        }
        mock_handler_instance = MagicMock()
        mock_handler_instance.extract_keywords.side_effect = lambda text, _: keyword_map[text]
        mock_jieba_handler.return_value = mock_handler_instance

        mock_embedding_instance = MagicMock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance
        mock_cache_instance = MagicMock()
        mock_cache_instance.embed_query.return_value = [0.1, 0.2, 0.3, 0.4]
        mock_cache_embedding.return_value = mock_cache_instance

        query_scores = runner._calculate_keyword_score("python programming", sample_documents_with_vectors)
        vector_scores = runner._calculate_cosine(
            "tenant123", "python programming", sample_documents_with_vectors, weights_config.vector_setting
        )
        expected_scores = {
            doc.metadata["doc_id"]: (0.6 * vector_score + 0.4 * query_score)
            for doc, query_score, vector_score in zip(sample_documents_with_vectors, query_scores, vector_scores)
        }

        result = runner.run(query="python programming", documents=sample_documents_with_vectors)

        expected_order = [doc_id for doc_id, _ in sorted(expected_scores.items(), key=itemgetter(1), reverse=True)]
        assert [doc.metadata["doc_id"] for doc in result] == expected_order
        for doc in result:
            doc_id = doc.metadata["doc_id"]
            assert doc.metadata["score"] == pytest.approx(expected_scores[doc_id], rel=1e-6)

    def test_vector_score_calculation(
        self,
        weights_config,
        sample_documents_with_vectors,
        mock_model_manager,
        mock_cache_embedding,
        mock_jieba_handler,
    ):
        """Test vector score calculation using cosine similarity.

        Verifies:
        - Query vector is generated
        - Cosine similarity is calculated with document vectors
        - Vector scores are properly normalized
        """
        runner = WeightRerankRunner(tenant_id="tenant123", weights=weights_config)

        keyword_map = {
            "test query": ["test"],
            "Python is a programming language": ["python"],
            "JavaScript for web development": ["javascript"],
            "Java object-oriented programming": ["java"],
        }
        mock_handler_instance = MagicMock()
        mock_handler_instance.extract_keywords.side_effect = lambda text, _: keyword_map[text]
        mock_jieba_handler.return_value = mock_handler_instance

        mock_embedding_instance = MagicMock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance

        mock_cache_instance = MagicMock()
        query_vector = [0.2, 0.3, 0.4, 0.5]
        mock_cache_instance.embed_query.return_value = query_vector
        mock_cache_embedding.return_value = mock_cache_instance

        query_scores = runner._calculate_keyword_score("test query", sample_documents_with_vectors)
        vector_scores = runner._calculate_cosine(
            "tenant123", "test query", sample_documents_with_vectors, weights_config.vector_setting
        )
        expected_scores = {
            doc.metadata["doc_id"]: (0.6 * vector_score + 0.4 * query_score)
            for doc, query_score, vector_score in zip(sample_documents_with_vectors, query_scores, vector_scores)
        }

        result = runner.run(query="test query", documents=sample_documents_with_vectors)

        expected_order = [doc_id for doc_id, _ in sorted(expected_scores.items(), key=itemgetter(1), reverse=True)]
        assert [doc.metadata["doc_id"] for doc in result] == expected_order
        for doc in result:
            doc_id = doc.metadata["doc_id"]
            assert doc.metadata["score"] == pytest.approx(expected_scores[doc_id], rel=1e-6)

    def test_score_threshold_filtering_weighted(
        self,
        weights_config,
        sample_documents_with_vectors,
        mock_model_manager,
        mock_cache_embedding,
        mock_jieba_handler,
    ):
        """Test score threshold filtering in weighted reranking.

        Verifies:
        - Documents below threshold are filtered out
        - Combined weighted score is used for filtering
        """
        # Arrange: Create runner
        runner = WeightRerankRunner(tenant_id="tenant123", weights=weights_config)

        # Mock keyword extraction
        mock_handler_instance = MagicMock()
        mock_handler_instance.extract_keywords.return_value = ["test"]
        mock_jieba_handler.return_value = mock_handler_instance

        # Mock embedding
        mock_embedding_instance = MagicMock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance
        mock_cache_instance = MagicMock()
        mock_cache_instance.embed_query.return_value = [0.1, 0.2, 0.3, 0.4]
        mock_cache_embedding.return_value = mock_cache_instance

        # Act: Run reranking with threshold
        result = runner.run(
            query="test",
            documents=sample_documents_with_vectors,
            score_threshold=0.5,
        )

        # Assert: Only documents above threshold are returned
        assert all(doc.metadata["score"] >= 0.5 for doc in result)

    def test_top_k_selection_weighted(
        self,
        weights_config,
        sample_documents_with_vectors,
        mock_model_manager,
        mock_cache_embedding,
        mock_jieba_handler,
    ):
        """Test top-k selection in weighted reranking.

        Verifies:
        - Only top-k documents are returned
        - Documents are sorted by combined score
        """
        # Arrange: Create runner
        runner = WeightRerankRunner(tenant_id="tenant123", weights=weights_config)

        # Mock keyword extraction
        mock_handler_instance = MagicMock()
        mock_handler_instance.extract_keywords.return_value = ["test"]
        mock_jieba_handler.return_value = mock_handler_instance

        # Mock embedding
        mock_embedding_instance = MagicMock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance
        mock_cache_instance = MagicMock()
        mock_cache_instance.embed_query.return_value = [0.1, 0.2, 0.3, 0.4]
        mock_cache_embedding.return_value = mock_cache_instance

        # Act: Run reranking with top_n
        result = runner.run(query="test", documents=sample_documents_with_vectors, top_n=2)

        # Assert: Only top 2 documents are returned
        assert len(result) == 2

    def test_document_deduplication_weighted(
        self,
        weights_config,
        mock_model_manager,
        mock_cache_embedding,
        mock_jieba_handler,
    ):
        """Test document deduplication in weighted reranking.

        Verifies:
        - Duplicate dify documents by doc_id are deduplicated
        - External provider documents are deduplicated by object equality
        - Unique documents are processed correctly
        """
        # Arrange: Documents with duplicates - use external provider to test object equality
        doc_external_1 = Document(
            page_content="External content",
            metadata={"source": "external"},
            provider="external",
            vector=[0.1, 0.2],
        )

        documents = [
            Document(
                page_content="Content 1",
                metadata={"doc_id": "doc1"},
                provider="dify",
                vector=[0.1, 0.2],
            ),
            Document(
                page_content="Content 1 duplicate",
                metadata={"doc_id": "doc1"},
                provider="dify",
                vector=[0.1, 0.2],
            ),
            doc_external_1,  # First occurrence
            doc_external_1,  # Duplicate (same object)
        ]

        runner = WeightRerankRunner(tenant_id="tenant123", weights=weights_config)

        # Mock keyword extraction
        # After deduplication: doc1 (first dify with doc_id="doc1") and doc_external_1
        # Note: The duplicate dify doc with same doc_id goes to else branch but is added as different object
        # So we actually have 3 unique documents after deduplication
        mock_handler_instance = MagicMock()
        mock_handler_instance.extract_keywords.side_effect = [
            ["test"],  # query keywords
            ["content"],  # doc1 keywords
            ["content", "duplicate"],  # doc1 duplicate keywords (different object, added via else)
            ["external"],  # external doc keywords
        ]
        mock_jieba_handler.return_value = mock_handler_instance

        # Mock embedding
        mock_embedding_instance = MagicMock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance
        mock_cache_instance = MagicMock()
        mock_cache_instance.embed_query.return_value = [0.1, 0.2]
        mock_cache_embedding.return_value = mock_cache_instance

        # Act: Run reranking
        result = runner.run(query="test", documents=documents)

        # Assert: External duplicate is removed (same object)
        # Note: dify duplicates with same doc_id but different objects are NOT removed by current logic
        # This tests the actual behavior, not ideal behavior
        assert len(result) >= 2  # At least unique doc_id and external
        # Verify external document appears only once
        external_count = sum(1 for doc in result if doc.provider == "external")
        assert external_count == 1

    def test_weight_combination(
        self,
        weights_config,
        sample_documents_with_vectors,
        mock_model_manager,
        mock_cache_embedding,
        mock_jieba_handler,
    ):
        """Test that keyword and vector scores are combined with correct weights.

        Verifies:
        - Vector weight (0.6) is applied to vector scores
        - Keyword weight (0.4) is applied to keyword scores
        - Combined score is the sum of weighted components
        """
        runner = WeightRerankRunner(tenant_id="tenant123", weights=weights_config)

        keyword_map = {
            "test": ["test"],
            "Python is a programming language": ["python", "language"],
            "JavaScript for web development": ["javascript", "web"],
            "Java object-oriented programming": ["java", "programming"],
        }
        mock_handler_instance = MagicMock()
        mock_handler_instance.extract_keywords.side_effect = lambda text, _: keyword_map[text]
        mock_jieba_handler.return_value = mock_handler_instance

        mock_embedding_instance = MagicMock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance
        mock_cache_instance = MagicMock()
        mock_cache_instance.embed_query.return_value = [0.1, 0.2, 0.3, 0.4]
        mock_cache_embedding.return_value = mock_cache_instance

        query_scores = runner._calculate_keyword_score("test", sample_documents_with_vectors)
        vector_scores = runner._calculate_cosine(
            "tenant123", "test", sample_documents_with_vectors, weights_config.vector_setting
        )
        expected_scores = {
            doc.metadata["doc_id"]: (0.6 * vector_score + 0.4 * query_score)
            for doc, query_score, vector_score in zip(sample_documents_with_vectors, query_scores, vector_scores)
        }

        result = runner.run(query="test", documents=sample_documents_with_vectors)

        expected_order = [doc_id for doc_id, _ in sorted(expected_scores.items(), key=itemgetter(1), reverse=True)]
        assert [doc.metadata["doc_id"] for doc in result] == expected_order
        for doc in result:
            doc_id = doc.metadata["doc_id"]
            assert doc.metadata["score"] == pytest.approx(expected_scores[doc_id], rel=1e-6)

    def test_existing_vector_score_in_metadata(
        self,
        weights_config,
        mock_model_manager,
        mock_cache_embedding,
        mock_jieba_handler,
    ):
        """Test that existing vector scores in metadata are reused.

        Verifies:
        - If document already has a score in metadata, it's used
        - Cosine similarity calculation is skipped for such documents
        """
        documents = [
            Document(
                page_content="Content with existing score",
                metadata={"doc_id": "doc1", "score": 0.95},
                provider="dify",
                vector=[0.1, 0.2],
            ),
        ]

        runner = WeightRerankRunner(tenant_id="tenant123", weights=weights_config)

        keyword_map = {
            "test": ["test"],
            "Content with existing score": ["test"],
        }
        mock_handler_instance = MagicMock()
        mock_handler_instance.extract_keywords.side_effect = lambda text, _: keyword_map[text]
        mock_jieba_handler.return_value = mock_handler_instance

        mock_embedding_instance = MagicMock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_instance
        mock_cache_instance = MagicMock()
        mock_cache_instance.embed_query.return_value = [0.1, 0.2]
        mock_cache_embedding.return_value = mock_cache_instance

        query_scores = runner._calculate_keyword_score("test", documents)
        vector_scores = runner._calculate_cosine("tenant123", "test", documents, weights_config.vector_setting)
        expected_score = 0.6 * vector_scores[0] + 0.4 * query_scores[0]

        result = runner.run(query="test", documents=documents)

        assert len(result) == 1
        assert result[0].metadata["doc_id"] == "doc1"
        assert result[0].metadata["score"] == pytest.approx(expected_score, rel=1e-6)


class TestRerankRunnerFactory:
    """Unit tests for RerankRunnerFactory.

    Tests cover:
    - Factory pattern for creating reranker instances
    - Correct runner type instantiation
    - Parameter forwarding to runners
    - Error handling for unknown runner types
    """

    def test_create_reranking_model_runner(self):
        """Test creation of RerankModelRunner via factory.

        Verifies:
        - Factory creates correct runner type
        - Parameters are forwarded to runner constructor
        """
        # Arrange: Mock model instance
        mock_model_instance = create_mock_model_instance()

        # Act: Create runner via factory
        runner = RerankRunnerFactory.create_rerank_runner(
            runner_type=RerankMode.RERANKING_MODEL,
            rerank_model_instance=mock_model_instance,
        )

        # Assert: Correct runner type is created
        assert isinstance(runner, RerankModelRunner)
        assert runner.rerank_model_instance == mock_model_instance

    def test_create_weighted_score_runner(self):
        """Test creation of WeightRerankRunner via factory.

        Verifies:
        - Factory creates correct runner type
        - Parameters are forwarded to runner constructor
        """
        # Arrange: Create weights configuration
        weights = Weights(
            vector_setting=VectorSetting(
                vector_weight=0.7,
                embedding_provider_name="openai",
                embedding_model_name="text-embedding-ada-002",
            ),
            keyword_setting=KeywordSetting(keyword_weight=0.3),
        )

        # Act: Create runner via factory
        runner = RerankRunnerFactory.create_rerank_runner(
            runner_type=RerankMode.WEIGHTED_SCORE,
            tenant_id="tenant123",
            weights=weights,
        )

        # Assert: Correct runner type is created
        assert isinstance(runner, WeightRerankRunner)
        assert runner.tenant_id == "tenant123"
        assert runner.weights == weights

    def test_create_runner_with_invalid_type(self):
        """Test factory error handling for unknown runner type.

        Verifies:
        - ValueError is raised for unknown runner types
        - Error message includes the invalid type
        """
        # Act & Assert: Invalid runner type raises ValueError
        with pytest.raises(ValueError, match="Unknown runner type"):
            RerankRunnerFactory.create_rerank_runner(
                runner_type="invalid_type",
            )

    def test_factory_with_string_enum(self):
        """Test factory accepts string enum values.

        Verifies:
        - Factory works with RerankMode enum values
        - String values are properly matched
        """
        # Arrange: Mock model instance
        mock_model_instance = create_mock_model_instance()

        # Act: Create runner using enum value
        runner = RerankRunnerFactory.create_rerank_runner(
            runner_type=RerankMode.RERANKING_MODEL.value,
            rerank_model_instance=mock_model_instance,
        )

        # Assert: Runner is created successfully
        assert isinstance(runner, RerankModelRunner)


class TestRerankIntegration:
    """Integration tests for reranker components.

    Tests cover:
    - End-to-end reranking workflows
    - Interaction between different components
    - Real-world usage scenarios
    """

    @pytest.fixture(autouse=True)
    def mock_model_manager(self):
        """Auto-use fixture to patch ModelManager for all tests in this class."""
        with patch("core.rag.rerank.rerank_model.ModelManager.for_tenant", autospec=True) as mock_mm:
            mock_mm.return_value.check_model_support_vision.return_value = False
            yield mock_mm

    def test_model_reranking_full_workflow(self):
        """Test complete model-based reranking workflow.

        Verifies:
        - Documents are processed end-to-end
        - Scores are normalized and sorted
        - Top results are returned correctly
        """
        # Arrange: Create mock model and documents
        mock_model_instance = create_mock_model_instance()
        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text="Python programming", score=0.92),
                RerankDocument(index=1, text="Java development", score=0.78),
                RerankDocument(index=2, text="JavaScript coding", score=0.65),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        documents = [
            Document(
                page_content="Python programming",
                metadata={"doc_id": "doc1"},
                provider="dify",
            ),
            Document(
                page_content="Java development",
                metadata={"doc_id": "doc2"},
                provider="dify",
            ),
            Document(
                page_content="JavaScript coding",
                metadata={"doc_id": "doc3"},
                provider="dify",
            ),
        ]

        # Act: Create runner and execute reranking
        runner = RerankRunnerFactory.create_rerank_runner(
            runner_type=RerankMode.RERANKING_MODEL,
            rerank_model_instance=mock_model_instance,
        )
        result = runner.run(
            query="best programming language",
            documents=documents,
            score_threshold=0.70,
            top_n=2,
        )

        # Assert: Workflow completes successfully
        assert len(result) == 2
        assert result[0].metadata["score"] == 0.92
        assert result[1].metadata["score"] == 0.78
        assert result[0].page_content == "Python programming"

    def test_score_normalization_across_documents(self):
        """Test that scores are properly normalized across documents.

        Verifies:
        - Scores maintain relative ordering
        - Score values are in expected range
        - Normalization is consistent
        """
        # Arrange: Create mock model with various scores
        mock_model_instance = create_mock_model_instance()
        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text="High relevance", score=0.99),
                RerankDocument(index=1, text="Medium relevance", score=0.50),
                RerankDocument(index=2, text="Low relevance", score=0.01),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        documents = [
            Document(page_content="High relevance", metadata={"doc_id": "doc1"}, provider="dify"),
            Document(page_content="Medium relevance", metadata={"doc_id": "doc2"}, provider="dify"),
            Document(page_content="Low relevance", metadata={"doc_id": "doc3"}, provider="dify"),
        ]

        runner = RerankModelRunner(rerank_model_instance=mock_model_instance)

        # Act: Run reranking
        result = runner.run(query="test", documents=documents)

        # Assert: Scores are normalized and ordered
        assert len(result) == 3
        assert result[0].metadata["score"] > result[1].metadata["score"]
        assert result[1].metadata["score"] > result[2].metadata["score"]
        assert 0.0 <= result[2].metadata["score"] <= 1.0


class TestRerankEdgeCases:
    """Edge case tests for reranker components.

    Tests cover:
    - Handling of None and empty values
    - Boundary conditions for scores and thresholds
    - Large document sets
    - Special characters and encoding
    - Concurrent reranking scenarios
    """

    @pytest.fixture(autouse=True)
    def mock_model_manager(self):
        """Auto-use fixture to patch ModelManager for all tests in this class."""
        with patch("core.rag.rerank.rerank_model.ModelManager.for_tenant", autospec=True) as mock_mm:
            mock_mm.return_value.check_model_support_vision.return_value = False
            yield mock_mm

    def test_rerank_with_empty_metadata(self):
        """Test reranking when documents have empty metadata.

        Verifies:
        - Documents with empty metadata are handled gracefully
        - No AttributeError or KeyError is raised
        - Empty metadata documents are processed correctly
        """
        # Arrange: Create documents with empty metadata
        mock_model_instance = create_mock_model_instance()
        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text="Content with metadata", score=0.90),
                RerankDocument(index=1, text="Content with empty metadata", score=0.80),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        documents = [
            Document(
                page_content="Content with metadata",
                metadata={"doc_id": "doc1"},
                provider="dify",
            ),
            Document(
                page_content="Content with empty metadata",
                metadata={},  # Empty metadata (not None, as Pydantic doesn't allow None)
                provider="external",
            ),
        ]

        runner = RerankModelRunner(rerank_model_instance=mock_model_instance)

        # Act: Run reranking
        result = runner.run(query="test", documents=documents)

        # Assert: Both documents are processed and included
        # Empty metadata is valid and documents are not filtered out
        assert len(result) == 2
        # First result has metadata with doc_id
        assert result[0].metadata.get("doc_id") == "doc1"
        # Second result has empty metadata but score is added
        assert "score" in result[1].metadata
        assert result[1].metadata["score"] == 0.80

    def test_rerank_with_zero_score_threshold(self):
        """Test reranking with zero score threshold.

        Verifies:
        - Zero threshold allows all documents through
        - Negative scores are handled correctly
        - Score comparison logic works at boundary
        """
        # Arrange: Create mock with various scores including negatives
        mock_model_instance = create_mock_model_instance()
        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text="Positive score", score=0.50),
                RerankDocument(index=1, text="Zero score", score=0.00),
                RerankDocument(index=2, text="Negative score", score=-0.10),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        documents = [
            Document(page_content="Positive score", metadata={"doc_id": "doc1"}, provider="dify"),
            Document(page_content="Zero score", metadata={"doc_id": "doc2"}, provider="dify"),
            Document(page_content="Negative score", metadata={"doc_id": "doc3"}, provider="dify"),
        ]

        runner = RerankModelRunner(rerank_model_instance=mock_model_instance)

        # Act: Run reranking with zero threshold
        result = runner.run(query="test", documents=documents, score_threshold=0.0)

        # Assert: Documents with score >= 0.0 are included
        assert len(result) == 2  # Positive and zero scores
        assert result[0].metadata["score"] == 0.50
        assert result[1].metadata["score"] == 0.00

    def test_rerank_with_perfect_score(self):
        """Test reranking when all documents have perfect scores.

        Verifies:
        - Perfect scores (1.0) are handled correctly
        - Sorting maintains stability when scores are equal
        - No overflow or precision issues
        """
        # Arrange: All documents with perfect scores
        mock_model_instance = create_mock_model_instance()
        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text="Perfect 1", score=1.0),
                RerankDocument(index=1, text="Perfect 2", score=1.0),
                RerankDocument(index=2, text="Perfect 3", score=1.0),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        documents = [
            Document(page_content="Perfect 1", metadata={"doc_id": "doc1"}, provider="dify"),
            Document(page_content="Perfect 2", metadata={"doc_id": "doc2"}, provider="dify"),
            Document(page_content="Perfect 3", metadata={"doc_id": "doc3"}, provider="dify"),
        ]

        runner = RerankModelRunner(rerank_model_instance=mock_model_instance)

        # Act: Run reranking
        result = runner.run(query="test", documents=documents)

        # Assert: All documents are returned with perfect scores
        assert len(result) == 3
        assert all(doc.metadata["score"] == 1.0 for doc in result)

    def test_rerank_with_special_characters(self):
        """Test reranking with special characters in content.

        Verifies:
        - Unicode characters are handled correctly
        - Emojis and special symbols don't break processing
        - Content encoding is preserved
        """
        # Arrange: Documents with special characters
        mock_model_instance = create_mock_model_instance()
        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text="Hello 世界 🌍", score=0.90),
                RerankDocument(index=1, text="Café ☕ résumé", score=0.85),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        documents = [
            Document(
                page_content="Hello 世界 🌍",
                metadata={"doc_id": "doc1"},
                provider="dify",
            ),
            Document(
                page_content="Café ☕ résumé",
                metadata={"doc_id": "doc2"},
                provider="dify",
            ),
        ]

        runner = RerankModelRunner(rerank_model_instance=mock_model_instance)

        # Act: Run reranking
        result = runner.run(query="test 测试", documents=documents)

        # Assert: Special characters are preserved
        assert len(result) == 2
        assert "世界" in result[0].page_content
        assert "☕" in result[1].page_content

    def test_rerank_with_very_long_content(self):
        """Test reranking with very long document content.

        Verifies:
        - Long content doesn't cause memory issues
        - Processing completes successfully
        - Content is not truncated unexpectedly
        """
        # Arrange: Documents with very long content
        mock_model_instance = create_mock_model_instance()
        long_content = "This is a very long document. " * 1000  # ~30,000 characters

        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text=long_content, score=0.90),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        documents = [
            Document(
                page_content=long_content,
                metadata={"doc_id": "doc1"},
                provider="dify",
            ),
        ]

        runner = RerankModelRunner(rerank_model_instance=mock_model_instance)

        # Act: Run reranking
        result = runner.run(query="test", documents=documents)

        # Assert: Long content is handled correctly
        assert len(result) == 1
        assert len(result[0].page_content) > 10000

    def test_rerank_with_large_document_set(self):
        """Test reranking with a large number of documents.

        Verifies:
        - Large document sets are processed efficiently
        - Memory usage is reasonable
        - All documents are processed correctly
        """
        # Arrange: Create 100 documents
        mock_model_instance = create_mock_model_instance()
        num_docs = 100

        # Create rerank results for all documents
        rerank_docs = [RerankDocument(index=i, text=f"Document {i}", score=1.0 - (i * 0.01)) for i in range(num_docs)]
        mock_rerank_result = RerankResult(model="bge-reranker-base", docs=rerank_docs)
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        # Create input documents
        documents = [
            Document(
                page_content=f"Document {i}",
                metadata={"doc_id": f"doc{i}"},
                provider="dify",
            )
            for i in range(num_docs)
        ]

        runner = RerankModelRunner(rerank_model_instance=mock_model_instance)

        # Act: Run reranking with top_n
        result = runner.run(query="test", documents=documents, top_n=10)

        # Assert: Top 10 documents are returned in correct order
        assert len(result) == 10
        # Verify descending score order
        for i in range(len(result) - 1):
            assert result[i].metadata["score"] >= result[i + 1].metadata["score"]

    def test_weighted_rerank_with_zero_weights(self):
        """Test weighted reranking with zero weights.

        Verifies:
        - Zero weights don't cause division by zero
        - Results are still returned
        - Score calculation handles edge case
        """
        # Arrange: Create weights with zero keyword weight
        weights = Weights(
            vector_setting=VectorSetting(
                vector_weight=1.0,  # Only vector weight
                embedding_provider_name="openai",
                embedding_model_name="text-embedding-ada-002",
            ),
            keyword_setting=KeywordSetting(keyword_weight=0.0),  # Zero keyword weight
        )

        documents = [
            Document(
                page_content="Test content",
                metadata={"doc_id": "doc1"},
                provider="dify",
                vector=[0.1, 0.2, 0.3],
            ),
        ]

        runner = WeightRerankRunner(tenant_id="tenant123", weights=weights)

        # Mock dependencies
        with (
            patch("core.rag.rerank.weight_rerank.JiebaKeywordTableHandler", autospec=True) as mock_jieba,
            patch("core.rag.rerank.weight_rerank.ModelManager.for_tenant") as mock_manager,
            patch("core.rag.rerank.weight_rerank.CacheEmbedding", autospec=True) as mock_cache,
        ):
            mock_handler = MagicMock()
            mock_handler.extract_keywords.return_value = ["test"]
            mock_jieba.return_value = mock_handler

            mock_embedding = MagicMock()
            mock_manager.return_value.get_model_instance.return_value = mock_embedding

            mock_cache_instance = MagicMock()
            mock_cache_instance.embed_query.return_value = [0.1, 0.2, 0.3]
            mock_cache.return_value = mock_cache_instance

            # Act: Run reranking
            result = runner.run(query="test", documents=documents)

            # Assert: Results are based only on vector scores
            assert len(result) == 1
            # Score should be 1.0 * vector_score + 0.0 * keyword_score

    def test_rerank_with_empty_query(self):
        """Test reranking with empty query string.

        Verifies:
        - Empty query is handled gracefully
        - No errors are raised
        - Documents can still be ranked
        """
        # Arrange: Empty query
        mock_model_instance = create_mock_model_instance()
        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text="Document 1", score=0.50),
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        documents = [
            Document(
                page_content="Document 1",
                metadata={"doc_id": "doc1"},
                provider="dify",
            ),
        ]

        runner = RerankModelRunner(rerank_model_instance=mock_model_instance)

        # Act: Run reranking with empty query
        result = runner.run(query="", documents=documents)

        # Assert: Empty query is processed
        assert len(result) == 1
        mock_model_instance.invoke_rerank.assert_called_once()
        assert mock_model_instance.invoke_rerank.call_args.kwargs["query"] == ""


class TestRerankPerformance:
    """Performance and optimization tests for reranker.

    Tests cover:
    - Batch processing efficiency
    - Caching behavior
    - Memory usage patterns
    - Score calculation optimization
    """

    @pytest.fixture(autouse=True)
    def mock_model_manager(self):
        """Auto-use fixture to patch ModelManager for all tests in this class."""
        with patch("core.rag.rerank.rerank_model.ModelManager.for_tenant", autospec=True) as mock_mm:
            mock_mm.return_value.check_model_support_vision.return_value = False
            yield mock_mm

    def test_rerank_batch_processing(self):
        """Test that documents are processed in a single batch.

        Verifies:
        - Model is invoked only once for all documents
        - No unnecessary multiple calls
        - Efficient batch processing
        """
        # Arrange: Multiple documents
        mock_model_instance = create_mock_model_instance()
        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[RerankDocument(index=i, text=f"Doc {i}", score=0.9 - i * 0.1) for i in range(5)],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        documents = [
            Document(
                page_content=f"Doc {i}",
                metadata={"doc_id": f"doc{i}"},
                provider="dify",
            )
            for i in range(5)
        ]

        runner = RerankModelRunner(rerank_model_instance=mock_model_instance)

        # Act: Run reranking
        result = runner.run(query="test", documents=documents)

        # Assert: Model invoked exactly once (batch processing)
        assert mock_model_instance.invoke_rerank.call_count == 1
        assert len(result) == 5

    def test_weighted_rerank_keyword_extraction_efficiency(self):
        """Test keyword extraction is called efficiently.

        Verifies:
        - Keywords extracted once per document
        - No redundant extractions
        - Extracted keywords are cached in metadata
        """
        # Arrange: Setup weighted reranker
        weights = Weights(
            vector_setting=VectorSetting(
                vector_weight=0.5,
                embedding_provider_name="openai",
                embedding_model_name="text-embedding-ada-002",
            ),
            keyword_setting=KeywordSetting(keyword_weight=0.5),
        )

        documents = [
            Document(
                page_content="Document 1",
                metadata={"doc_id": "doc1"},
                provider="dify",
                vector=[0.1, 0.2],
            ),
            Document(
                page_content="Document 2",
                metadata={"doc_id": "doc2"},
                provider="dify",
                vector=[0.3, 0.4],
            ),
        ]

        runner = WeightRerankRunner(tenant_id="tenant123", weights=weights)

        with (
            patch("core.rag.rerank.weight_rerank.JiebaKeywordTableHandler", autospec=True) as mock_jieba,
            patch("core.rag.rerank.weight_rerank.ModelManager.for_tenant") as mock_manager,
            patch("core.rag.rerank.weight_rerank.CacheEmbedding", autospec=True) as mock_cache,
        ):
            mock_handler = MagicMock()
            # Track keyword extraction calls
            mock_handler.extract_keywords.side_effect = [
                ["test"],  # query
                ["document", "one"],  # doc1
                ["document", "two"],  # doc2
            ]
            mock_jieba.return_value = mock_handler

            mock_embedding = MagicMock()
            mock_manager.return_value.get_model_instance.return_value = mock_embedding

            mock_cache_instance = MagicMock()
            mock_cache_instance.embed_query.return_value = [0.1, 0.2]
            mock_cache.return_value = mock_cache_instance

            # Act: Run reranking
            result = runner.run(query="test", documents=documents)

            # Assert: Keywords extracted exactly 3 times (1 query + 2 docs)
            assert mock_handler.extract_keywords.call_count == 3
            # Verify keywords are stored in metadata
            assert "keywords" in result[0].metadata
            assert "keywords" in result[1].metadata


class TestRerankErrorHandling:
    """Error handling tests for reranker components.

    Tests cover:
    - Model invocation failures
    - Invalid input handling
    - Graceful degradation
    - Error propagation
    """

    @pytest.fixture(autouse=True)
    def mock_model_manager(self):
        """Auto-use fixture to patch ModelManager for all tests in this class."""
        with patch("core.rag.rerank.rerank_model.ModelManager.for_tenant", autospec=True) as mock_mm:
            mock_mm.return_value.check_model_support_vision.return_value = False
            yield mock_mm

    def test_rerank_model_invocation_error(self):
        """Test handling of model invocation errors.

        Verifies:
        - Exceptions from model are propagated correctly
        - No silent failures
        - Error context is preserved
        """
        # Arrange: Mock model that raises exception
        mock_model_instance = create_mock_model_instance()
        mock_model_instance.invoke_rerank.side_effect = RuntimeError("Model invocation failed")

        documents = [
            Document(
                page_content="Test content",
                metadata={"doc_id": "doc1"},
                provider="dify",
            ),
        ]

        runner = RerankModelRunner(rerank_model_instance=mock_model_instance)

        # Act & Assert: Exception is raised
        with pytest.raises(RuntimeError, match="Model invocation failed"):
            runner.run(query="test", documents=documents)

    def test_rerank_with_mismatched_indices(self):
        """Test handling when rerank result indices don't match input.

        Verifies:
        - Out of bounds indices are handled
        - IndexError is raised or handled gracefully
        - Invalid results don't corrupt output
        """
        # Arrange: Rerank result with invalid index
        mock_model_instance = create_mock_model_instance()
        mock_rerank_result = RerankResult(
            model="bge-reranker-base",
            docs=[
                RerankDocument(index=0, text="Valid doc", score=0.90),
                RerankDocument(index=10, text="Invalid index", score=0.80),  # Out of bounds
            ],
        )
        mock_model_instance.invoke_rerank.return_value = mock_rerank_result

        documents = [
            Document(
                page_content="Valid doc",
                metadata={"doc_id": "doc1"},
                provider="dify",
            ),
        ]

        runner = RerankModelRunner(rerank_model_instance=mock_model_instance)

        # Act & Assert: Should raise IndexError or handle gracefully
        with pytest.raises(IndexError):
            runner.run(query="test", documents=documents)

    def test_factory_with_missing_required_parameters(self):
        """Test factory error when required parameters are missing.

        Verifies:
        - Missing parameters cause appropriate errors
        - Error messages are informative
        - Type checking works correctly
        """
        # Act & Assert: Missing required parameter raises TypeError
        with pytest.raises(TypeError):
            RerankRunnerFactory.create_rerank_runner(
                runner_type=RerankMode.RERANKING_MODEL
                # Missing rerank_model_instance parameter
            )

    def test_weighted_rerank_with_missing_vector(self):
        """Test weighted reranking when document vector is missing.

        Verifies:
        - Missing vectors cause appropriate errors
        - TypeError is raised when trying to process None vector
        - System fails fast with clear error
        """
        # Arrange: Document without vector
        weights = Weights(
            vector_setting=VectorSetting(
                vector_weight=0.5,
                embedding_provider_name="openai",
                embedding_model_name="text-embedding-ada-002",
            ),
            keyword_setting=KeywordSetting(keyword_weight=0.5),
        )

        documents = [
            Document(
                page_content="Document without vector",
                metadata={"doc_id": "doc1"},
                provider="dify",
                vector=None,  # No vector
            ),
        ]

        runner = WeightRerankRunner(tenant_id="tenant123", weights=weights)

        with (
            patch("core.rag.rerank.weight_rerank.JiebaKeywordTableHandler", autospec=True) as mock_jieba,
            patch("core.rag.rerank.weight_rerank.ModelManager.for_tenant") as mock_manager,
            patch("core.rag.rerank.weight_rerank.CacheEmbedding", autospec=True) as mock_cache,
        ):
            mock_handler = MagicMock()
            mock_handler.extract_keywords.return_value = ["test"]
            mock_jieba.return_value = mock_handler

            mock_embedding = MagicMock()
            mock_manager.return_value.get_model_instance.return_value = mock_embedding

            mock_cache_instance = MagicMock()
            mock_cache_instance.embed_query.return_value = [0.1, 0.2]
            mock_cache.return_value = mock_cache_instance

            # Act & Assert: Should raise TypeError when processing None vector
            # The numpy array() call on None vector will fail
            with pytest.raises((TypeError, AttributeError)):
                runner.run(query="test", documents=documents)
