import uuid

from core.rag.datasource.vdb.weaviate.weaviate_vector import WeaviateConfig, WeaviateVector
from models.dataset import Dataset
from tests.integration_tests.vdb.test_vector_store import (
    get_sample_document,
    get_sample_embedding,
    get_sample_query_vector,
    get_sample_text,
    setup_mock_redis,
)


def test_weaviate_vector(setup_mock_redis) -> None:
    attributes = ['doc_id', 'dataset_id', 'document_id', 'doc_hash']
    dataset_id = str(uuid.uuid4())
    vector = WeaviateVector(
        collection_name=Dataset.gen_collection_name_by_id(dataset_id),
        config=WeaviateConfig(
            endpoint='http://localhost:8080',
            api_key='WVF5YThaHlkYwhGUSmCRgsX3tD5ngdN8pkih',
        ),
        attributes=attributes
    )

    # create vector
    vector.create(
        texts=[get_sample_document(dataset_id)],
        embeddings=[get_sample_embedding()],
    )

    # search by vector
    hits_by_vector = vector.search_by_vector(query_vector=get_sample_query_vector())
    assert len(hits_by_vector) >= 1

    # search by full text
    hits_by_full_text = vector.search_by_full_text(query=get_sample_text())
    assert len(hits_by_full_text) >= 1

    # delete vector
    vector.delete()
