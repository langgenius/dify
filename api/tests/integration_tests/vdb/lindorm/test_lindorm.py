import environs
import pytest

from core.rag.datasource.vdb.lindorm.lindorm_vector import LindormVectorStore, LindormVectorStoreConfig
from models.dataset import Dataset
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, get_example_document, setup_mock_redis

env = environs.Env()


class Config:
    SEARCH_ENDPOINT = env.str("SEARCH_ENDPOINT", "http://ld-*************-proxy-search-pub.lindorm.aliyuncs.com:30070")
    SEARCH_USERNAME = env.str("SEARCH_USERNAME", 'ADMIN')
    SEARCH_PWD = env.str("SEARCH_PWD", "PWD")


@pytest.mark.usefixtures("setup_mock_redis")
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
        self.dataset_id = str(10)
        self.collection_name = Dataset.gen_collection_name_by_id(self.dataset_id) + "_test"
        self.example_doc_id = str(20)
        self.example_embedding = [1.001 * i for i in range(128)]

    def create_vector(self) -> None:
        self.vector.create(
            texts=[get_example_document(doc_id=self.example_doc_id)],
            embeddings=[self.example_embedding],
        )

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key="doc_id", value=self.example_doc_id)
        assert len(ids) > 0

    def run_all_tests(self):
        self.create_vector()
        self.search_by_vector()
        self.search_by_full_text()
        self.text_exists()
        self.get_ids_by_metadata_field()
        added_doc_ids = self.add_texts()
        self.delete_by_ids(added_doc_ids)
        self.delete_vector()


def test_lindorm_vector(setup_mock_redis):
    TestLindormVectorStore().run_all_tests()




