import uuid
from unittest.mock import MagicMock

import pytest

from core.rag.models.document import Document
from extensions import ext_redis
from models.dataset import Dataset


def get_example_text() -> str:
    return "test_text"


def get_example_document(doc_id: str) -> Document:
    doc = Document(
        page_content=get_example_text(),
        metadata={
            "doc_id": doc_id,
            "doc_hash": doc_id,
            "document_id": doc_id,
            "dataset_id": doc_id,
        },
    )
    return doc


@pytest.fixture
def setup_mock_redis():
    # get
    ext_redis.redis_client.get = MagicMock(return_value=None)

    # set
    ext_redis.redis_client.set = MagicMock(return_value=None)

    # lock
    mock_redis_lock = MagicMock()
    mock_redis_lock.__enter__ = MagicMock()
    mock_redis_lock.__exit__ = MagicMock()
    ext_redis.redis_client.lock = mock_redis_lock


class AbstractVectorTest:
    def __init__(self):
        self.vector = None
        self.dataset_id = str(uuid.uuid4())
        self.collection_name = Dataset.gen_collection_name_by_id(self.dataset_id) + "_test"
        self.example_doc_id = str(uuid.uuid4())
        self.example_embedding = [1.001 * i for i in range(128)]

    def create_vector(self):
        self.vector.create(
            texts=[get_example_document(doc_id=self.example_doc_id)],
            embeddings=[self.example_embedding],
        )

    def search_by_vector(self):
        hits_by_vector: list[Document] = self.vector.search_by_vector(query_vector=self.example_embedding)
        assert len(hits_by_vector) == 1
        assert hits_by_vector[0].metadata["doc_id"] == self.example_doc_id

    def search_by_full_text(self):
        hits_by_full_text: list[Document] = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) == 1
        assert hits_by_full_text[0].metadata["doc_id"] == self.example_doc_id

    def delete_vector(self):
        self.vector.delete()

    def delete_by_ids(self, ids: list[str]):
        self.vector.delete_by_ids(ids=ids)

    def add_texts(self) -> list[str]:
        batch_size = 100
        documents = [get_example_document(doc_id=str(uuid.uuid4())) for _ in range(batch_size)]
        embeddings = [self.example_embedding] * batch_size
        self.vector.add_texts(documents=documents, embeddings=embeddings)
        return [doc.metadata["doc_id"] for doc in documents]

    def text_exists(self):
        assert self.vector.text_exists(self.example_doc_id)

    def get_ids_by_metadata_field(self):
        with pytest.raises(NotImplementedError):
            self.vector.get_ids_by_metadata_field(key="key", value="value")

    def run_all_tests(self):
        self.create_vector()
        self.search_by_vector()
        self.search_by_full_text()
        self.text_exists()
        self.get_ids_by_metadata_field()
        added_doc_ids = self.add_texts()
        self.delete_by_ids(added_doc_ids)
        self.delete_vector()
