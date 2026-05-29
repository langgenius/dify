from dify_vdb_elasticsearch.elasticsearch_vector import ElasticSearchConfig, ElasticSearchVector

from core.rag.datasource.vdb.vector_integration_test_support import (
    AbstractVectorTest,
)


class ElasticSearchVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.attributes = ["doc_id", "dataset_id", "document_id", "doc_hash"]
        self.vector = ElasticSearchVector(
            index_name=self.collection_name.lower(),
            config=ElasticSearchConfig(
                use_cloud=False, host="http://localhost", port="9200", username="elastic", password="elastic"
            ),
            attributes=self.attributes,
        )


def test_elasticsearch_vector(setup_mock_redis):
    ElasticSearchVectorTest().run_all_tests()
