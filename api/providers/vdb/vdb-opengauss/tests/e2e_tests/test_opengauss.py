import time

import psycopg2
from dify_vdb_opengauss.opengauss import OpenGauss, OpenGaussConfig

from core.rag.datasource.vdb.vector_integration_test_support import (
    AbstractVectorTest,
)


class OpenGaussTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        max_retries = 5
        retry_delay = 20
        retry_count = 0
        config: OpenGaussConfig | None = None
        while retry_count < max_retries:
            try:
                config = OpenGaussConfig(
                    host="localhost",
                    port=6600,
                    user="postgres",
                    password="Dify@123",
                    database="dify",
                    min_connection=1,
                    max_connection=5,
                )
                break
            except psycopg2.OperationalError:
                retry_count += 1
                if retry_count < max_retries:
                    time.sleep(retry_delay)
        if config is None:
            raise RuntimeError("Failed to initialize OpenGauss config after retries")

        self.vector = OpenGauss(
            collection_name=self.collection_name,
            config=config,
        )


def test_opengauss(setup_mock_redis):
    OpenGaussTest().run_all_tests()
