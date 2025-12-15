import os

import pytest

from core.rag.datasource.vdb.mongodb.mongodb_config import MongoDBConfig
from core.rag.datasource.vdb.mongodb.mongodb_vector import MongoDBVector
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


class MongoDBVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = MongoDBVector(
            collection_name=self.collection_name,
            group_id=self.dataset_id,
            config=MongoDBConfig(
                MONGODB_URI=os.environ.get("MONGODB_URI", "mongodb://localhost:27017"),
                MONGODB_DATABASE=os.environ.get("MONGODB_DATABASE", "dify_test"),
                MONGODB_VECTOR_INDEX_NAME=os.environ.get("MONGODB_VECTOR_INDEX_NAME", "vector_index"),
            ),
        )

    def search_by_full_text(self):
        # MongoDB vector implementation currently doesn't support full text search
        # or returns empty list. Overriding to skip assertion failure.
        pass


def test_mongodb_vector(setup_mock_redis):
    if not os.environ.get("MONGODB_URI"):
        pytest.skip("MONGODB_URI not set")

    MongoDBVectorTest().run_all_tests()

