import os

import pytest

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.huggingface_tei.text_embedding.text_embedding import (
    HuggingfaceTeiTextEmbeddingModel,
    TeiHelper,
)
from tests.integration_tests.model_runtime.__mock.huggingface_tei import MockTEIClass

MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_tei_mock(request, monkeypatch: pytest.MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(TeiHelper, "get_tei_extra_parameter", MockTEIClass.get_tei_extra_parameter)
        monkeypatch.setattr(TeiHelper, "invoke_tokenize", MockTEIClass.invoke_tokenize)
        monkeypatch.setattr(TeiHelper, "invoke_embeddings", MockTEIClass.invoke_embeddings)
        monkeypatch.setattr(TeiHelper, "invoke_rerank", MockTEIClass.invoke_rerank)
    yield

    if MOCK:
        monkeypatch.undo()


@pytest.mark.parametrize("setup_tei_mock", [["none"]], indirect=True)
def test_validate_credentials(setup_tei_mock):
    model = HuggingfaceTeiTextEmbeddingModel()
    # model name is only used in mock
    model_name = "embedding"

    if MOCK:
        # TEI Provider will check model type by API endpoint, at real server, the model type is correct.
        # So we dont need to check model type here. Only check in mock
        with pytest.raises(CredentialsValidateFailedError):
            model.validate_credentials(
                model="reranker",
                credentials={
                    "server_url": os.environ.get("TEI_EMBEDDING_SERVER_URL", ""),
                    "api_key": os.environ.get("TEI_API_KEY", ""),
                },
            )

    model.validate_credentials(
        model=model_name,
        credentials={
            "server_url": os.environ.get("TEI_EMBEDDING_SERVER_URL", ""),
            "api_key": os.environ.get("TEI_API_KEY", ""),
        },
    )


@pytest.mark.parametrize("setup_tei_mock", [["none"]], indirect=True)
def test_invoke_model(setup_tei_mock):
    model = HuggingfaceTeiTextEmbeddingModel()
    model_name = "embedding"

    result = model.invoke(
        model=model_name,
        credentials={
            "server_url": os.environ.get("TEI_EMBEDDING_SERVER_URL", ""),
            "api_key": os.environ.get("TEI_API_KEY", ""),
        },
        texts=["hello", "world"],
        user="abc-123",
    )

    assert isinstance(result, TextEmbeddingResult)
    assert len(result.embeddings) == 2
    assert result.usage.total_tokens > 0
