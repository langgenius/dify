import subprocess
import time

from core.rag.datasource.vdb.couchbase.couchbase_vector import CouchbaseConfig, CouchbaseVector
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    get_example_text,
    setup_mock_redis,
)


def wait_for_healthy_container(service_name="couchbase-server", timeout=300):
    start_time = time.time()
    while time.time() - start_time < timeout:
        result = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.Health.Status}}", service_name], capture_output=True, text=True
        )
        if result.stdout.strip() == "healthy":
            print(f"{service_name} is healthy!")
            return True
        else:
            print(f"Waiting for {service_name} to be healthy...")
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
