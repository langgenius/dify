from core.rag.datasource.vdb.pinecone.pinecone_vector import PineconeConfig, PineconeVector
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


class PineconeVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.attributes = ["doc_id", "dataset_id", "document_id", "doc_hash"]
        self.vector = PineconeVector(
            collection_name=self.collection_name,
            group_id=self.dataset_id,
            config=PineconeConfig(
                api_key="test_api_key",
                environment="test_environment",
                index_name="test_index",
            ),
        )

    def search_by_vector(self):
        super().search_by_vector()


def test_pinecone_vector():
    PineconeVectorTest().run_all_tests()
