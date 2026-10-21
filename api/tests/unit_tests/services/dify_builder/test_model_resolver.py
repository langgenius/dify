from dataclasses import dataclass, field

import pytest

from core.dify_builder.errors import BadRequestError, ModelUnavailableError
from core.dify_builder.models import Graph, Inputs
from core.model_manager import ModelInstance, ModelManager
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from services.dify_builder.agent import model_resolver
from tests.unit_tests.core.model_fixtures import make_model_config, make_model_instance

MC = {
    "provider": "openai",
    "name": "gpt-4o",
    "mode": "chat",
    "completion_params": {"temperature": 0.5, "stop": ["\n\n"]},
}


@dataclass
class ModelSelection:
    manager: ModelManager
    instance: ModelInstance
    default_used: bool = False
    explicit_args: tuple[str, str, str, str] | None = None
    lookup_calls: list[dict[str, object]] = field(default_factory=list)


def _manager(monkeypatch: pytest.MonkeyPatch, *, fail: bool = False, active: bool = True) -> ModelSelection:
    manager = ModelManager.for_tenant(tenant_id="t1")
    instance = make_model_instance(provider="openai", model="gpt-4o")
    selection = ModelSelection(manager, instance)
    model = make_model_config(provider="openai", model="gpt-4o", mode="chat").model_schema
    model.model_properties = {ModelPropertyKey.MODE: "chat"}

    def lookup(**kwargs: object) -> AIModelEntity | None:
        selection.lookup_calls.append(kwargs)
        return model if active else None

    def explicit(*, tenant_id: str, provider: str, model_type: ModelType, model: str) -> ModelInstance:
        if fail:
            raise ValueError("provider not configured")
        selection.explicit_args = (tenant_id, provider, str(model_type), model)
        return instance

    def default(**_kwargs: object) -> ModelInstance:
        selection.default_used = True
        if fail:
            raise ValueError("default model not configured")
        return instance

    monkeypatch.setattr(
        type(instance.provider_model_bundle.configuration),
        "get_provider_model",
        lambda _self, **kwargs: lookup(**kwargs),
    )
    monkeypatch.setattr(manager, "get_model_instance", explicit)
    monkeypatch.setattr(manager, "get_default_model_instance", default)
    monkeypatch.setattr(manager, "get_default_provider_model_name", lambda **_kwargs: ("anthropic", "claude-sonnet-5"))
    monkeypatch.setattr(model_resolver.ModelManager, "for_tenant", lambda *_args, **_kwargs: manager)
    return selection


def test_resolve_explicit_model(monkeypatch: pytest.MonkeyPatch) -> None:
    mgr = _manager(monkeypatch)
    inst = model_resolver.resolve_model_instance("t1", MC)
    assert inst is mgr.instance
    assert mgr.explicit_args is not None
    assert mgr.explicit_args[1] == "openai"
    assert mgr.explicit_args[3] == "gpt-4o"
    assert mgr.explicit_args[2] == "llm"


def test_resolve_falls_back_to_default(monkeypatch: pytest.MonkeyPatch) -> None:
    mgr = _manager(monkeypatch)
    assert model_resolver.resolve_model_instance("t1", None) is mgr.instance
    assert mgr.default_used


@pytest.mark.parametrize("config", [MC, None, {}])
def test_validate_raises_model_unavailable_on_unresolvable(
    monkeypatch: pytest.MonkeyPatch, config: Graph | Inputs | None
) -> None:
    _manager(monkeypatch, fail=True)
    with pytest.raises(ModelUnavailableError):
        model_resolver.validate_model_config("t1", config)


@pytest.mark.parametrize("config", [MC, None, {}])
def test_validate_rejects_inactive_or_missing_model(
    monkeypatch: pytest.MonkeyPatch, config: Graph | Inputs | None
) -> None:
    _manager(monkeypatch, active=False)
    with pytest.raises(ModelUnavailableError):
        model_resolver.validate_model_config("t1", config)


@pytest.mark.parametrize("config", [MC, None, {}])
def test_validate_freezes_resolved_active_model(monkeypatch: pytest.MonkeyPatch, config: Graph | Inputs | None) -> None:
    mgr = _manager(monkeypatch)
    result = model_resolver.validate_model_config("t1", config)
    assert result == {**MC, "completion_params": MC["completion_params"] if config else {}}
    assert mgr.lookup_calls == [{"model_type": model_resolver.ModelType.LLM, "model": "gpt-4o", "only_active": True}]


def test_invalid_model_shape_is_bad_request_without_resolution(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = _manager(monkeypatch)
    with pytest.raises(BadRequestError) as exc:
        model_resolver.validate_model_config("t1", {"name": "missing-provider"})
    assert not isinstance(exc.value, ModelUnavailableError)
    assert manager.explicit_args is None


def test_resolved_names_explicit() -> None:
    assert model_resolver.resolved_model_names("t1", MC) == {"provider": "openai", "name": "gpt-4o"}


def test_resolved_names_default(monkeypatch: pytest.MonkeyPatch) -> None:
    _manager(monkeypatch)
    assert model_resolver.resolved_model_names("t1", None) == {"provider": "anthropic", "name": "claude-sonnet-5"}


def test_normalize_splits_stop() -> None:
    params, stop = model_resolver.normalize_completion_params({"temperature": 0.5, "stop": ["\n\n"]})
    assert params == {"temperature": 0.5}
    assert stop == ["\n\n"]


def test_normalize_no_stop() -> None:
    params, stop = model_resolver.normalize_completion_params({"temperature": 0.5})
    assert params == {"temperature": 0.5}
    assert stop is None


def test_normalize_string_stop_is_single_element_list() -> None:
    params, stop = model_resolver.normalize_completion_params({"temperature": 0.1, "stop": "END"})
    assert params == {"temperature": 0.1}
    assert stop == ["END"]
