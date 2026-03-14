from __future__ import annotations

from types import SimpleNamespace

import pytest

from controllers.console.app import wraps as wraps_module
from controllers.console.app.error import AppNotFoundError
from models.model import AppMode


def test_get_app_model_injects_model(monkeypatch: pytest.MonkeyPatch) -> None:
    app_model = SimpleNamespace(id="app-1", mode=AppMode.CHAT.value, status="normal", tenant_id="t1")
    query = SimpleNamespace(where=lambda *_args, **_kwargs: query, first=lambda: app_model)

    monkeypatch.setattr(wraps_module, "current_account_with_tenant", lambda: (None, "t1"))
    monkeypatch.setattr(wraps_module.db, "session", SimpleNamespace(query=lambda *_args, **_kwargs: query))

    @wraps_module.get_app_model
    def handler(app_model):
        return app_model.id

    assert handler(app_id="app-1") == "app-1"


def test_get_app_model_rejects_wrong_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    app_model = SimpleNamespace(id="app-1", mode=AppMode.CHAT.value, status="normal", tenant_id="t1")
    query = SimpleNamespace(where=lambda *_args, **_kwargs: query, first=lambda: app_model)

    monkeypatch.setattr(wraps_module, "current_account_with_tenant", lambda: (None, "t1"))
    monkeypatch.setattr(wraps_module.db, "session", SimpleNamespace(query=lambda *_args, **_kwargs: query))

    @wraps_module.get_app_model(mode=[AppMode.COMPLETION])
    def handler(app_model):
        return app_model.id

    with pytest.raises(AppNotFoundError):
        handler(app_id="app-1")


def test_get_app_model_requires_app_id() -> None:
    @wraps_module.get_app_model
    def handler(app_model):
        return app_model.id

    with pytest.raises(ValueError):
        handler()
