from core.rag.datasource.vdb.elasticsearch.elasticsearch_vector import ElasticSearchConfig, ElasticSearchVector
from tests.integration_tests.vdb.test_vector_store import (
    AbstractTestVector,
    setup_mock_redis,
)


class TestElasticSearchVector(AbstractTestVector):
    def __init__(self):
        super().__init__()
        self.vector = ElasticSearchVector(
            index_name='difyai-001',
            config=ElasticSearchConfig(
                host='http://localhost',
                port='9200',
                api_key_id='difyai',
                api_key='difyai123456'
            ),
            attributes=[]
        )

def test_elasticsearch_vector(setup_mock_redis):
    TestElasticSearchVector().run_all_tests()
