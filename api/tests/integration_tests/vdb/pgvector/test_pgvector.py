from core.rag.datasource.vdb.pgvector.pgvector import PGVector, PGVectorConfig
from core.rag.models.document import Document
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    get_example_text,
    setup_mock_redis,
)


class TestPGVector(AbstractVectorTest):
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
        hits_by_full_text: list[Document] = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) == 0


def test_pgvector(setup_mock_redis):
    TestPGVector().run_all_tests()
