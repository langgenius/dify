from __future__ import annotations

from inspect import getsource
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from controllers.common.session import with_session
from controllers.console.app import completion as completion_module
from controllers.console.app import workflow as workflow_module
from controllers.console.app import wraps as wraps_module
from controllers.console.app.error import AppNotFoundError
from models.model import App, AppMode


def _persist_app(sqlite_session: Session, *, mode: AppMode = AppMode.CHAT) -> App:
    app_model = App(
        tenant_id=str(uuid4()),
        name="Test App",
        mode=mode,
        enable_site=True,
        enable_api=True,
    )
    app_model.id = str(uuid4())
    sqlite_session.add(app_model)
    sqlite_session.commit()
    return app_model


def test_get_app_model_injects_model(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    app_model = _persist_app(sqlite_session)
    monkeypatch.setattr(wraps_module, "current_account_with_tenant", lambda: (None, app_model.tenant_id))
    monkeypatch.setattr(wraps_module.db, "session", sqlite_session)

    @wraps_module.get_app_model
    def handler(app_model):
        return app_model.id

    assert handler(app_id=app_model.id) == app_model.id


def test_get_app_model_rejects_wrong_mode(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    app_model = _persist_app(sqlite_session)
    monkeypatch.setattr(wraps_module, "current_account_with_tenant", lambda: (None, app_model.tenant_id))
    monkeypatch.setattr(wraps_module.db, "session", sqlite_session)

    @wraps_module.get_app_model(mode=[AppMode.COMPLETION])
    def handler(app_model):
        return app_model.id

    with pytest.raises(AppNotFoundError):
        handler(app_id=app_model.id)


def test_get_app_model_requires_app_id() -> None:
    @wraps_module.get_app_model
    def handler(app_model):
        return app_model.id

    with pytest.raises(ValueError):
        handler()


def test_wraps_with_session_reexports_common_session_decorator() -> None:
    assert wraps_module.with_session is with_session


def test_get_app_model_prefers_injected_session(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    app_model = _persist_app(sqlite_session)
    monkeypatch.setattr(wraps_module, "current_account_with_tenant", lambda: (None, app_model.tenant_id))

    class Handler:
        @wraps_module.get_app_model
        def get(self, _injected_session, app_model):
            return app_model.id

    # An unbound real Session fails on query, so success proves the injected
    # request Session was preferred over the legacy scoped-session fallback.
    with Session() as scoped_session:
        monkeypatch.setattr(wraps_module.db, "session", scoped_session)
        assert Handler().get(sqlite_session, app_id=app_model.id) == app_model.id


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
