from core.rag.datasource.vdb.couchbase.couchbase_vector import CouchbaseConfig, CouchbaseVector
import time
from core.rag.models.document import Document
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    get_example_text,
    setup_mock_redis,
)


class CouchbaseTest(AbstractVectorTest):
    def __init__(self):
        time.sleep(15)
        super().__init__()
        self.vector = CouchbaseVector(
            collection_name=self.collection_name,
            config=CouchbaseConfig(
                connection_string = '127.0.0.1',
                user = 'Administrator',
                password = 'password',
                bucket_name = 'Embeddings',
                scope_name = '_default',
            ),
        )

def test_couchbase(setup_mock_redis):
    CouchbaseTest().run_all_tests()
