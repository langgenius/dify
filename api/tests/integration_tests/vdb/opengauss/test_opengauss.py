import time

import psycopg2

from core.rag.datasource.vdb.opengauss.opengauss import OpenGauss, OpenGaussConfig
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


class OpenGaussTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        max_retries = 5
        retry_delay = 20
        retry_count = 0
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
            except psycopg2.OperationalError as e:
                retry_count += 1
                if retry_count < max_retries:
                    time.sleep(retry_delay)
        self.vector = OpenGauss(
            collection_name=self.collection_name,
            config=config,
        )


def test_opengauss(setup_mock_redis):
    OpenGaussTest().run_all_tests()
