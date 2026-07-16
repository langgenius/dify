from __future__ import annotations

from contextlib import nullcontext
from inspect import getsource
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import Select
from sqlalchemy.orm import Session

from controllers.common import session as session_module
from controllers.common.session import with_session
from controllers.console.app import completion as completion_module
from controllers.console.app import workflow as workflow_module
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
    session = FakeSession()

    def scalar(statement: Select[tuple[App]]) -> object | None:
        has_trial_app_join = any(
            from_clause.is_derived_from(TrialApp.__table__) for from_clause in statement.get_final_froms()
        )
        return None if has_trial_app_join else app_model

    monkeypatch.setattr(session, "scalar", scalar)
    recommended_get_app = MagicMock(return_value=None)
    monkeypatch.setattr(wraps_module.RecommendedAppService, "get_app", recommended_get_app)

    class Handler:
        @wraps_module.get_app_model_with_trial
        def get(self, _injected_session, app_model):
            return app_model.id

    with pytest.raises(AppNotFoundError):
        Handler().get(session, app_id="app-1")

    recommended_get_app.assert_called_once_with("app-1", session=session)


def test_get_app_model_with_trial_falls_back_to_recommended_app(monkeypatch: pytest.MonkeyPatch) -> None:
    app_model = SimpleNamespace(id="app-1", mode=AppMode.CHAT.value, status="normal", tenant_id="t1")
    session = MagicMock(spec=Session)
    trial_app_loader = MagicMock(return_value=None)
    recommended_get_app = MagicMock(return_value=app_model)
    monkeypatch.setattr(wraps_module, "_load_app_model_with_trial", trial_app_loader)
    monkeypatch.setattr(wraps_module.RecommendedAppService, "get_app", recommended_get_app)

    class Handler:
        @wraps_module.get_app_model_with_trial
        def get(self, _injected_session, app_model):
            return app_model.id

    assert Handler().get(session, app_id="app-1") == "app-1"
    trial_app_loader.assert_called_once_with(session, "app-1")
    recommended_get_app.assert_called_once_with("app-1", session=session)


def test_get_app_model_with_trial_prefers_trial_registration(monkeypatch: pytest.MonkeyPatch) -> None:
    app_model = SimpleNamespace(id="app-1", mode=AppMode.CHAT.value, status="normal", tenant_id="t1")
    session = MagicMock(spec=Session)
    trial_app_loader = MagicMock(return_value=app_model)
    recommended_get_app = MagicMock()
    monkeypatch.setattr(wraps_module, "_load_app_model_with_trial", trial_app_loader)
    monkeypatch.setattr(wraps_module.RecommendedAppService, "get_app", recommended_get_app)

    class Handler:
        @wraps_module.get_app_model_with_trial
        def get(self, _injected_session, app_model):
            return app_model.id

    assert Handler().get(session, app_id="app-1") == "app-1"
    trial_app_loader.assert_called_once_with(session, "app-1")
    recommended_get_app.assert_not_called()


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


def test_get_app_model_with_trial_prefers_injected_session(monkeypatch: pytest.MonkeyPatch) -> None:
    app_model = SimpleNamespace(id="app-1", mode=AppMode.CHAT.value, status="normal")
    session = FakeSession(app_model)
    monkeypatch.setattr(
        wraps_module.db,
        "session",
        SimpleNamespace(scalar=lambda *_args, **_kwargs: pytest.fail("db.session should not be used")),
    )
    monkeypatch.setattr(session_module.session_factory, "create_session", lambda: nullcontext(session))

    class Handler:
        @with_session(write=False)
        @wraps_module.get_app_model_with_trial(None)
        def get(self, injected_session, app_model):
            assert injected_session is session
            return app_model.id

    assert Handler().get(app_id="app-1") == "app-1"
    assert session.scalar_called


def test_get_app_model_with_trial_requires_injected_session() -> None:
    @wraps_module.get_app_model_with_trial(None)
    def handler(app_model):
        return app_model.id

    with pytest.raises(RuntimeError, match="requires @with_session"):
        handler(app_id="app-1")


@pytest.mark.parametrize(
    "resource",
    [
        completion_module.CompletionMessageApi,
        completion_module.ChatMessageApi,
        workflow_module.AdvancedChatDraftWorkflowRunApi,
        workflow_module.DraftWorkflowRunApi,
        workflow_module.DraftWorkflowTriggerRunApi,
        workflow_module.DraftWorkflowTriggerRunAllApi,
    ],
)
def test_migrated_handlers_open_session_before_app_lookup(resource: type) -> None:
    assert "@with_session\n    @get_app_model" in getsource(resource)
