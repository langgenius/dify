import os

from core.rag.datasource.vdb.mongodb.mongodb import MongoVector, MongoVectorConfig
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


class MongoVectorTest(AbstractVectorTest):
    """
    Test class for the MongoVector vector store implementation.
    """
    def __init__(self):
        super().__init__()
        # It's a good practice to use environment variables for configuration,
        # with sensible defaults for local testing environments.
        mongo_uri = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
        mongo_database = os.environ.get("MONGO_DATABASE", "dify_test")

        self.vector = MongoVector(
            collection_name=self.collection_name,
            config=MongoVectorConfig(
                mongo_uri=mongo_uri,
                database=mongo_database,
            ),
        )


def test_mongodb(setup_mock_redis):
    """
    This function initializes and runs the test suite for MongoVector.
    
    The `setup_mock_redis` fixture is used to mock Redis interactions,
    such as the lock used during index creation, allowing the test to run
    without a live Redis instance.
    """
    # Instantiate the test class
    mongo_test = MongoVectorTest()

    # The run_all_tests() method (defined in the parent AbstractVectorTest)
    # will execute a series of standard tests:
    # 1. Add texts and embeddings.
    # 2. Search by vector.
    # 3. Search by full text.
    # 4. Check for text existence.
    # 5. Delete by IDs.
    # 6. Clean up the collection.
    mongo_test.run_all_tests()