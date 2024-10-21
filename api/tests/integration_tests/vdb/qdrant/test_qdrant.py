from core.rag.datasource.vdb.qdrant.qdrant_vector import QdrantConfig, QdrantVector
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


class QdrantVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.attributes = ["doc_id", "dataset_id", "document_id", "doc_hash"]
        self.vector = QdrantVector(
            collection_name=self.collection_name,
            group_id=self.dataset_id,
            config=QdrantConfig(
                endpoint="http://localhost:6333",
                api_key="difyai123456",
            ),
        )


def test_qdrant_vector(setup_mock_redis):
    QdrantVectorTest().run_all_tests()
