from unittest.mock import MagicMock, patch

import pytest

from core.rag.datasource.vdb.tidb_vector.tidb_vector import TiDBVector, TiDBVectorConfig
from models.dataset import Document
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, get_example_text, setup_mock_redis


@pytest.fixture
def tidb_vector():
    return TiDBVector(
        collection_name='test_collection',
        config=TiDBVectorConfig(
            host="xxx.eu-central-1.xxx.aws.tidbcloud.com",
            port="4000",
            user="xxx.root",
            password="xxxxxx",
            database="dify"
        )
    )


class TiDBVectorTest(AbstractVectorTest):
    def __init__(self, vector):
        super().__init__()
        self.vector = vector

    def text_exists(self):
        exist = self.vector.text_exists(self.example_doc_id)
        assert exist == False

    def search_by_vector(self):
        hits_by_vector: list[Document] = self.vector.search_by_vector(query_vector=self.example_embedding)
        assert len(hits_by_vector) == 0

    def search_by_full_text(self):
        hits_by_full_text: list[Document] = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) == 0

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key='document_id', value=self.example_doc_id)
        assert len(ids) == 0

    def delete_by_document_id(self):
        self.vector.delete_by_document_id(document_id=self.example_doc_id)


def test_tidb_vector(setup_mock_redis, setup_tidbvector_mock, tidb_vector, mock_session):
    TiDBVectorTest(vector=tidb_vector).run_all_tests()


@pytest.fixture
def mock_session():
    with patch('core.rag.datasource.vdb.tidb_vector.tidb_vector.Session', new_callable=MagicMock) as mock_session:
        yield mock_session


@pytest.fixture
def setup_tidbvector_mock(tidb_vector, mock_session):
    with patch('core.rag.datasource.vdb.tidb_vector.tidb_vector.create_engine'):
        with patch.object(tidb_vector._engine, 'connect'):
            yield tidb_vector
