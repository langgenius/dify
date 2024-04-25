import uuid
from unittest.mock import MagicMock

import pytest

from core.rag.models.document import Document
from extensions import ext_redis
from models.dataset import Dataset


def get_sample_text() -> str:
    return 'test_text'


def get_sample_embedding() -> list[float]:
    return [1.1, 2.2, 3.3]


def get_sample_query_vector() -> list[float]:
    return get_sample_embedding()


def get_sample_document(sample_dataset_id: str) -> Document:
    doc = Document(
        page_content=get_sample_text(),
        metadata={
            "doc_id": sample_dataset_id,
            "doc_hash": sample_dataset_id,
            "document_id": sample_dataset_id,
            "dataset_id": sample_dataset_id,
        }
    )
    return doc


@pytest.fixture
def setup_mock_redis() -> None:
    # get
    ext_redis.redis_client.get = MagicMock(return_value=None)

    # set
    ext_redis.redis_client.set = MagicMock(return_value=None)

    # lock
    mock_redis_lock = MagicMock()
    mock_redis_lock.__enter__ = MagicMock()
    mock_redis_lock.__exit__ = MagicMock()
    ext_redis.redis_client.lock = mock_redis_lock


class AbstractTestVector:
    def __init__(self):
        self.vector = None
        self.dataset_id = str(uuid.uuid4())
        self.collection_name = Dataset.gen_collection_name_by_id(self.dataset_id)

    def create_vector(self) -> None:
        self.vector.create(
            texts=[get_sample_document(self.dataset_id)],
            embeddings=[get_sample_embedding()],
        )

    def search_by_vector(self):
        hits_by_vector = self.vector.search_by_vector(query_vector=get_sample_query_vector())
        assert len(hits_by_vector) >= 1

    def search_by_full_text(self):
        hits_by_full_text = self.vector.search_by_full_text(query=get_sample_text())
        assert len(hits_by_full_text) >= 1

    def delete_vector(self):
        self.vector.delete()

    def run_all_test(self):
        self.create_vector()
        self.search_by_vector()
        self.search_by_full_text()
        self.delete_vector()
