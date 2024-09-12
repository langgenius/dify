from core.rag.datasource.vdb.pgvecto_rs.pgvecto_rs import PGVectoRS, PgvectoRSConfig
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    get_example_text,
    setup_mock_redis,
)


class PGVectoRSVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = PGVectoRS(
            collection_name=self.collection_name.lower(),
            config=PgvectoRSConfig(
                host="localhost",
                port=5431,
                user="postgres",
                password="difyai123456",
                database="dify",
            ),
            dim=128,
        )

    def search_by_full_text(self):
        # pgvecto rs only support english text search, So it’s not open for now
        hits_by_full_text = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) == 0

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key="document_id", value=self.example_doc_id)
        assert len(ids) == 1


def test_pgvecto_rs(setup_mock_redis):
    PGVectoRSVectorTest().run_all_tests()
