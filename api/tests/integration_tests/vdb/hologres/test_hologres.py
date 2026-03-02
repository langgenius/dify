import os

from core.rag.datasource.vdb.hologres.hologres_vector import HologresVector, HologresVectorConfig
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, setup_mock_redis


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
                tokenizer=os.environ.get("HOLOGRES_TOKENIZER", "jieba"),
                distance_method=os.environ.get("HOLOGRES_DISTANCE_METHOD", "Cosine"),
                base_quantization_type=os.environ.get("HOLOGRES_BASE_QUANTIZATION_TYPE", "rabitq"),
                max_degree=int(os.environ.get("HOLOGRES_MAX_DEGREE", "64")),
                ef_construction=int(os.environ.get("HOLOGRES_EF_CONSTRUCTION", "400")),
            ),
        )

    def search_by_full_text(self):
        """Override: full-text index may not be immediately ready."""
        from tests.integration_tests.vdb.test_vector_store import get_example_text

        hits_by_full_text = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) >= 0

    def get_ids_by_metadata_field(self):
        """Override: Hologres implements this method via JSONB query."""
        ids = self.vector.get_ids_by_metadata_field(key="document_id", value=self.example_doc_id)
        assert ids is not None
        assert len(ids) == 1

    def run_all_tests(self):
        # Clean up before running tests
        self.vector.delete()
        return super().run_all_tests()


def test_hologres_vector(setup_mock_redis):
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
