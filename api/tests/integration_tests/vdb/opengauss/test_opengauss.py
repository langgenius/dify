from core.rag.datasource.vdb.opengauss.opengauss import OpenGauss, OpenGaussConfig
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    get_example_text,
    setup_mock_redis,
)


class OpenGaussTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = OpenGauss(
            collection_name=self.collection_name,
            config=OpenGaussConfig(
                host="localhost",
                port=6600,
                user="postgres",
                password="Dify@123",
                database="dify",
                min_connection=1,
                max_connection=5,
            ),
        )


def test_opengauss(setup_mock_redis):
    OpenGaussTest().run_all_tests()
