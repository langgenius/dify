import pytest

from core.dify_builder.errors import BadRequestError
from services.dify_builder.agent import model_resolver

MC = {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {"temperature": 0.5, "stop": ["\n\n"]}}


class _FakeManager:
    def __init__(self, *, fail=False):
        self._fail = fail
        self.default_used = False
        self.explicit_args = None

    def get_model_instance(self, *, tenant_id, provider, model_type, model):
        if self._fail:
            raise RuntimeError("provider not configured")
        self.explicit_args = (tenant_id, provider, str(model_type), model)
        return "EXPLICIT_INSTANCE"

    def get_default_model_instance(self, *, tenant_id, model_type):
        self.default_used = True
        return "DEFAULT_INSTANCE"

    def get_default_provider_model_name(self, *, tenant_id, model_type):
        return ("anthropic", "claude-sonnet-5")


def _patch_manager(monkeypatch, manager):
    monkeypatch.setattr(model_resolver.ModelManager, "for_tenant", staticmethod(lambda tenant_id, user_id=None: manager))


def test_resolve_explicit_model(monkeypatch):
    mgr = _FakeManager()
    _patch_manager(monkeypatch, mgr)
    inst = model_resolver.resolve_model_instance("t1", MC)
    assert inst == "EXPLICIT_INSTANCE"
    assert mgr.explicit_args[1] == "openai" and mgr.explicit_args[3] == "gpt-4o"
    assert mgr.explicit_args[2] == "llm"


def test_resolve_falls_back_to_default(monkeypatch):
    mgr = _FakeManager()
    _patch_manager(monkeypatch, mgr)
    assert model_resolver.resolve_model_instance("t1", None) == "DEFAULT_INSTANCE"
    assert mgr.default_used


def test_validate_raises_bad_request_on_unresolvable(monkeypatch):
    _patch_manager(monkeypatch, _FakeManager(fail=True))
    with pytest.raises(BadRequestError):
        model_resolver.validate_model_config("t1", MC)


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
    assert params == {"temperature": 0.5} and stop is None
