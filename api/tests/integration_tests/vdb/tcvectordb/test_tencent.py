from unittest.mock import MagicMock

from core.rag.datasource.vdb.tencent.tencent_vector import TencentConfig, TencentVector
from tests.integration_tests.vdb.__mock.tcvectordb import setup_tcvectordb_mock
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, get_example_text, setup_mock_redis

mock_client = MagicMock()
mock_client.list_databases.return_value = [{"name": "test"}]


class TencentVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = TencentVector(
            "dify",
            TencentConfig(
                url="http://127.0.0.1",
                api_key="dify",
                timeout=30,
                username="dify",
                database="dify",
                shard=1,
                replicas=2,
                enable_hybrid_search=True,
            ),
        )

    def search_by_vector(self):
        hits_by_vector = self.vector.search_by_vector(query_vector=self.example_embedding)
        assert len(hits_by_vector) == 1

    def search_by_full_text(self):
        hits_by_full_text = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) >= 0


def test_tencent_vector(setup_mock_redis, setup_tcvectordb_mock):
    TencentVectorTest().run_all_tests()
