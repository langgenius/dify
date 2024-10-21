import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.oci.text_embedding.text_embedding import OCITextEmbeddingModel


def test_validate_credentials():
    model = OCITextEmbeddingModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="cohere.embed-multilingual-v3.0",
            credentials={"oci_config_content": "invalid_key", "oci_key_content": "invalid_key"},
        )

    model.validate_credentials(
        model="cohere.embed-multilingual-v3.0",
        credentials={
            "oci_config_content": os.environ.get("OCI_CONFIG_CONTENT"),
            "oci_key_content": os.environ.get("OCI_KEY_CONTENT"),
        },
    )


def test_invoke_model():
    model = OCITextEmbeddingModel()

    result = model.invoke(
        model="cohere.embed-multilingual-v3.0",
        credentials={
            "oci_config_content": os.environ.get("OCI_CONFIG_CONTENT"),
            "oci_key_content": os.environ.get("OCI_KEY_CONTENT"),
        },
        texts=["hello", "world", " ".join(["long_text"] * 100), " ".join(["another_long_text"] * 100)],
        user="abc-123",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 4
    # assert result.usage.total_tokens == 811


def test_get_num_tokens():
    model = OCITextEmbeddingModel()

    num_tokens = model.get_num_tokens(
        model="cohere.embed-multilingual-v3.0",
        credentials={
            "oci_config_content": os.environ.get("OCI_CONFIG_CONTENT"),
            "oci_key_content": os.environ.get("OCI_KEY_CONTENT"),
        },
        texts=["hello", "world"],
    )

    assert num_tokens == 2
