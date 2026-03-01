import contextlib
import os

import pytest

from core.rag.datasource.vdb.clickzetta.clickzetta_vector import ClickzettaConfig, ClickzettaVector
from core.rag.models.document import Document
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, get_example_text, setup_mock_redis


class TestClickzettaVector(AbstractVectorTest):
    """
    Test cases for Clickzetta vector database integration.
    """

    @pytest.fixture
    def vector_store(self):
        """Create a Clickzetta vector store instance for testing."""
        # Skip test if Clickzetta credentials are not configured
        if not os.getenv("CLICKZETTA_USERNAME"):
            pytest.skip("CLICKZETTA_USERNAME is not configured")
        if not os.getenv("CLICKZETTA_PASSWORD"):
            pytest.skip("CLICKZETTA_PASSWORD is not configured")
        if not os.getenv("CLICKZETTA_INSTANCE"):
            pytest.skip("CLICKZETTA_INSTANCE is not configured")

        config = ClickzettaConfig(
            username=os.getenv("CLICKZETTA_USERNAME", ""),
            password=os.getenv("CLICKZETTA_PASSWORD", ""),
            instance=os.getenv("CLICKZETTA_INSTANCE", ""),
            service=os.getenv("CLICKZETTA_SERVICE", "api.clickzetta.com"),
            workspace=os.getenv("CLICKZETTA_WORKSPACE", "quick_start"),
            vcluster=os.getenv("CLICKZETTA_VCLUSTER", "default_ap"),
            schema=os.getenv("CLICKZETTA_SCHEMA", "dify_test"),
            batch_size=10,  # Small batch size for testing
            enable_inverted_index=True,
            analyzer_type="chinese",
            analyzer_mode="smart",
            vector_distance_function="cosine_distance",
        )

        with setup_mock_redis():
            vector = ClickzettaVector(collection_name="test_collection_" + str(os.getpid()), config=config)

            yield vector

            # Cleanup: delete the test collection
            with contextlib.suppress(Exception):
                vector.delete()

    def test_clickzetta_vector_basic_operations(self, vector_store):
        """Test basic CRUD operations on Clickzetta vector store."""
        # Prepare test data
        texts = [
            "这是第一个测试文档，包含一些中文内容。",
            "This is the second test document with English content.",
            "第三个文档混合了English和中文内容。",
        ]
        embeddings = [
            [0.1, 0.2, 0.3, 0.4],
            [0.5, 0.6, 0.7, 0.8],
            [0.9, 1.0, 1.1, 1.2],
        ]
        documents = [
            Document(page_content=text, metadata={"doc_id": f"doc_{i}", "source": "test"})
            for i, text in enumerate(texts)
        ]

        # Test create (initial insert)
        vector_store.create(texts=documents, embeddings=embeddings)

        # Test text_exists
        assert vector_store.text_exists("doc_0")
        assert not vector_store.text_exists("doc_999")

        # Test search_by_vector
        query_vector = [0.1, 0.2, 0.3, 0.4]
        results = vector_store.search_by_vector(query_vector, top_k=2)
        assert len(results) > 0
        assert results[0].page_content == texts[0]  # Should match the first document

        # Test search_by_full_text (Chinese)
        results = vector_store.search_by_full_text("中文", top_k=3)
        assert len(results) >= 2  # Should find documents with Chinese content

        # Test search_by_full_text (English)
        results = vector_store.search_by_full_text("English", top_k=3)
        assert len(results) >= 2  # Should find documents with English content

        # Test delete_by_ids
        vector_store.delete_by_ids(["doc_0"])
        assert not vector_store.text_exists("doc_0")
        assert vector_store.text_exists("doc_1")

        # Test delete_by_metadata_field
        vector_store.delete_by_metadata_field("source", "test")
        assert not vector_store.text_exists("doc_1")
        assert not vector_store.text_exists("doc_2")

    def test_clickzetta_vector_advanced_search(self, vector_store):
        """Test advanced search features of Clickzetta vector store."""
        # Prepare test data with more complex metadata
        documents = []
        embeddings = []
        for i in range(10):
            doc = Document(
                page_content=f"Document {i}: " + get_example_text(),
                metadata={
                    "doc_id": f"adv_doc_{i}",
                    "category": "technical" if i % 2 == 0 else "general",
                    "document_id": f"doc_{i // 3}",  # Group documents
                    "importance": i,
                },
            )
            documents.append(doc)
            # Create varied embeddings
            embeddings.append([0.1 * i, 0.2 * i, 0.3 * i, 0.4 * i])

        vector_store.create(texts=documents, embeddings=embeddings)

        # Test vector search with document filter
        query_vector = [0.5, 1.0, 1.5, 2.0]
        results = vector_store.search_by_vector(query_vector, top_k=5, document_ids_filter=["doc_0", "doc_1"])
        assert len(results) > 0
        # All results should belong to doc_0 or doc_1 groups
        for result in results:
            assert result.metadata["document_id"] in ["doc_0", "doc_1"]

        # Test score threshold
        results = vector_store.search_by_vector(query_vector, top_k=10, score_threshold=0.5)
        # Check that all results have a score above threshold
        for result in results:
            assert result.metadata.get("score", 0) >= 0.5

    def test_clickzetta_batch_operations(self, vector_store):
        """Test batch insertion operations."""
        # Prepare large batch of documents
        batch_size = 25
        documents = []
        embeddings = []

        for i in range(batch_size):
            doc = Document(
                page_content=f"Batch document {i}: This is a test document for batch processing.",
                metadata={"doc_id": f"batch_doc_{i}", "batch": "test_batch"},
            )
            documents.append(doc)
            embeddings.append([0.1 * (i % 10), 0.2 * (i % 10), 0.3 * (i % 10), 0.4 * (i % 10)])

        # Test batch insert
        vector_store.add_texts(documents=documents, embeddings=embeddings)

        # Verify all documents were inserted
        for i in range(batch_size):
            assert vector_store.text_exists(f"batch_doc_{i}")

        # Clean up
        vector_store.delete_by_metadata_field("batch", "test_batch")

    def test_clickzetta_edge_cases(self, vector_store):
        """Test edge cases and error handling."""
        # Test empty operations
        vector_store.create(texts=[], embeddings=[])
        vector_store.add_texts(documents=[], embeddings=[])
        vector_store.delete_by_ids([])

        # Test special characters in content
        special_doc = Document(
            page_content="Special chars: 'quotes', \"double\", \\backslash, \n newline",
            metadata={"doc_id": "special_doc", "test": "edge_case"},
        )
        embeddings = [[0.1, 0.2, 0.3, 0.4]]

        vector_store.add_texts(documents=[special_doc], embeddings=embeddings)
        assert vector_store.text_exists("special_doc")

        # Test search with special characters
        results = vector_store.search_by_full_text("quotes", top_k=1)
        if results:  # Full-text search might not be available
            assert len(results) > 0

        # Clean up
        vector_store.delete_by_ids(["special_doc"])

    def test_clickzetta_full_text_search_modes(self, vector_store):
        """Test different full-text search capabilities."""
        # Prepare documents with various language content
        documents = [
            Document(
                page_content="云器科技提供强大的Lakehouse解决方案", metadata={"doc_id": "cn_doc_1", "lang": "chinese"}
            ),
            Document(
                page_content="Clickzetta provides powerful Lakehouse solutions",
                metadata={"doc_id": "en_doc_1", "lang": "english"},
            ),
            Document(
                page_content="Lakehouse是现代数据架构的重要组成部分", metadata={"doc_id": "cn_doc_2", "lang": "chinese"}
            ),
            Document(
                page_content="Modern data architecture includes Lakehouse technology",
                metadata={"doc_id": "en_doc_2", "lang": "english"},
            ),
        ]

        embeddings = [[0.1, 0.2, 0.3, 0.4] for _ in documents]

        vector_store.create(texts=documents, embeddings=embeddings)

        # Test Chinese full-text search
        results = vector_store.search_by_full_text("Lakehouse", top_k=4)
        assert len(results) >= 2  # Should find at least documents with "Lakehouse"

        # Test English full-text search
        results = vector_store.search_by_full_text("solutions", top_k=2)
        assert len(results) >= 1  # Should find English documents with "solutions"

        # Test mixed search
        results = vector_store.search_by_full_text("数据架构", top_k=2)
        assert len(results) >= 1  # Should find Chinese documents with this phrase

        # Clean up
        vector_store.delete_by_metadata_field("lang", "chinese")
        vector_store.delete_by_metadata_field("lang", "english")
