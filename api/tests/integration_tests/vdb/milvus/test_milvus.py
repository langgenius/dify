import uuid

from core.rag.datasource.vdb.milvus.milvus_vector import MilvusConfig, MilvusVector
from models.dataset import Dataset
from tests.integration_tests.vdb.test_vector_store import (
    get_sample_document,
    get_sample_embedding,
    get_sample_query_vector,
    setup_mock_redis,
)


def test_milvus_vector(setup_mock_redis) -> None:
    dataset_id = str(uuid.uuid4())
    vector = MilvusVector(
        collection_name=Dataset.gen_collection_name_by_id(dataset_id),
        config=MilvusConfig(
            host='localhost',
            port=19530,
            user='root',
            password='Milvus',
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

    # milvus dos not support full text searching yet in < 2.3.x

    # delete vector
    vector.delete()
