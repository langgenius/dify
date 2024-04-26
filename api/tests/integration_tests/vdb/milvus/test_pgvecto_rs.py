from core.rag.datasource.vdb.milvus.milvus_vector import MilvusConfig, MilvusVector
from core.rag.datasource.vdb.pgvecto_rs.pgvecto_rs import PgvectoRSConfig
from tests.integration_tests.vdb.test_vector_store import (
    AbstractTestVector,
    get_sample_text,
    setup_mock_redis,
)


class TestMilvusVector(AbstractTestVector):
    def __init__(self):
        super().__init__()
        self.vector = MilvusVector(
            collection_name=self.collection_name,
            config=PgvectoRSConfig(
                host=config.get('PGVECTO_RS_HOST'),
                port=config.get('PGVECTO_RS_PORT'),
                user=config.get('PGVECTO_RS_USER'),
                password=config.get('PGVECTO_RS_PASSWORD'),
                database=config.get('PGVECTO_RS_DATABASE'),
            ),
            dim=dim
        )

    def search_by_full_text(self):
        # pgvecto rs only support english text search, So it’s not open for now
        hits_by_full_text = self.vector.search_by_full_text(query=get_sample_text())
        assert len(hits_by_full_text) == 0


def test_milvus_vector(setup_mock_redis):
    TestMilvusVector().run_all_test()
