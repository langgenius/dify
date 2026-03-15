from unittest.mock import MagicMock

import pytest

from dify_graph.model_runtime.entities.common_entities import I18nObject
from dify_graph.model_runtime.entities.model_entities import ModelType
from dify_graph.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from dify_graph.model_runtime.entities.rerank_entities import RerankDocument, RerankResult
from dify_graph.model_runtime.errors.invoke import InvokeError
from dify_graph.model_runtime.model_providers.__base.rerank_model import RerankModel


@pytest.fixture
def provider_schema() -> ProviderEntity:
    return ProviderEntity(
        provider="test_provider",
        label=I18nObject(en_US="test_provider"),
        supported_model_types=[ModelType.RERANK],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
    )


@pytest.fixture
def model_runtime() -> MagicMock:
    return MagicMock()


@pytest.fixture
def rerank_model(provider_schema: ProviderEntity, model_runtime: MagicMock) -> RerankModel:
    return RerankModel(provider_schema=provider_schema, model_runtime=model_runtime)


def test_model_type_is_rerank_by_default(rerank_model: RerankModel) -> None:
    assert rerank_model.model_type == ModelType.RERANK


def test_invoke_calls_runtime_and_passes_args(rerank_model: RerankModel, model_runtime: MagicMock) -> None:
    expected = RerankResult(model="rerank", docs=[RerankDocument(index=0, text="a", score=0.5)])
    model_runtime.invoke_rerank.return_value = expected

    result = rerank_model.invoke(
        model="rerank",
        credentials={"k": "v"},
        query="q",
        docs=["d1", "d2"],
        score_threshold=0.2,
        top_n=10,
    )

    assert result == expected
    model_runtime.invoke_rerank.assert_called_once_with(
        provider="test_provider",
        model="rerank",
        credentials={"k": "v"},
        query="q",
        docs=["d1", "d2"],
        score_threshold=0.2,
        top_n=10,
    )


def test_invoke_transforms_and_raises_on_runtime_error(rerank_model: RerankModel, model_runtime: MagicMock) -> None:
    model_runtime.invoke_rerank.side_effect = Exception("runtime down")

    with pytest.raises(InvokeError, match="runtime down"):
        rerank_model.invoke(model="m", credentials={}, query="q", docs=["d"])


def test_invoke_multimodal_calls_runtime_and_passes_args(rerank_model: RerankModel, model_runtime: MagicMock) -> None:
    expected = RerankResult(model="mm", docs=[RerankDocument(index=0, text="x", score=0.9)])
    model_runtime.invoke_multimodal_rerank.return_value = expected

    query = {"type": "text", "text": "q"}
    docs = [{"type": "text", "text": "d1"}]
    result = rerank_model.invoke_multimodal_rerank(
        model="mm",
        credentials={"k": "v"},
        query=query,
        docs=docs,
        score_threshold=None,
        top_n=None,
    )

    assert result == expected
    model_runtime.invoke_multimodal_rerank.assert_called_once_with(
        provider="test_provider",
        model="mm",
        credentials={"k": "v"},
        query=query,
        docs=docs,
        score_threshold=None,
        top_n=None,
    )
