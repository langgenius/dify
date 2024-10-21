from unittest.mock import MagicMock

from core.rag.datasource.vdb.baidu.baidu_vector import BaiduConfig, BaiduVector
from tests.integration_tests.vdb.__mock.baiduvectordb import setup_baiduvectordb_mock
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, get_example_text, setup_mock_redis


class BaiduVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = BaiduVector(
            "dify",
            BaiduConfig(
                endpoint="http://127.0.0.1:5287",
                account="root",
                api_key="dify",
                database="dify",
                shard=1,
                replicas=3,
            ),
        )

    def search_by_vector(self):
        hits_by_vector = self.vector.search_by_vector(query_vector=self.example_embedding)
        assert len(hits_by_vector) == 1

    def search_by_full_text(self):
        hits_by_full_text = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) == 0


def test_baidu_vector(setup_mock_redis, setup_baiduvectordb_mock):
    BaiduVectorTest().run_all_tests()
