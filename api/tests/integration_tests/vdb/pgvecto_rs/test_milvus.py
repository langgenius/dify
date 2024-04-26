from core.rag.datasource.vdb.milvus.milvus_vector import MilvusConfig, MilvusVector
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
            config=MilvusConfig(
                host='localhost',
                port=19530,
                user='root',
                password='Milvus',
            )
        )

    def search_by_full_text(self):
        # milvus dos not support full text searching yet in < 2.3.x
        hits_by_full_text = self.vector.search_by_full_text(query=get_sample_text())
        assert len(hits_by_full_text) == 0


def test_milvus_vector(setup_mock_redis):
    TestMilvusVector().run_all_test()
