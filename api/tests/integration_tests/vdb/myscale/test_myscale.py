from core.rag.datasource.vdb.myscale.myscale_vector import MyScaleConfig, MyScaleVector
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


class MyScaleVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = MyScaleVector(
            collection_name=self.collection_name,
            config=MyScaleConfig(
                host="localhost",
                port=8123,
                user="default",
                password="",
                database="dify",
                fts_params="",
            ),
        )

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key="document_id", value=self.example_doc_id)
        assert len(ids) == 1


def test_myscale_vector(setup_mock_redis):
    MyScaleVectorTest().run_all_tests()
