import pytest

from core.rag.datasource.vdb.doris.doris_vector import (
    DorisConfig,
    DorisVector,
)
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


@pytest.fixture
def doris_vector():
    return DorisVector(
        "dify_test_collection",
        config=DorisConfig(
            host="127.0.0.1",
            port=9030,
            user="root",
            password="",
            database="dify",
            min_connection=1,
            max_connection=5,
            enable_text_search=True,
            text_search_analyzer="english",
            streamload_port=8030,
        ),
        attributes=["doc_id", "dataset_id", "document_id"],
    )


class DorisVectorTest(AbstractVectorTest):
    def __init__(self, vector: DorisVector):
        super().__init__()
        self.vector = vector

    def get_ids_by_metadata_field(self):
        with pytest.raises(NotImplementedError):
            self.vector.get_ids_by_metadata_field(key="document_id", value=self.example_doc_id)


def test_doris_vector(
    setup_mock_redis,
    doris_vector,
):
    DorisVectorTest(doris_vector).run_all_tests()
