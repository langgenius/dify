from core.rag.datasource.vdb.vikingdb.vikingdb_vector import VikingDBConfig, VikingDBVector
from tests.integration_tests.vdb.__mock.vikingdb import setup_vikingdb_mock
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, get_example_text, setup_mock_redis


class VikingDBVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = VikingDBVector(
            "test_collection",
            "test_group",
            config=VikingDBConfig(
                access_key="test_access_key",
                host="test_host",
                region="test_region",
                scheme="test_scheme",
                secret_key="test_secret_key",
                connection_timeout=30,
                socket_timeout=30,
            ),
        )

    def search_by_vector(self):
        hits_by_vector = self.vector.search_by_vector(query_vector=self.example_embedding)
        assert len(hits_by_vector) == 1

    def search_by_full_text(self):
        hits_by_full_text = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) == 0

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key="document_id", value="test_document_id")
        assert len(ids) > 0


def test_vikingdb_vector(setup_mock_redis, setup_vikingdb_mock):
    VikingDBVectorTest().run_all_tests()
