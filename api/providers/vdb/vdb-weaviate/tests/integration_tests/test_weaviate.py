import uuid

from dify_vdb_weaviate.weaviate_vector import WeaviateConfig, WeaviateVector

from core.rag.datasource.vdb.vector_integration_test_support import (
    AbstractVectorTest,
)
from core.rag.models.document import Document


class WeaviateVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.attributes = ["doc_id", "dataset_id", "document_id", "doc_hash"]
        self.vector = WeaviateVector(
            collection_name=self.collection_name,
            config=WeaviateConfig(
                endpoint="http://localhost:8080",
                api_key="WVF5YThaHlkYwhGUSmCRgsX3tD5ngdN8pkih",
            ),
            attributes=self.attributes,
        )


def test_weaviate_vector(setup_mock_redis):
    WeaviateVectorTest().run_all_tests()


def test_weaviate_delete_by_metadata_field_refreshes_same_doc_id(setup_mock_redis):
    vector_test = WeaviateVectorTest()
    doc_id = str(uuid.uuid4())
    old_document = Document(
        page_content="stale child chunk content",
        metadata={
            "doc_id": doc_id,
            "doc_hash": "old-hash",
            "document_id": "document-1",
            "dataset_id": vector_test.dataset_id,
        },
    )
    updated_document = Document(
        page_content="fresh child chunk content",
        metadata={
            "doc_id": doc_id,
            "doc_hash": "new-hash",
            "document_id": "document-1",
            "dataset_id": vector_test.dataset_id,
        },
    )

    try:
        vector_test.vector.create(texts=[old_document], embeddings=[vector_test.example_embedding])
        assert vector_test.vector.text_exists(doc_id)

        vector_test.vector.delete_by_metadata_field("doc_id", doc_id)
        assert not vector_test.vector.text_exists(doc_id)

        vector_test.vector.add_texts(documents=[updated_document], embeddings=[vector_test.example_embedding])
        hits = vector_test.vector.search_by_full_text(query="fresh child chunk content")

        matching_hits = [hit for hit in hits if hit.metadata["doc_id"] == doc_id]
        assert matching_hits
        assert matching_hits[0].page_content == "fresh child chunk content"
        assert matching_hits[0].metadata["doc_hash"] == "new-hash"
    finally:
        vector_test.delete_vector()


def test_weaviate_child_chunk_refresh_preserves_other_doc_with_same_content(setup_mock_redis):
    vector_test = WeaviateVectorTest()
    target_doc_id = str(uuid.uuid4())
    other_doc_id = str(uuid.uuid4())
    shared_content = "shared updated child chunk content"
    old_document = Document(
        page_content="stale child chunk content before refresh",
        metadata={
            "doc_id": target_doc_id,
            "doc_hash": "old-target-hash",
            "document_id": "document-1",
            "dataset_id": vector_test.dataset_id,
        },
    )
    other_document = Document(
        page_content=shared_content,
        metadata={
            "doc_id": other_doc_id,
            "doc_hash": "other-hash",
            "document_id": "document-2",
            "dataset_id": vector_test.dataset_id,
        },
    )
    updated_document = Document(
        page_content=shared_content,
        metadata={
            "doc_id": target_doc_id,
            "doc_hash": "new-target-hash",
            "document_id": "document-1",
            "dataset_id": vector_test.dataset_id,
        },
    )

    try:
        vector_test.vector.create(
            texts=[old_document, other_document],
            embeddings=[vector_test.example_embedding, vector_test.example_embedding],
        )
        assert vector_test.vector.text_exists(target_doc_id)
        assert vector_test.vector.text_exists(other_doc_id)

        vector_test.vector.delete_by_metadata_field("doc_id", target_doc_id)
        assert not vector_test.vector.text_exists(target_doc_id)
        assert vector_test.vector.text_exists(other_doc_id)

        vector_test.vector.add_texts(documents=[updated_document], embeddings=[vector_test.example_embedding])

        assert vector_test.vector.text_exists(target_doc_id)
        assert vector_test.vector.text_exists(other_doc_id)
        hits_by_doc_id = {
            hit.metadata["doc_id"]: hit for hit in vector_test.vector.search_by_full_text(query=shared_content)
        }
        assert hits_by_doc_id[target_doc_id].metadata["doc_hash"] == "new-target-hash"
        assert hits_by_doc_id[other_doc_id].metadata["doc_hash"] == "other-hash"
    finally:
        vector_test.delete_vector()
