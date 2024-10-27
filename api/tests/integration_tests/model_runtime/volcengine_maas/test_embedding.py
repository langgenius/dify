import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.volcengine_maas.text_embedding.text_embedding import (
    VolcengineMaaSTextEmbeddingModel,
)


def test_validate_credentials():
    model = VolcengineMaaSTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="NOT IMPORTANT",
            credentials={
                "api_endpoint_host": "maas-api.ml-platform-cn-beijing.volces.com",
                "volc_region": "cn-beijing",
                "volc_access_key_id": "INVALID",
                "volc_secret_access_key": "INVALID",
                "endpoint_id": "INVALID",
                "base_model_name": "Doubao-embedding",
            },
        )

    model.validate_credentials(
        model="NOT IMPORTANT",
        credentials={
            "api_endpoint_host": "maas-api.ml-platform-cn-beijing.volces.com",
            "volc_region": "cn-beijing",
            "volc_access_key_id": os.environ.get("VOLC_API_KEY"),
            "volc_secret_access_key": os.environ.get("VOLC_SECRET_KEY"),
            "endpoint_id": os.environ.get("VOLC_EMBEDDING_ENDPOINT_ID"),
            "base_model_name": "Doubao-embedding",
        },
    )


def test_invoke_model():
    model = VolcengineMaaSTextEmbeddingModel()

    result = model.invoke(
        model="NOT IMPORTANT",
        credentials={
            "api_endpoint_host": "maas-api.ml-platform-cn-beijing.volces.com",
            "volc_region": "cn-beijing",
            "volc_access_key_id": os.environ.get("VOLC_API_KEY"),
            "volc_secret_access_key": os.environ.get("VOLC_SECRET_KEY"),
            "endpoint_id": os.environ.get("VOLC_EMBEDDING_ENDPOINT_ID"),
            "base_model_name": "Doubao-embedding",
        },
        texts=["hello", "world"],
        user="abc-123",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens > 0


def test_get_num_tokens():
    model = VolcengineMaaSTextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model="NOT IMPORTANT",
        credentials={
            "api_endpoint_host": "maas-api.ml-platform-cn-beijing.volces.com",
            "volc_region": "cn-beijing",
            "volc_access_key_id": os.environ.get("VOLC_API_KEY"),
            "volc_secret_access_key": os.environ.get("VOLC_SECRET_KEY"),
            "endpoint_id": os.environ.get("VOLC_EMBEDDING_ENDPOINT_ID"),
            "base_model_name": "Doubao-embedding",
        },
        texts=["hello", "world"],
    )

    assert num_tokens == 2
