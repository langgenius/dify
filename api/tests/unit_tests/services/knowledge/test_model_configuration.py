from dataclasses import dataclass
from typing import cast

import pytest

from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelInstance, ModelManager
from graphon.model_runtime.entities.model_entities import ModelFeature, ModelType
from services.knowledge.datasets.model_configuration import KnowledgeModelConfigurationGateway
from services.knowledge.entities.model_configuration import DatasetModelConfiguration


@dataclass(frozen=True)
class _Schema:
    features: list[ModelFeature] | None


class _ModelInstance:
    def __init__(self, *, provider: str = "canonical/provider", model: str = "embedding", vision: bool = False) -> None:
        self.provider = provider
        self.model_name = model
        self._schema = _Schema([ModelFeature.VISION] if vision else [])

    def get_model_schema(self) -> _Schema:
        return self._schema


class _ModelManager:
    def __init__(self, *, instance: _ModelInstance | None = None, error: Exception | None = None) -> None:
        self.instance = instance or _ModelInstance()
        self.error = error
        self.calls: list[tuple[str, str, ModelType, str]] = []

    def get_model_instance(self, tenant_id: str, provider: str, model_type: ModelType, model: str) -> ModelInstance:
        self.calls.append((tenant_id, provider, model_type, model))
        if self.error is not None:
            raise self.error
        return cast(ModelInstance, self.instance)

    def get_default_model_instance(self, tenant_id: str, model_type: ModelType) -> ModelInstance:
        self.calls.append((tenant_id, "", model_type, ""))
        if self.error is not None:
            raise self.error
        return cast(ModelInstance, self.instance)


def _install_manager(monkeypatch: pytest.MonkeyPatch, manager: _ModelManager) -> None:
    def for_tenant(cls: type[ModelManager], tenant_id: str) -> ModelManager:
        del cls, tenant_id
        return cast(ModelManager, manager)

    monkeypatch.setattr(ModelManager, "for_tenant", classmethod(for_tenant))


def test_resolve_embedding_model_returns_canonical_runtime_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = _ModelManager(instance=_ModelInstance(provider="canonical/provider", model="embedding-v2", vision=True))
    _install_manager(monkeypatch, manager)

    configuration = KnowledgeModelConfigurationGateway().resolve_embedding_model(
        tenant_id="tenant", provider="provider-alias", model="embedding-v2"
    )

    assert configuration.provider == "canonical/provider"
    assert configuration.model == "embedding-v2"
    assert configuration.supports_vision is True
    assert manager.calls == [("tenant", "provider-alias", ModelType.TEXT_EMBEDDING, "embedding-v2")]


def test_resolve_default_embedding_model_uses_same_runtime_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = _ModelManager(instance=_ModelInstance(vision=False))
    _install_manager(monkeypatch, manager)

    configuration = KnowledgeModelConfigurationGateway().resolve_default_embedding_model(tenant_id="tenant")

    assert configuration.provider == "canonical/provider"
    assert configuration.model == "embedding"
    assert configuration.supports_vision is False
    assert manager.calls == [("tenant", "", ModelType.TEXT_EMBEDDING, "")]


def test_resolve_default_embedding_model_preserves_raw_provider_error(monkeypatch: pytest.MonkeyPatch) -> None:
    error = ProviderTokenNotInitError("provider setup required")
    _install_manager(monkeypatch, _ModelManager(error=error))

    with pytest.raises(ProviderTokenNotInitError) as exc_info:
        KnowledgeModelConfigurationGateway().resolve_default_embedding_model(tenant_id="tenant")

    assert exc_info.value is error


def test_resolve_explicit_embedding_model_preserves_raw_provider_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    error = ProviderTokenNotInitError("provider setup required")
    _install_manager(monkeypatch, _ModelManager(error=error))

    with pytest.raises(ProviderTokenNotInitError, match="provider setup required") as exc_info:
        KnowledgeModelConfigurationGateway().resolve_embedding_model(
            tenant_id="tenant", provider="provider", model="embedding"
        )

    assert exc_info.value is error


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (LLMBadRequestError(), "No Embedding Model available"),
        (ProviderTokenNotInitError("provider setup required"), "provider setup required"),
    ],
)
def test_validate_embedding_model_preserves_public_errors(
    monkeypatch: pytest.MonkeyPatch, error: Exception, message: str
) -> None:
    _install_manager(monkeypatch, _ModelManager(error=error))

    with pytest.raises(ValueError, match=message):
        KnowledgeModelConfigurationGateway().validate_embedding_model(
            tenant_id="tenant", provider="provider", model="embedding"
        )


def test_validate_reranking_model_uses_rerank_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = _ModelManager()
    _install_manager(monkeypatch, manager)

    KnowledgeModelConfigurationGateway().validate_reranking_model(
        tenant_id="tenant", provider="provider", model="reranker"
    )

    assert manager.calls == [("tenant", "provider", ModelType.RERANK, "reranker")]


def test_validate_dataset_model_skips_economy(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = _ModelManager()
    _install_manager(monkeypatch, manager)

    KnowledgeModelConfigurationGateway().validate_dataset_model(
        configuration=DatasetModelConfiguration(
            tenant_id="tenant",
            indexing_technique="economy",
            embedding_model_provider=None,
            embedding_model=None,
        )
    )

    assert manager.calls == []


def test_validate_dataset_model_preserves_unavailable_context(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_manager(monkeypatch, _ModelManager(error=ProviderTokenNotInitError("token missing")))

    with pytest.raises(ValueError, match="The dataset is unavailable, due to: token missing"):
        KnowledgeModelConfigurationGateway().validate_dataset_model(
            configuration=DatasetModelConfiguration(
                tenant_id="tenant",
                indexing_technique="high_quality",
                embedding_model_provider="provider",
                embedding_model="embedding",
            )
        )
