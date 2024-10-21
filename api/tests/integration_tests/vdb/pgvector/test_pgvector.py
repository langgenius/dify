from core.rag.datasource.vdb.pgvector.pgvector import PGVector, PGVectorConfig
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
)


class PGVectorTest(AbstractVectorTest):
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
                min_connection=1,
                max_connection=5,
            ),
        )


def test_pgvector(setup_mock_redis):
    PGVectorTest().run_all_tests()
