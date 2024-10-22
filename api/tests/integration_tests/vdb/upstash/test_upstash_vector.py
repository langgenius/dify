import time
import uuid

from core.rag.datasource.vdb.upstash.upstash_vector import UpstashVector, UpstashVectorConfig
from core.rag.models.document import Document
from tests.integration_tests.vdb.__mock.upstashvectordb import setup_upstashvector_mock
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest


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


class UpstashVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = UpstashVector(
            collection_name="test_collection",
            config=UpstashVectorConfig(
                url="your-server-url",
                token="your-access-token",
            ),
        )
        self.example_embedding = [1.001 * i for i in range(self.vector._get_index_dimension())]

    def add_texts(self) -> list[str]:
        batch_size = 1
        documents = [get_example_document(doc_id=str(uuid.uuid4())) for _ in range(batch_size)]
        embeddings = [self.example_embedding] * batch_size
        self.vector.add_texts(documents=documents, embeddings=embeddings)
        return [doc.metadata["doc_id"] for doc in documents]

    def get_ids_by_metadata_field(self):
        print("doc_id", self.example_doc_id)
        ids = self.vector.get_ids_by_metadata_field(key="document_id", value=self.example_doc_id)
        assert len(ids) != 0

    def run_all_tests(self):
        self.create_vector()
        time.sleep(1)
        self.search_by_vector()
        self.text_exists()
        self.get_ids_by_metadata_field()
        added_doc_ids = self.add_texts()
        self.delete_by_ids(added_doc_ids + [self.example_doc_id])
        self.delete_vector()


def test_upstash_vector(setup_upstashvector_mock):
    UpstashVectorTest().run_all_tests()
