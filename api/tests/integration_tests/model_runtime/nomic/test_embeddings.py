import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.nomic.text_embedding.text_embedding import NomicTextEmbeddingModel
from tests.integration_tests.model_runtime.__mock.nomic_embeddings import setup_nomic_mock


@pytest.mark.parametrize("setup_nomic_mock", [["text_embedding"]], indirect=True)
def test_validate_credentials(setup_nomic_mock):
    model = NomicTextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="nomic-embed-text-v1.5",
            credentials={
                "nomic_api_key": "invalid_key",
            },
        )

    model.validate_credentials(
        model="nomic-embed-text-v1.5",
        credentials={
            "nomic_api_key": os.environ.get("NOMIC_API_KEY"),
        },
    )


@pytest.mark.parametrize("setup_nomic_mock", [["text_embedding"]], indirect=True)
def test_invoke_model(setup_nomic_mock):
    model = NomicTextEmbeddingModel()

    result = model.invoke(
        model="nomic-embed-text-v1.5",
        credentials={
            "nomic_api_key": os.environ.get("NOMIC_API_KEY"),
        },
        texts=["hello", "world"],
        user="foo",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert result.model == "nomic-embed-text-v1.5"
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens == 2


@pytest.mark.parametrize("setup_nomic_mock", [["text_embedding"]], indirect=True)
def test_get_num_tokens(setup_nomic_mock):
    model = NomicTextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model="nomic-embed-text-v1.5",
        credentials={
            "nomic_api_key": os.environ.get("NOMIC_API_KEY"),
        },
        texts=["hello", "world"],
    )

    assert num_tokens == 2
