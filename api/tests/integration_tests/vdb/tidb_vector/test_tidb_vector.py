from core.rag.datasource.vdb.tidb_vector.tidb_vector import TiDBVector, TiDBVectorConfig
from models.dataset import Document
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, get_example_text, setup_mock_redis


class TiDBVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.attributes = ['doc_id', 'dataset_id', 'document_id', 'doc_hash']
        self.vector = TiDBVector(
            collection_name=self.collection_name,
            config=TiDBVectorConfig(
                host="xxx.eu-central-1.xxx.aws.tidbcloud.com",
                port="4000",
                user="xxx.root",
                password="xxxxxx",
                database="dify"
            )
        )

    def search_by_full_text(self):
        hits_by_full_text: list[Document] = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) == 0

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key='document_id', value=self.example_doc_id)
        assert len(ids) == 1

    def delete_by_document_id(self):
        self.vector.delete_by_document_id(document_id=self.example_doc_id)


def test_tidb_vector(setup_mock_redis):
    TiDBVectorTest().run_all_tests()
