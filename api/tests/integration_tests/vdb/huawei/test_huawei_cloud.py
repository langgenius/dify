from core.rag.datasource.vdb.huawei.huawei_cloud_vector import HuaweiCloudVector, HuaweiCloudVectorConfig
from tests.integration_tests.vdb.__mock.huaweicloudvectordb import setup_client_mock
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, get_example_text, setup_mock_redis


class HuaweiCloudVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = HuaweiCloudVector(
            "dify",
            HuaweiCloudVectorConfig(
                hosts="https://127.0.0.1:9200",
                username="dify",
                password="dify",
            ),
        )

    def search_by_vector(self):
        hits_by_vector = self.vector.search_by_vector(query_vector=self.example_embedding)
        assert len(hits_by_vector) == 3

    def search_by_full_text(self):
        hits_by_full_text = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) == 3


def test_huawei_cloud_vector(setup_mock_redis, setup_client_mock):
    HuaweiCloudVectorTest().run_all_tests()
