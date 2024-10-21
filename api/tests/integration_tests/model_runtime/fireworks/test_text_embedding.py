import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.fireworks.text_embedding.text_embedding import FireworksTextEmbeddingModel
from tests.integration_tests.model_runtime.__mock.openai import setup_openai_mock


@pytest.mark.parametrize("setup_openai_mock", [["text_embedding"]], indirect=True)
def test_validate_credentials(setup_openai_mock):
    model = FireworksTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="nomic-ai/nomic-embed-text-v1.5", credentials={"fireworks_api_key": "invalid_key"}
        )

    model.validate_credentials(
        model="nomic-ai/nomic-embed-text-v1.5", credentials={"fireworks_api_key": os.environ.get("FIREWORKS_API_KEY")}
    )


@pytest.mark.parametrize("setup_openai_mock", [["text_embedding"]], indirect=True)
def test_invoke_model(setup_openai_mock):
    model = FireworksTextEmbeddingModel()

    result = model.invoke(
        model="nomic-ai/nomic-embed-text-v1.5",
        credentials={
            "fireworks_api_key": os.environ.get("FIREWORKS_API_KEY"),
        },
        texts=["hello", "world", " ".join(["long_text"] * 100), " ".join(["another_long_text"] * 100)],
        user="foo",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 4
    assert result.usage.total_tokens == 2


def test_get_num_tokens():
    model = FireworksTextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model="nomic-ai/nomic-embed-text-v1.5",
        credentials={
            "fireworks_api_key": os.environ.get("FIREWORKS_API_KEY"),
        },
        texts=["hello", "world"],
    )

    assert num_tokens == 2
