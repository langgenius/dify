from core.rag.datasource.vdb.opensearch.opensearch_vector import OpenSearchConfig, OpenSearchVector
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)

# Be consistent with the OPENSEARCH_INITIAL_ADMIN_PASSWORD variables defined in docker/docker-compose.yaml.
ADMIN_PASSWORD: str = "Qazwsxedc!@#123"


class OpenSearchVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = OpenSearchVector(
            collection_name=self.collection_name,
            config=OpenSearchConfig(
                host="127.0.0.1",
                port="9201",
                user="admin",
                password=ADMIN_PASSWORD,
                secure=False,
            ),
        )

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key="document_id", value=self.example_doc_id)
        assert len(ids) == 1


def test_opensearch_vector(setup_mock_redis):
    OpenSearchVectorTest().run_all_tests()
