import os

from core.rag.datasource.vdb.lindorm.lindorm_vector import LindormVectorStore, LindormVectorStoreConfig
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, setup_mock_redis


class Config:
    SEARCH_ENDPOINT = os.environ.get(
        "SEARCH_ENDPOINT", "http://ld-************-proxy-search-pub.lindorm.aliyuncs.com:30070"
    )
    SEARCH_USERNAME = os.environ.get("SEARCH_USERNAME", "ADMIN")
    SEARCH_PWD = os.environ.get("SEARCH_PWD", "ADMIN")
    USING_UGC = os.environ.get("USING_UGC", "True").lower() == "true"


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


class TestLindormVectorStoreUGC(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = LindormVectorStore(
            collection_name="ugc_index_test",
            config=LindormVectorStoreConfig(
                hosts=Config.SEARCH_ENDPOINT,
                username=Config.SEARCH_USERNAME,
                password=Config.SEARCH_PWD,
                using_ugc=Config.USING_UGC,
            ),
            routing_value=self.collection_name,
        )

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key="doc_id", value=self.example_doc_id)
        assert ids is not None
        assert len(ids) == 1
        assert ids[0] == self.example_doc_id


def test_lindorm_vector_ugc(setup_mock_redis):
    TestLindormVectorStore().run_all_tests()
    TestLindormVectorStoreUGC().run_all_tests()
