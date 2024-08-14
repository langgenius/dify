from unittest.mock import MagicMock, patch

import pytest

from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.opensearch.opensearch_vector import OpenSearchConfig, OpenSearchVector
from core.rag.models.document import Document
from extensions import ext_redis


def get_example_text() -> str:
    return "This is a sample text for testing purposes."


@pytest.fixture(scope="module")
def setup_mock_redis():
    ext_redis.redis_client.get = MagicMock(return_value=None)
    ext_redis.redis_client.set = MagicMock(return_value=None)

    mock_redis_lock = MagicMock()
    mock_redis_lock.__enter__ = MagicMock()
    mock_redis_lock.__exit__ = MagicMock()
    ext_redis.redis_client.lock = MagicMock(return_value=mock_redis_lock)


class TestOpenSearchVector:
    def setup_method(self):
        self.collection_name = "test_collection"
        self.example_doc_id = "example_doc_id"
        self.vector = OpenSearchVector(
            collection_name=self.collection_name,
            config=OpenSearchConfig(
                host='localhost',
                port=9200,
                user='admin',
                password='password',
                secure=False
            )
        )
        self.vector._client = MagicMock()

    @pytest.mark.parametrize("search_response, expected_length, expected_doc_id", [
        ({
            'hits': {
                'total': {'value': 1},
                'hits': [
                    {'_source': {'page_content': get_example_text(), 'metadata': {"document_id": "example_doc_id"}}}
                ]
            }
        }, 1, "example_doc_id"),
        ({
            'hits': {
                'total': {'value': 0},
                'hits': []
            }
        }, 0, None)
    ])
    def test_search_by_full_text(self, search_response, expected_length, expected_doc_id):
        self.vector._client.search.return_value = search_response

        hits_by_full_text = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) == expected_length
        if expected_length > 0:
            assert hits_by_full_text[0].metadata['document_id'] == expected_doc_id

    def test_search_by_vector(self):
        vector = [0.1] * 128
        mock_response = {
            'hits': {
                'total': {'value': 1},
                'hits': [
                    {
                        '_source': {
                            Field.CONTENT_KEY.value: get_example_text(),
                            Field.METADATA_KEY.value: {"document_id": self.example_doc_id}
                        },
                        '_score': 1.0
                    }
                ]
            }
        }
        self.vector._client.search.return_value = mock_response

        hits_by_vector = self.vector.search_by_vector(query_vector=vector)

        print("Hits by vector:", hits_by_vector)
        print("Expected document ID:", self.example_doc_id)
        print("Actual document ID:", hits_by_vector[0].metadata['document_id'] if hits_by_vector else "No hits")

        assert len(hits_by_vector) > 0, f"Expected at least one hit, got {len(hits_by_vector)}"
        assert hits_by_vector[0].metadata['document_id'] == self.example_doc_id, \
            f"Expected document ID {self.example_doc_id}, got {hits_by_vector[0].metadata['document_id']}"

    def test_get_ids_by_metadata_field(self):
        mock_response = {
            'hits': {
                'total': {'value': 1},
                'hits': [{'_id': 'mock_id'}]
            }
        }
        self.vector._client.search.return_value = mock_response

        doc = Document(page_content="Test content", metadata={"document_id": self.example_doc_id})
        embedding = [0.1] * 128

        with patch('opensearchpy.helpers.bulk') as mock_bulk:
            mock_bulk.return_value = ([], [])
            self.vector.add_texts([doc], [embedding])

        ids = self.vector.get_ids_by_metadata_field(key='document_id', value=self.example_doc_id)
        assert len(ids) == 1
        assert ids[0] == 'mock_id'

    def test_add_texts(self):
        self.vector._client.index.return_value = {'result': 'created'}

        doc = Document(page_content="Test content", metadata={"document_id": self.example_doc_id})
        embedding = [0.1] * 128

        with patch('opensearchpy.helpers.bulk') as mock_bulk:
            mock_bulk.return_value = ([], [])
            self.vector.add_texts([doc], [embedding])

        mock_response = {
            'hits': {
                'total': {'value': 1},
                'hits': [{'_id': 'mock_id'}]
            }
        }
        self.vector._client.search.return_value = mock_response

        ids = self.vector.get_ids_by_metadata_field(key='document_id', value=self.example_doc_id)
        assert len(ids) == 1
        assert ids[0] == 'mock_id'

@pytest.mark.usefixtures("setup_mock_redis")
class TestOpenSearchVectorWithRedis:
    def setup_method(self):
        self.tester = TestOpenSearchVector()

    def test_search_by_full_text(self):
        self.tester.setup_method()
        search_response = {
            'hits': {
                'total': {'value': 1},
                'hits': [
                    {'_source': {'page_content': get_example_text(), 'metadata': {"document_id": "example_doc_id"}}}
                ]
            }
        }
        expected_length = 1
        expected_doc_id = "example_doc_id"
        self.tester.test_search_by_full_text(search_response, expected_length, expected_doc_id)

    def test_get_ids_by_metadata_field(self):
        self.tester.setup_method()
        self.tester.test_get_ids_by_metadata_field()

    def test_add_texts(self):
        self.tester.setup_method()
        self.tester.test_add_texts()

    def test_search_by_vector(self):
        self.tester.setup_method()
        self.tester.test_search_by_vector()
