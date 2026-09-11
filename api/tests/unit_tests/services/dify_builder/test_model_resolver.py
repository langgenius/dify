from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.dify_builder.errors import BadRequestError, ModelUnavailableError
from services.dify_builder.agent import model_resolver

MC = {
    "provider": "openai",
    "name": "gpt-4o",
    "mode": "chat",
    "completion_params": {"temperature": 0.5, "stop": ["\n\n"]},
}


class _FakeManager:
    def __init__(self, *, fail=False, active=True):
        self._fail = fail
        self.default_used = False
        self.explicit_args = None
        self.lookup = Mock(return_value=SimpleNamespace(model_properties={"mode": "chat"}) if active else None)
        self.instance = SimpleNamespace(
            provider="openai",
            model_name="gpt-4o",
            provider_model_bundle=SimpleNamespace(configuration=SimpleNamespace(get_provider_model=self.lookup)),
        )

    def get_model_instance(self, *, tenant_id, provider, model_type, model):
        if self._fail:
            raise ValueError("provider not configured")
        self.explicit_args = (tenant_id, provider, str(model_type), model)
        return self.instance

    def get_default_model_instance(self, *, tenant_id, model_type):  # noqa: ARG002
        self.default_used = True
        if self._fail:
            raise ValueError("default model not configured")
        return self.instance

    def get_default_provider_model_name(self, *, tenant_id, model_type):  # noqa: ARG002
        return ("anthropic", "claude-sonnet-5")


def _patch_manager(monkeypatch, manager):
    monkeypatch.setattr(
        model_resolver.ModelManager,
        "for_tenant",
        staticmethod(lambda tenant_id, user_id=None: manager),  # noqa: ARG005
    )


def test_resolve_explicit_model(monkeypatch):
    mgr = _FakeManager()
    _patch_manager(monkeypatch, mgr)
    inst = model_resolver.resolve_model_instance("t1", MC)
    assert inst is mgr.instance
    assert mgr.explicit_args[1] == "openai"
    assert mgr.explicit_args[3] == "gpt-4o"
    assert mgr.explicit_args[2] == "llm"


def test_resolve_falls_back_to_default(monkeypatch):
    mgr = _FakeManager()
    _patch_manager(monkeypatch, mgr)
    assert model_resolver.resolve_model_instance("t1", None) is mgr.instance
    assert mgr.default_used


@pytest.mark.parametrize("config", [MC, None, {}])
def test_validate_raises_model_unavailable_on_unresolvable(monkeypatch, config):
    _patch_manager(monkeypatch, _FakeManager(fail=True))
    with pytest.raises(ModelUnavailableError):
        model_resolver.validate_model_config("t1", config)


@pytest.mark.parametrize("config", [MC, None, {}])
def test_validate_rejects_inactive_or_missing_model(monkeypatch, config):
    _patch_manager(monkeypatch, _FakeManager(active=False))
    with pytest.raises(ModelUnavailableError):
        model_resolver.validate_model_config("t1", config)


@pytest.mark.parametrize("config", [MC, None, {}])
def test_validate_freezes_resolved_active_model(monkeypatch, config):
    mgr = _FakeManager()
    _patch_manager(monkeypatch, mgr)
    result = model_resolver.validate_model_config("t1", config)
    assert result == {**MC, "completion_params": MC["completion_params"] if config else {}}
    mgr.lookup.assert_called_once_with(model_type=model_resolver.ModelType.LLM, model="gpt-4o", only_active=True)


def test_invalid_model_shape_is_bad_request_without_resolution(monkeypatch):
    manager = Mock()
    _patch_manager(monkeypatch, manager)
    with pytest.raises(BadRequestError) as exc:
        model_resolver.validate_model_config("t1", {"name": "missing-provider"})
    assert not isinstance(exc.value, ModelUnavailableError)
    manager.get_model_instance.assert_not_called()


def test_resolved_names_explicit():
    assert model_resolver.resolved_model_names("t1", MC) == {"provider": "openai", "name": "gpt-4o"}


def test_resolved_names_default(monkeypatch):
    _patch_manager(monkeypatch, _FakeManager())
    assert model_resolver.resolved_model_names("t1", None) == {"provider": "anthropic", "name": "claude-sonnet-5"}


def test_normalize_splits_stop():
    params, stop = model_resolver.normalize_completion_params({"temperature": 0.5, "stop": ["\n\n"]})
    assert params == {"temperature": 0.5}
    assert stop == ["\n\n"]


def test_normalize_no_stop():
    params, stop = model_resolver.normalize_completion_params({"temperature": 0.5})
    assert params == {"temperature": 0.5}
    assert stop is None


def test_normalize_string_stop_is_single_element_list():
    params, stop = model_resolver.normalize_completion_params({"temperature": 0.1, "stop": "END"})
    assert params == {"temperature": 0.1}
    assert stop == ["END"]
