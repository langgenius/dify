from core.rag.datasource.vdb.upstash.upstash_vector import UpstashVector, UpstashVectorConfig
from core.rag.models.document import Document
from tests.integration_tests.vdb.__mock.upstashvectordb import setup_upstashvector_mock
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, get_example_text


class UpstashVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = UpstashVector(
            collection_name="test_collection",
            config=UpstashVectorConfig(
                url="your-server-url",
                token="your-access-token",
            ),
        )

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key="document_id", value=self.example_doc_id)
        assert len(ids) != 0

    def search_by_full_text(self):
        hits_by_full_text: list[Document] = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) == 0


def test_upstash_vector(setup_upstashvector_mock):
    UpstashVectorTest().run_all_tests()
