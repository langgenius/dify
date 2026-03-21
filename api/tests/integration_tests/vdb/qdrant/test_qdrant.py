import uuid

from core.rag.datasource.vdb.qdrant.qdrant_vector import QdrantConfig, QdrantVector
from core.rag.models.document import Document
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


class QdrantVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.attributes = ["doc_id", "dataset_id", "document_id", "doc_hash"]
        self.vector = QdrantVector(
            collection_name=self.collection_name,
            group_id=self.dataset_id,
            config=QdrantConfig(
                endpoint="http://localhost:6333",
                api_key="difyai123456",
            ),
        )
        # Additional doc IDs for multi-keyword search tests
        self.doc_apple_id = ""
        self.doc_banana_id = ""
        self.doc_both_id = ""

    def search_by_vector(self):
        super().search_by_vector()
        # only test for qdrant, may not work on other vector stores
        hits_by_vector: list[Document] = self.vector.search_by_vector(
            query_vector=self.example_embedding, score_threshold=1
        )
        assert len(hits_by_vector) == 0

    def _create_document(self, content: str, doc_id: str) -> Document:
        """Create a document with the given content and doc_id."""
        return Document(
            page_content=content,
            metadata={
                "doc_id": doc_id,
                "doc_hash": doc_id,
                "document_id": doc_id,
                "dataset_id": self.dataset_id,
            },
        )

    def setup_multi_keyword_documents(self):
        """Create test documents with different keyword combinations for multi-keyword search tests."""
        self.doc_apple_id = str(uuid.uuid4())
        self.doc_banana_id = str(uuid.uuid4())
        self.doc_both_id = str(uuid.uuid4())

        documents = [
            self._create_document("This document contains apple only", self.doc_apple_id),
            self._create_document("This document contains banana only", self.doc_banana_id),
            self._create_document("This document contains both apple and banana", self.doc_both_id),
        ]
        embeddings = [self.example_embedding] * len(documents)

        self.vector.add_texts(documents=documents, embeddings=embeddings)

    def search_by_full_text_multi_keyword(self):
        """Test multi-keyword search returns docs matching ANY keyword (OR logic)."""
        # First verify single keyword searches work correctly
        hits_apple = self.vector.search_by_full_text(query="apple", top_k=10)
        apple_ids = {doc.metadata["doc_id"] for doc in hits_apple}
        assert self.doc_apple_id in apple_ids, "Document with 'apple' should be found"
        assert self.doc_both_id in apple_ids, "Document with 'apple and banana' should be found"

        hits_banana = self.vector.search_by_full_text(query="banana", top_k=10)
        banana_ids = {doc.metadata["doc_id"] for doc in hits_banana}
        assert self.doc_banana_id in banana_ids, "Document with 'banana' should be found"
        assert self.doc_both_id in banana_ids, "Document with 'apple and banana' should be found"

        # Test multi-keyword search returns all matching documents
        hits = self.vector.search_by_full_text(query="apple banana", top_k=10)
        doc_ids = {doc.metadata["doc_id"] for doc in hits}

        assert self.doc_apple_id in doc_ids, "Document with 'apple' should be found in multi-keyword search"
        assert self.doc_banana_id in doc_ids, "Document with 'banana' should be found in multi-keyword search"
        assert self.doc_both_id in doc_ids, "Document with both keywords should be found"
        # Expect 3 results: doc_apple (apple only), doc_banana (banana only), doc_both (contains both)
        assert len(hits) == 3, f"Expected 3 documents, got {len(hits)}"

        # Test keyword order independence
        hits_ba = self.vector.search_by_full_text(query="banana apple", top_k=10)
        ids_ba = {doc.metadata["doc_id"] for doc in hits_ba}
        assert doc_ids == ids_ba, "Keyword order should not affect search results"

        # Test no duplicates in results
        doc_id_list = [doc.metadata["doc_id"] for doc in hits]
        assert len(doc_id_list) == len(set(doc_id_list)), "Search results should not contain duplicates"

    def run_all_tests(self):
        self.create_vector()
        self.search_by_vector()
        self.search_by_full_text()
        self.text_exists()
        self.get_ids_by_metadata_field()
        # Multi-keyword search tests
        self.setup_multi_keyword_documents()
        self.search_by_full_text_multi_keyword()
        # Cleanup - delete_vector() removes the entire collection
        self.delete_vector()


def test_qdrant_vector(setup_mock_redis):
    QdrantVectorTest().run_all_tests()
