from core.rag.datasource.vdb.pyvastbase.vastbase_vector import VastbaseVector, VastbaseVectorConfig
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


class VastbaseVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = VastbaseVector(
            collection_name=self.collection_name,
            config=VastbaseVectorConfig(
                host="localhost",
                port=5434,
                user="dify",
                password="Difyai123456",
                database="dify",
                min_connection=1,
                max_connection=5,
            ),
        )


def test_vastbase_vector(setup_mock_redis):
    VastbaseVectorTest().run_all_tests()
