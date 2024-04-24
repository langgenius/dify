import uuid

import pytest
from pydantic.error_wrappers import ValidationError

from core.rag.datasource.vdb.milvus.milvus_vector import MilvusConfig, MilvusVector
from models.dataset import Dataset
from tests.integration_tests.vdb.test_vector_store import (
    get_sample_document,
    get_sample_embedding,
    get_sample_query_vector,
    setup_mock_redis,
)


def test_default_value():
    valid_config = {
        'host': 'localhost',
        'port': 19530,
        'user': 'root',
        'password': 'Milvus'
    }

    for key in valid_config:
        config = valid_config.copy()
        del config[key]
        with pytest.raises(ValidationError) as e:
            MilvusConfig(**config)
        assert e.value.errors()[1]['msg'] == f'config MILVUS_{key.upper()} is required'

    config = MilvusConfig(**valid_config)
    assert config.secure is False
    assert config.database == 'default'


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
