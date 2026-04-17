import pytest
from dify_vdb_oceanbase.oceanbase_vector import (
    OceanBaseVector,
    OceanBaseVectorConfig,
)

from core.rag.datasource.vdb.vector_integration_test_support import (
    AbstractVectorTest,
)


@pytest.fixture
def oceanbase_vector():
    return OceanBaseVector(
        "dify_test_collection",
        config=OceanBaseVectorConfig(
            host="127.0.0.1",
            port=2881,
            user="root",
            database="test",
            password="difyai123456",
            enable_hybrid_search=True,
            batch_size=10,
        ),
    )


class OceanBaseVectorTest(AbstractVectorTest):
    def __init__(self, vector: OceanBaseVector):
        super().__init__()
        self.vector = vector

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key="document_id", value=self.example_doc_id)
        assert len(ids) == 1


def test_oceanbase_vector(
    setup_mock_redis,
    oceanbase_vector,
):
    OceanBaseVectorTest(oceanbase_vector).run_all_tests()
