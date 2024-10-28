import environs
import pytest

from core.rag.datasource.vdb.lindorm.lindorm_vector import LindormVectorStore, LindormVectorStoreConfig
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, setup_mock_redis

env = environs.Env()


class Config:
    SEARCH_ENDPOINT = env.str("SEARCH_ENDPOINT", "http://ld-*************-proxy-search-pub.lindorm.aliyuncs.com:30070")
    SEARCH_USERNAME = env.str("SEARCH_USERNAME", 'ADMIN')
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


def test_lindorm_vector(setup_mock_redis):
    # TestLindormVectorStore().run_all_tests()
    lindormStore = TestLindormVectorStore()
    lindormStore.create_vector()
    lindormStore.search_by_vector()
    lindormStore.search_by_full_text()
    lindormStore.text_exists()
    lindormStore.get_ids_by_metadata_field()
    added_doc_ids = lindormStore.add_texts()
    lindormStore.delete_by_ids(added_doc_ids)
    lindormStore.delete_vector()