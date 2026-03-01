from core.rag.datasource.vdb.matrixone.matrixone_vector import MatrixoneConfig, MatrixoneVector
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


class MatrixoneVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = MatrixoneVector(
            collection_name=self.collection_name,
            config=MatrixoneConfig(
                host="localhost", port=6001, user="dump", password="111", database="dify", metric="l2"
            ),
        )

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key="document_id", value=self.example_doc_id)
        assert len(ids) == 1


def test_matrixone_vector(setup_mock_redis):
    MatrixoneVectorTest().run_all_tests()
