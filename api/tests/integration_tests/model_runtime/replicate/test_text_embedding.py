import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.replicate.text_embedding.text_embedding import ReplicateEmbeddingModel


def test_validate_credentials_one():
    model = ReplicateEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="replicate/all-mpnet-base-v2",
            credentials={
                "replicate_api_token": "invalid_key",
                "model_version": "b6b7585c9640cd7a9572c6e129c9549d79c9c31f0d3fdce7baac7c67ca38f305",
            },
        )

    model.validate_credentials(
        model="replicate/all-mpnet-base-v2",
        credentials={
            "replicate_api_token": os.environ.get("REPLICATE_API_KEY"),
            "model_version": "b6b7585c9640cd7a9572c6e129c9549d79c9c31f0d3fdce7baac7c67ca38f305",
        },
    )


def test_validate_credentials_two():
    model = ReplicateEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="nateraw/bge-large-en-v1.5",
            credentials={
                "replicate_api_token": "invalid_key",
                "model_version": "9cf9f015a9cb9c61d1a2610659cdac4a4ca222f2d3707a68517b18c198a9add1",
            },
        )

    model.validate_credentials(
        model="nateraw/bge-large-en-v1.5",
        credentials={
            "replicate_api_token": os.environ.get("REPLICATE_API_KEY"),
            "model_version": "9cf9f015a9cb9c61d1a2610659cdac4a4ca222f2d3707a68517b18c198a9add1",
        },
    )


def test_invoke_model_one():
    model = ReplicateEmbeddingModel()

    result = model.invoke(
        model="nateraw/bge-large-en-v1.5",
        credentials={
            "replicate_api_token": os.environ.get("REPLICATE_API_KEY"),
            "model_version": "9cf9f015a9cb9c61d1a2610659cdac4a4ca222f2d3707a68517b18c198a9add1",
        },
        texts=["hello", "world"],
        user="abc-123",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens == 2


def test_invoke_model_two():
    model = ReplicateEmbeddingModel()

    result = model.invoke(
        model="andreasjansson/clip-features",
        credentials={
            "replicate_api_token": os.environ.get("REPLICATE_API_KEY"),
            "model_version": "75b33f253f7714a281ad3e9b28f63e3232d583716ef6718f2e46641077ea040a",
        },
        texts=["hello", "world"],
        user="abc-123",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens == 2


def test_invoke_model_three():
    model = ReplicateEmbeddingModel()

    result = model.invoke(
        model="replicate/all-mpnet-base-v2",
        credentials={
            "replicate_api_token": os.environ.get("REPLICATE_API_KEY"),
            "model_version": "b6b7585c9640cd7a9572c6e129c9549d79c9c31f0d3fdce7baac7c67ca38f305",
        },
        texts=["hello", "world"],
        user="abc-123",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens == 2


def test_invoke_model_four():
    model = ReplicateEmbeddingModel()

    result = model.invoke(
        model="nateraw/jina-embeddings-v2-base-en",
        credentials={
            "replicate_api_token": os.environ.get("REPLICATE_API_KEY"),
            "model_version": "f8367a1c072ba2bc28af549d1faeacfe9b88b3f0e475add7a75091dac507f79e",
        },
        texts=["hello", "world"],
        user="abc-123",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens == 2


def test_get_num_tokens():
    model = ReplicateEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model="nateraw/jina-embeddings-v2-base-en",
        credentials={
            "replicate_api_token": os.environ.get("REPLICATE_API_KEY"),
            "model_version": "f8367a1c072ba2bc28af549d1faeacfe9b88b3f0e475add7a75091dac507f79e",
        },
        texts=["hello", "world"],
    )

    assert num_tokens == 2
