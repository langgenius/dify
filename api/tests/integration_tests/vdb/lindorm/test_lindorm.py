import environs

from core.rag.datasource.vdb.lindorm.lindorm_vector import LindormVectorStore, LindormVectorStoreConfig
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, setup_mock_redis

env = environs.Env()


class Config:
    SEARCH_ENDPOINT = env.str("SEARCH_ENDPOINT", "http://ld-*************-proxy-search-pub.lindorm.aliyuncs.com:30070")
    SEARCH_USERNAME = env.str("SEARCH_USERNAME", "ADMIN")
    SEARCH_PWD = env.str("SEARCH_PWD", "PWD")


class TestLindormVectorStore(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = LindormVectorStore(
            collection_name=self.collection_name,
            config=LindormVectorStoreConfig(
                hosts=Config.SEARCH_ENDPOINT,
                username=Config.SEARCH_USERNAME,
                password=Config.SEARCH_PWD,
            ),
        )

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key="doc_id", value=self.example_doc_id)
        assert ids is not None
        assert len(ids) == 1
        assert ids[0] == self.example_doc_id


def test_lindorm_vector(setup_mock_redis):
    TestLindormVectorStore().run_all_tests()
