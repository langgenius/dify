import os

from core.rag.datasource.vdb.tablestore.tablestore_vector import (
    TableStoreConfig,
    TableStoreVector,
)
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


class TableStoreVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = TableStoreVector(
            collection_name=self.collection_name,
            config=TableStoreConfig(
                endpoint=os.getenv("TABLESTORE_ENDPOINT"),
                instance_name=os.getenv("TABLESTORE_INSTANCE_NAME"),
                access_key_id=os.getenv("TABLESTORE_ACCESS_KEY_ID"),
                access_key_secret=os.getenv("TABLESTORE_ACCESS_KEY_SECRET"),
            ),
        )

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key="doc_id", value=self.example_doc_id)
        assert ids is not None
        assert len(ids) == 1
        assert ids[0] == self.example_doc_id


def test_tablestore_vector(setup_mock_redis):
    TableStoreVectorTest().run_all_tests()
