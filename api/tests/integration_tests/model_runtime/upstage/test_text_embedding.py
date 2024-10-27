import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.upstage.text_embedding.text_embedding import UpstageTextEmbeddingModel
from tests.integration_tests.model_runtime.__mock.openai import setup_openai_mock


@pytest.mark.parametrize("setup_openai_mock", [["text_embedding"]], indirect=True)
def test_validate_credentials(setup_openai_mock):
    model = UpstageTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="solar-embedding-1-large-passage", credentials={"upstage_api_key": "invalid_key"}
        )

    model.validate_credentials(
        model="solar-embedding-1-large-passage", credentials={"upstage_api_key": os.environ.get("UPSTAGE_API_KEY")}
    )


@pytest.mark.parametrize("setup_openai_mock", [["text_embedding"]], indirect=True)
def test_invoke_model(setup_openai_mock):
    model = UpstageTextEmbeddingModel()

    result = model.invoke(
        model="solar-embedding-1-large-passage",
        credentials={
            "upstage_api_key": os.environ.get("UPSTAGE_API_KEY"),
        },
        texts=["hello", "world", " ".join(["long_text"] * 100), " ".join(["another_long_text"] * 100)],
        user="abc-123",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 4
    assert result.usage.total_tokens == 2


def test_get_num_tokens():
    model = UpstageTextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model="solar-embedding-1-large-passage",
        credentials={
            "upstage_api_key": os.environ.get("UPSTAGE_API_KEY"),
        },
        texts=["hello", "world"],
    )

    assert num_tokens == 5
