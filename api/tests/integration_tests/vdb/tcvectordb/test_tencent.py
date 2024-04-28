from core.rag.datasource.vdb.tencent.tencent_vector import TencentConfig, TencentVector
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


class TencentVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = TencentVector(
            collection_name='test-001',
            config=TencentConfig(
                url="http://127.0.0.1",
                api_key="dify",
                timeout=30,
                username="dify",
                database="dify",
                shard=1,
                replicas=2,
            )
        )


def test_tencent_vector(setup_mock_redis):
    TencentVectorTest().run_all_tests()
