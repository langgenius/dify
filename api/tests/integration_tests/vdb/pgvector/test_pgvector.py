from core.rag.datasource.vdb.pgvector.pgvector import PGVector, PGVectorConfig
from tests.integration_tests.vdb.test_vector_store import (
    AbstractTestVector,
    get_sample_text,
    setup_mock_redis,
)


class TestPGVector(AbstractTestVector):
    def __init__(self):
        super().__init__()
        self.vector = PGVector(
            collection_name=self.collection_name,
            config=PGVectorConfig(
                host="localhost",
                port=5433,
                user="postgres",
                password="difyai123456",
                database="dify",
            ),
        )

    def search_by_full_text(self):
        hits_by_full_text = self.vector.search_by_full_text(query=get_sample_text())
        assert len(hits_by_full_text) == 0

    def delete_document_by_id(self):
        self.vector.delete_by_document_id(self.dataset_id)

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field("document_id", self.dataset_id)
        assert len(ids) >= 1


def test_pgvector(setup_mock_redis):
    TestPGVector().run_all_tests()
