import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.lindormai.text_embedding.text_embedding import LindormAITextEmbeddingModel


def test_validate_credentials():
    model = LindormAITextEmbeddingModel()
    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="bge_model",
            credentials={
                "lindormai_endpoint": os.environ.get("AI_ENDPOINT"),
                "lindormai_username": os.environ.get("AI_USERNAME"),
                "lindormai_password": os.environ.get("AI_PASSWORD"),
            },
        )

    model.validate_credentials(
        model="bge_m3_model",
        credentials={
            "lindormai_endpoint": os.environ.get("AI_ENDPOINT"),
            "lindormai_username": os.environ.get("AI_USERNAME"),
            "lindormai_password": os.environ.get("AI_PASSWORD"),
        },
    )


def test_invoke_embedding():
    model = LindormAITextEmbeddingModel()
    response = model.invoke(
        model="bge_m3_model",
        credentials={
            "lindormai_endpoint": os.environ.get("AI_ENDPOINT"),
            "lindormai_username": os.environ.get("AI_USERNAME"),
            "lindormai_password": os.environ.get("AI_PASSWORD"),
        },
        texts=["morning", "你好", "@29090"],
    )
    assert isinstance(response, TextEmbeddingResult)
    assert len(response.embeddings) == 3
    assert isinstance(response.embeddings[0], list)
