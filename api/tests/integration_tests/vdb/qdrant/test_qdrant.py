from core.rag.datasource.vdb.qdrant.qdrant_vector import QdrantConfig, QdrantVector
from core.rag.models.document import Document
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

    def search_by_vector(self):
        super().search_by_vector()
        # only test for qdrant, may not work on other vector stores
        hits_by_vector: list[Document] = self.vector.search_by_vector(
            query_vector=self.example_embedding, score_threshold=1
        )
        assert len(hits_by_vector) == 0


def test_qdrant_vector(setup_mock_redis):
    QdrantVectorTest().run_all_tests()
