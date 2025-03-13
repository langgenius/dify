import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.gitee_ai.text_embedding.text_embedding import GiteeAIEmbeddingModel


def test_validate_credentials():
    model = GiteeAIEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(model="bge-large-zh-v1.5", credentials={"api_key": "invalid_key"})

    model.validate_credentials(model="bge-large-zh-v1.5", credentials={"api_key": os.environ.get("GITEE_AI_API_KEY")})


def test_invoke_model():
    model = GiteeAIEmbeddingModel()

    result = model.invoke(
        model="bge-large-zh-v1.5",
        credentials={
            "api_key": os.environ.get("GITEE_AI_API_KEY"),
        },
        texts=["hello", "world"],
        user="user",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2


def test_get_num_tokens():
    model = GiteeAIEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model="bge-large-zh-v1.5",
        credentials={
            "api_key": os.environ.get("GITEE_AI_API_KEY"),
        },
        texts=["hello", "world"],
    )

    assert num_tokens == 2
