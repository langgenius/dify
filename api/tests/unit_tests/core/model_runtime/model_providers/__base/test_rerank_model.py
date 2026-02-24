from datetime import datetime
from typing import Any
from unittest.mock import MagicMock

import pytest

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.rerank_entities import RerankDocument, RerankResult
from core.model_runtime.model_providers.__base.rerank_model import RerankModel
from core.plugin.entities.plugin_daemon import PluginModelProviderEntity


@pytest.fixture
def rerank_model() -> RerankModel:
    plugin_provider = PluginModelProviderEntity.model_construct(
        id="provider-id",
        created_at=datetime.now(),
        updated_at=datetime.now(),
        provider="provider",
        tenant_id="tenant",
        plugin_unique_identifier="plugin-uid",
        plugin_id="plugin-id",
        declaration=MagicMock(),
    )
    return RerankModel.model_construct(
        tenant_id="tenant",
        model_type=ModelType.RERANK,
        plugin_id="plugin-id",
        provider_name="provider",
        plugin_model_provider=plugin_provider,
    )


def test_model_type_is_rerank_by_default() -> None:
    plugin_provider = PluginModelProviderEntity.model_construct(
        id="provider-id",
        created_at=datetime.now(),
        updated_at=datetime.now(),
        provider="provider",
        tenant_id="tenant",
        plugin_unique_identifier="plugin-uid",
        plugin_id="plugin-id",
        declaration=MagicMock(),
    )
    model = RerankModel(
        tenant_id="tenant",
        plugin_id="plugin-id",
        provider_name="provider",
        plugin_model_provider=plugin_provider,
    )
    assert model.model_type == ModelType.RERANK


def test_invoke_calls_plugin_and_passes_args(rerank_model: RerankModel, monkeypatch: pytest.MonkeyPatch) -> None:
    expected = RerankResult(model="rerank", docs=[RerankDocument(index=0, text="a", score=0.5)])

    class FakePluginModelClient:
        def __init__(self) -> None:
            self.invoke_rerank_called_with: dict[str, Any] | None = None

        def invoke_rerank(self, **kwargs: Any) -> RerankResult:
            self.invoke_rerank_called_with = kwargs
            return expected

    import core.plugin.impl.model as plugin_model_module

    fake_client = FakePluginModelClient()
    monkeypatch.setattr(plugin_model_module, "PluginModelClient", lambda: fake_client)

    result = rerank_model.invoke(
        model="rerank",
        credentials={"k": "v"},
        query="q",
        docs=["d1", "d2"],
        score_threshold=0.2,
        top_n=10,
        user="user-1",
    )

    assert result == expected
    assert fake_client.invoke_rerank_called_with == {
        "tenant_id": "tenant",
        "user_id": "user-1",
        "plugin_id": "plugin-id",
        "provider": "provider",
        "model": "rerank",
        "credentials": {"k": "v"},
        "query": "q",
        "docs": ["d1", "d2"],
        "score_threshold": 0.2,
        "top_n": 10,
    }


def test_invoke_uses_unknown_user_when_not_provided(rerank_model: RerankModel, monkeypatch: pytest.MonkeyPatch) -> None:
    class FakePluginModelClient:
        def __init__(self) -> None:
            self.kwargs: dict[str, Any] | None = None

        def invoke_rerank(self, **kwargs: Any) -> RerankResult:
            self.kwargs = kwargs
            return RerankResult(model="m", docs=[])

    import core.plugin.impl.model as plugin_model_module

    fake_client = FakePluginModelClient()
    monkeypatch.setattr(plugin_model_module, "PluginModelClient", lambda: fake_client)

    rerank_model.invoke(model="m", credentials={}, query="q", docs=["d"])
    assert fake_client.kwargs is not None
    assert fake_client.kwargs["user_id"] == "unknown"


def test_invoke_transforms_and_raises_on_plugin_error(
    rerank_model: RerankModel, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakePluginModelClient:
        def invoke_rerank(self, **_: Any) -> RerankResult:
            raise ValueError("plugin down")

    import core.plugin.impl.model as plugin_model_module

    monkeypatch.setattr(plugin_model_module, "PluginModelClient", FakePluginModelClient)
    monkeypatch.setattr(rerank_model, "_transform_invoke_error", lambda e: RuntimeError(f"transformed: {e}"))

    with pytest.raises(RuntimeError, match="transformed: plugin down"):
        rerank_model.invoke(model="m", credentials={}, query="q", docs=["d"])


def test_invoke_multimodal_calls_plugin_and_passes_args(
    rerank_model: RerankModel, monkeypatch: pytest.MonkeyPatch
) -> None:
    expected = RerankResult(model="mm", docs=[RerankDocument(index=0, text="x", score=0.9)])

    class FakePluginModelClient:
        def __init__(self) -> None:
            self.invoke_multimodal_rerank_called_with: dict[str, Any] | None = None

        def invoke_multimodal_rerank(self, **kwargs: Any) -> RerankResult:
            self.invoke_multimodal_rerank_called_with = kwargs
            return expected

    import core.plugin.impl.model as plugin_model_module

    fake_client = FakePluginModelClient()
    monkeypatch.setattr(plugin_model_module, "PluginModelClient", lambda: fake_client)

    query = {"type": "text", "text": "q"}
    docs = [{"type": "text", "text": "d1"}]
    result = rerank_model.invoke_multimodal_rerank(
        model="mm",
        credentials={"k": "v"},
        query=query,
        docs=docs,
        score_threshold=None,
        top_n=None,
        user=None,
    )

    assert result == expected
    assert fake_client.invoke_multimodal_rerank_called_with is not None
    assert fake_client.invoke_multimodal_rerank_called_with["tenant_id"] == "tenant"
    assert fake_client.invoke_multimodal_rerank_called_with["user_id"] == "unknown"
    assert fake_client.invoke_multimodal_rerank_called_with["query"] == query
    assert fake_client.invoke_multimodal_rerank_called_with["docs"] == docs


def test_invoke_multimodal_transforms_and_raises_on_plugin_error(
    rerank_model: RerankModel, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakePluginModelClient:
        def invoke_multimodal_rerank(self, **_: Any) -> RerankResult:
            raise ValueError("plugin down")

    import core.plugin.impl.model as plugin_model_module

    monkeypatch.setattr(plugin_model_module, "PluginModelClient", FakePluginModelClient)
    monkeypatch.setattr(rerank_model, "_transform_invoke_error", lambda e: RuntimeError(f"transformed: {e}"))

    with pytest.raises(RuntimeError, match="transformed: plugin down"):
        rerank_model.invoke_multimodal_rerank(model="m", credentials={}, query={"q": 1}, docs=[{"d": 1}])
