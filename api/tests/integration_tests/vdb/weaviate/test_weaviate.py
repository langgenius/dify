from core.rag.datasource.vdb.weaviate.weaviate_vector import WeaviateConfig, WeaviateVector
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


class WeaviateVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.attributes = ["doc_id", "dataset_id", "document_id", "doc_hash"]
        self.vector = WeaviateVector(
            collection_name=self.collection_name,
            config=WeaviateConfig(
                endpoint="http://localhost:8080",
                api_key="WVF5YThaHlkYwhGUSmCRgsX3tD5ngdN8pkih",
            ),
            attributes=self.attributes,
        )


def test_weaviate_vector(setup_mock_redis):
    WeaviateVectorTest().run_all_tests()
