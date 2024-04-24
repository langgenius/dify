import uuid

from core.rag.datasource.vdb.qdrant.qdrant_vector import QdrantConfig, QdrantVector
from models.dataset import Dataset
from tests.integration_tests.vdb.test_vector_store import (
    get_sample_document,
    get_sample_embedding,
    get_sample_query_vector,
    get_sample_text,
    setup_mock_redis,
)


def test_qdrant_vector(setup_mock_redis)-> None:
    dataset_id = str(uuid.uuid4())
    vector = QdrantVector(
        collection_name=Dataset.gen_collection_name_by_id(dataset_id),
        group_id=dataset_id,
        config=QdrantConfig(
            endpoint='http://localhost:6333',
            api_key='difyai123456',
        )
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
