import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.openai.text_embedding.text_embedding import OpenAITextEmbeddingModel
from tests.integration_tests.model_runtime.__mock.openai import setup_openai_mock


@pytest.mark.parametrize("setup_openai_mock", [["text_embedding"]], indirect=True)
def test_validate_credentials(setup_openai_mock):
    model = OpenAITextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(model="text-embedding-ada-002", credentials={"openai_api_key": "invalid_key"})

    model.validate_credentials(
        model="text-embedding-ada-002", credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")}
    )


@pytest.mark.parametrize("setup_openai_mock", [["text_embedding"]], indirect=True)
def test_invoke_model(setup_openai_mock):
    model = OpenAITextEmbeddingModel()

    result = model.invoke(
        model="text-embedding-ada-002",
        credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY"), "openai_api_base": "https://api.openai.com"},
        texts=["hello", "world", " ".join(["long_text"] * 100), " ".join(["another_long_text"] * 100)],
        user="abc-123",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 4
    assert result.usage.total_tokens == 2


def test_get_num_tokens():
    model = OpenAITextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model="text-embedding-ada-002",
        credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY"), "openai_api_base": "https://api.openai.com"},
        texts=["hello", "world"],
    )

    assert num_tokens == 2
