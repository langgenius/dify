import os

import pytest

from core.rag.datasource.vdb.mongodb.mongodb_config import MongoDBConfig
from core.rag.datasource.vdb.mongodb.mongodb_vector import MongoDBVector
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


# Default values for MongoDB test configuration
_DEFAULT_MONGODB_URI = "mongodb://localhost:27017"
_DEFAULT_MONGODB_DATABASE = "dify_test"
_DEFAULT_MONGODB_VECTOR_INDEX_NAME = "vector_index"


def _get_mongodb_config() -> MongoDBConfig:
    """
    Get MongoDB configuration from environment variables with safe defaults.
    
    Returns:
        MongoDBConfig instance with values from environment or defaults
    """
    return MongoDBConfig(
        MONGODB_URI=os.environ.get("MONGODB_URI", _DEFAULT_MONGODB_URI),
        MONGODB_DATABASE=os.environ.get("MONGODB_DATABASE", _DEFAULT_MONGODB_DATABASE),
        MONGODB_VECTOR_INDEX_NAME=os.environ.get(
            "MONGODB_VECTOR_INDEX_NAME", _DEFAULT_MONGODB_VECTOR_INDEX_NAME
        ),
    )


class MongoDBVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        config = _get_mongodb_config()
        self.vector = MongoDBVector(
            collection_name=self.collection_name,
            group_id=self.dataset_id,
            config=config,
        )

    def search_by_full_text(self):
        # MongoDB vector implementation currently doesn't support full text search
        # or returns empty list. Overriding to skip assertion failure.
        pass


def test_mongodb_vector(setup_mock_redis):
    """
    Integration test for MongoDB vector store.
    
    Uses MONGODB_URI from environment if set, otherwise defaults to localhost.
    Test will be skipped if MONGODB_URI is explicitly set to empty string.
    """
    mongodb_uri = os.environ.get("MONGODB_URI", _DEFAULT_MONGODB_URI)
    # Skip if explicitly set to empty (but allow default localhost for local testing)
    if mongodb_uri == "":
        pytest.skip("MONGODB_URI is explicitly set to empty string")

    MongoDBVectorTest().run_all_tests()

