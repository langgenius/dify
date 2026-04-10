from dify_vdb_milvus.milvus_vector import MilvusConfig, MilvusVector

from core.rag.datasource.vdb.vector_integration_test_support import (
    AbstractVectorTest,
    get_example_text,
)


class MilvusVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = MilvusVector(
            collection_name=self.collection_name,
            config=MilvusConfig(
                uri="http://localhost:19530",
                user="root",
                password="Milvus",
            ),
        )

    def search_by_full_text(self):
        # milvus support BM25 full text search after version 2.5.0-beta
        hits_by_full_text = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) >= 0

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key="document_id", value=self.example_doc_id)
        assert len(ids) == 1


def test_milvus_vector(setup_mock_redis):
    MilvusVectorTest().run_all_tests()
