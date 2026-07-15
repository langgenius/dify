from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import Select

from controllers.common.session import with_session
from controllers.console.app import wraps as wraps_module
from controllers.console.app.error import AppNotFoundError
from models.model import App, AppMode, TrialApp


class FakeSession:
    app_model: object | None
    scalar_called: bool

    def __init__(self, app_model: object | None = None) -> None:
        self.app_model = app_model
        self.scalar_called = False

    def scalar(self, *_args: object, **_kwargs: object) -> object | None:
        self.scalar_called = True
        return self.app_model

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass


def test_get_app_model_injects_model(monkeypatch: pytest.MonkeyPatch) -> None:
    app_model = SimpleNamespace(id="app-1", mode=AppMode.CHAT.value, status="normal", tenant_id="t1")
    monkeypatch.setattr(wraps_module, "current_account_with_tenant", lambda: (None, "t1"))
    monkeypatch.setattr(wraps_module.db, "session", SimpleNamespace(scalar=lambda *_args, **_kwargs: app_model))

    @wraps_module.get_app_model
    def handler(app_model):
        return app_model.id

    assert handler(app_id="app-1") == "app-1"


def test_get_app_model_rejects_wrong_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    app_model = SimpleNamespace(id="app-1", mode=AppMode.CHAT.value, status="normal", tenant_id="t1")
    monkeypatch.setattr(wraps_module, "current_account_with_tenant", lambda: (None, "t1"))
    monkeypatch.setattr(wraps_module.db, "session", SimpleNamespace(scalar=lambda *_args, **_kwargs: app_model))

    @wraps_module.get_app_model(mode=[AppMode.COMPLETION])
    def handler(app_model):
        return app_model.id

    with pytest.raises(AppNotFoundError):
        handler(app_id="app-1")


def test_get_app_model_with_trial_requires_trial_app_registration(monkeypatch: pytest.MonkeyPatch) -> None:
    app_model = SimpleNamespace(id="app-1", mode=AppMode.CHAT.value, status="normal", tenant_id="t1")

    def scalar(statement: Select[tuple[App]]) -> object | None:
        has_trial_app_join = any(
            from_clause.is_derived_from(TrialApp.__table__) for from_clause in statement.get_final_froms()
        )
        return None if has_trial_app_join else app_model

    monkeypatch.setattr(wraps_module.db, "session", SimpleNamespace(scalar=scalar))

    @wraps_module.get_app_model_with_trial
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


def test_wraps_with_session_reexports_common_session_decorator() -> None:
    assert wraps_module.with_session is with_session


def test_get_app_model_prefers_injected_session(monkeypatch: pytest.MonkeyPatch) -> None:
    app_model = SimpleNamespace(id="app-1", mode=AppMode.CHAT.value, status="normal", tenant_id="t1")
    session = FakeSession(app_model)
    monkeypatch.setattr(wraps_module, "current_account_with_tenant", lambda: (None, "t1"))
    monkeypatch.setattr(
        wraps_module.db,
        "session",
        SimpleNamespace(scalar=lambda *_args, **_kwargs: pytest.fail("db.session should not be used")),
    )

    class Handler:
        @wraps_module.get_app_model
        def get(self, _injected_session, app_model):
            return app_model.id

    assert Handler().get(session, app_id="app-1") == "app-1"
    assert session.scalar_called
