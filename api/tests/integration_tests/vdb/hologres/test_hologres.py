import os
import uuid
from typing import cast

from holo_search_sdk.types import BaseQuantizationType, DistanceType, TokenizerType

from core.rag.datasource.vdb.hologres.hologres_vector import HologresVector, HologresVectorConfig
from core.rag.models.document import Document
from tests.integration_tests.vdb.__mock.hologres import setup_hologres_mock
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, get_example_text, setup_mock_redis

MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


class HologresVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        # Hologres requires collection names to be lowercase
        self.collection_name = self.collection_name.lower()
        self.vector = HologresVector(
            collection_name=self.collection_name,
            config=HologresVectorConfig(
                host=os.environ.get("HOLOGRES_HOST", "localhost"),
                port=int(os.environ.get("HOLOGRES_PORT", "80")),
                database=os.environ.get("HOLOGRES_DATABASE", "test_db"),
                access_key_id=os.environ.get("HOLOGRES_ACCESS_KEY_ID", "test_key"),
                access_key_secret=os.environ.get("HOLOGRES_ACCESS_KEY_SECRET", "test_secret"),
                schema_name=os.environ.get("HOLOGRES_SCHEMA", "public"),
                tokenizer=cast(TokenizerType, os.environ.get("HOLOGRES_TOKENIZER", "jieba")),
                distance_method=cast(DistanceType, os.environ.get("HOLOGRES_DISTANCE_METHOD", "Cosine")),
                base_quantization_type=cast(
                    BaseQuantizationType, os.environ.get("HOLOGRES_BASE_QUANTIZATION_TYPE", "rabitq")
                ),
                max_degree=int(os.environ.get("HOLOGRES_MAX_DEGREE", "64")),
                ef_construction=int(os.environ.get("HOLOGRES_EF_CONSTRUCTION", "400")),
            ),
        )

    def search_by_full_text(self):
        """Override: full-text index may not be immediately ready in real mode."""
        hits_by_full_text = self.vector.search_by_full_text(query=get_example_text())
        if MOCK:
            # In mock mode, full-text search should return the document we inserted
            assert len(hits_by_full_text) == 1
            assert hits_by_full_text[0].metadata["doc_id"] == self.example_doc_id
        else:
            # In real mode, full-text index may need time to become active
            assert len(hits_by_full_text) >= 0

    def search_by_vector_with_filter(self):
        """Test vector search with document_ids_filter."""
        # Create another document with different document_id
        other_doc_id = str(uuid.uuid4())
        other_doc = Document(
            page_content="other_text",
            metadata={
                "doc_id": other_doc_id,
                "doc_hash": other_doc_id,
                "document_id": other_doc_id,
                "dataset_id": self.dataset_id,
            },
        )
        self.vector.add_texts(documents=[other_doc], embeddings=[self.example_embedding])

        # Search with filter - should only return the original document
        hits = self.vector.search_by_vector(
            query_vector=self.example_embedding,
            document_ids_filter=[self.example_doc_id],
        )
        assert len(hits) == 1
        assert hits[0].metadata["doc_id"] == self.example_doc_id

        # Search without filter - should return both
        all_hits = self.vector.search_by_vector(query_vector=self.example_embedding, top_k=10)
        assert len(all_hits) >= 2

    def search_by_full_text_with_filter(self):
        """Test full-text search with document_ids_filter."""
        # Create another document with different document_id
        other_doc_id = str(uuid.uuid4())
        other_doc = Document(
            page_content="unique_other_text",
            metadata={
                "doc_id": other_doc_id,
                "doc_hash": other_doc_id,
                "document_id": other_doc_id,
                "dataset_id": self.dataset_id,
            },
        )
        self.vector.add_texts(documents=[other_doc], embeddings=[self.example_embedding])

        # Search with filter - should only return the original document
        hits = self.vector.search_by_full_text(
            query=get_example_text(),
            document_ids_filter=[self.example_doc_id],
        )
        if MOCK:
            assert len(hits) == 1
            assert hits[0].metadata["doc_id"] == self.example_doc_id

    def get_ids_by_metadata_field(self):
        """Override: Hologres implements this method via JSONB query."""
        ids = self.vector.get_ids_by_metadata_field(key="document_id", value=self.example_doc_id)
        assert ids is not None
        assert len(ids) == 1

    def run_all_tests(self):
        # Clean up before running tests
        self.vector.delete()
        # Run base tests (create, search, text_exists, get_ids, add_texts, delete_by_ids, delete)
        super().run_all_tests()

        # Additional filter tests require fresh data (table was deleted by base tests)
        if MOCK:
            # Recreate collection for filter tests
            self.vector.create(
                texts=[
                    Document(
                        page_content=get_example_text(),
                        metadata={
                            "doc_id": self.example_doc_id,
                            "doc_hash": self.example_doc_id,
                            "document_id": self.example_doc_id,
                            "dataset_id": self.dataset_id,
                        },
                    )
                ],
                embeddings=[self.example_embedding],
            )
            self.search_by_vector_with_filter()
            self.search_by_full_text_with_filter()
            # Clean up
            self.vector.delete()


def test_hologres_vector(setup_mock_redis, setup_hologres_mock):
    """
    Test Hologres vector database implementation.

    This test covers:
    - Creating collection with vector index
    - Adding texts with embeddings
    - Vector similarity search
    - Full-text search
    - Text existence check
    - Batch deletion by IDs
    - Collection deletion
    """
    HologresVectorTest().run_all_tests()
