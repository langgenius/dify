from unittest.mock import MagicMock

import pytest

from core.rag.datasource.vdb.pinecone.pinecone_vector import PineconeConfig, PineconeVector
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    get_example_text,
    setup_mock_redis,
)


class PineconeVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = PineconeVector(
            collection_name=self.collection_name,
            config=PineconeConfig(api_key="PINECONE_API_KEY", index="dify-index", index_dimension=768),
        )

    def search_by_full_text(self):
        # pinecone does not support full text searching
        hits_by_full_text = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) == 0


@pytest.fixture
def test_instance():
    return PineconeVectorTest()


def test_pinecone_vector(test_instance, setup_mock_redis, pinecone_mock):
    test_instance.vector._client = pinecone_mock
    test_instance.create_vector()
    # It seems that pinecone needs sometime to persist the data.
    test_instance.search_by_vector()
    test_instance.text_exists()
    test_instance.get_ids_by_metadata_field()
    added_doc_ids = test_instance.add_texts()
    test_instance.delete_by_ids(added_doc_ids)
    test_instance.delete_vector()


@pytest.fixture
def pinecone_mock(test_instance):
    mock = MagicMock()
    mock.has_index.return_value = True
    mock.Index.return_value.query.return_value = {
        "matches": [
            {"id": "1", "metadata": {"page_content": "content1", "doc_id": test_instance.example_doc_id}, "score": 0.9},
        ]
    }
    return mock
