from unittest.mock import MagicMock, patch

import pytest

from core.rag.datasource.vdb.tidb_vector.tidb_vector import TiDBVector, TiDBVectorConfig
from models.dataset import Document
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, get_example_text, setup_mock_redis


@pytest.fixture
def tidb_vector():
    return TiDBVector(
        collection_name="test_collection",
        config=TiDBVectorConfig(
            host="localhost",
            port=4000,
            user="root",
            password="",
            database="test",
            program_name="langgenius/dify",
        ),
    )


class TiDBVectorTest(AbstractVectorTest):
    def __init__(self, vector):
        super().__init__()
        self.vector = vector

    def search_by_full_text(self):
        hits_by_full_text: list[Document] = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) == 0

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key="doc_id", value=self.example_doc_id)
        assert len(ids) == 1


def test_tidb_vector(setup_mock_redis, tidb_vector):
    TiDBVectorTest(vector=tidb_vector).run_all_tests()
