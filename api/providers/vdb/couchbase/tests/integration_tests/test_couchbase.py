import subprocess
import time

import logging

logger = logging.getLogger(__name__)
from dify_vdb_couchbase.couchbase_vector import CouchbaseConfig, CouchbaseVector
from core.rag.datasource.vdb.vector_integration_test_support import (
    AbstractVectorTest,
)


def wait_for_healthy_container(service_name="couchbase-server", timeout=300):
    start_time = time.time()
    while time.time() - start_time < timeout:
        result = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.Health.Status}}", service_name], capture_output=True, text=True
        )
        if result.stdout.strip() == "healthy":
            logger.info(f"{service_name} is healthy!")
            return True
        else:
            logger.info(f"Waiting for {service_name} to be healthy...")
        time.sleep(10)
    raise TimeoutError(f"{service_name} did not become healthy in time")


class CouchbaseTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = CouchbaseVector(
            collection_name=self.collection_name,
            config=CouchbaseConfig(
                connection_string="couchbase://127.0.0.1",
                user="Administrator",
                password="password",
                bucket_name="Embeddings",
                scope_name="_default",
            ),
        )

    def search_by_vector(self):
        # brief sleep to ensure document is indexed
        time.sleep(5)
        hits_by_vector = self.vector.search_by_vector(query_vector=self.example_embedding)
        assert len(hits_by_vector) == 1


def test_couchbase(setup_mock_redis):
    wait_for_healthy_container("couchbase-server", timeout=60)
    CouchbaseTest().run_all_tests()
