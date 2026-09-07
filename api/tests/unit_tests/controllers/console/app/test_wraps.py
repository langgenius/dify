from __future__ import annotations

from contextlib import nullcontext
from inspect import getsource
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from controllers.common import session as session_module
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


def test_load_previewable_app_model_rejects_app_outside_preview_admission(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = MagicMock(spec=Session)
    app_loader = MagicMock()
    recommended_app_queries = MagicMock()
    recommended_app_queries.is_previewable.return_value = False
    monkeypatch.setattr(
        wraps_module,
        "application_services",
        lambda: SimpleNamespace(recommended_app_queries=recommended_app_queries),
    )
    monkeypatch.setattr(wraps_module.AppService, "get_normal_app_by_id", app_loader)

    assert wraps_module._load_previewable_app_model(session, "app-1") is None
    recommended_app_queries.is_previewable.assert_called_once_with("app-1")
    app_loader.assert_not_called()


def test_load_previewable_app_model_rejects_non_normal_app(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    app_model = _persist_app(sqlite_session)
    app_id = app_model.id
    sqlite_session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :app_id"), {"app_id": app_id})
    sqlite_session.commit()
    recommended_app_queries = MagicMock()
    recommended_app_queries.is_previewable.return_value = True
    monkeypatch.setattr(
        wraps_module,
        "application_services",
        lambda: SimpleNamespace(recommended_app_queries=recommended_app_queries),
    )

    assert wraps_module._load_previewable_app_model(sqlite_session, app_id) is None


def test_get_previewable_app_model_rejects_app_outside_preview_admission(
    monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    app_loader = MagicMock(return_value=None)
    monkeypatch.setattr(wraps_module, "_load_previewable_app_model", app_loader)

    class Handler:
        @wraps_module.get_previewable_app_model
        def get(self, _injected_session, app_model):
            return app_model.id

    with pytest.raises(AppNotFoundError):
        Handler().get(unbound_session, app_id="app-1")

    app_loader.assert_called_once_with(unbound_session, "app-1")


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


def test_preview_admission_precedes_request_session_transaction(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    app_model = _persist_app(sqlite_session)
    app_id = app_model.id
    sqlite_session.rollback()
    request_transaction_begins = 0

    def record_request_transaction_begin(_session, _transaction, _connection) -> None:
        nonlocal request_transaction_begins
        request_transaction_begins += 1

    event.listen(sqlite_session, "after_begin", record_request_transaction_begin)
    recommended_app_queries = MagicMock()

    def assert_request_session_has_not_started(_app_id: str) -> bool:
        assert request_transaction_begins == 0
        assert sqlite_session.in_transaction() is False
        return True

    recommended_app_queries.is_previewable.side_effect = assert_request_session_has_not_started
    monkeypatch.setattr(
        wraps_module,
        "application_services",
        lambda: SimpleNamespace(recommended_app_queries=recommended_app_queries),
    )
    monkeypatch.setattr(
        wraps_module.db,
        "session",
        SimpleNamespace(scalar=lambda *_args, **_kwargs: pytest.fail("db.session should not be used")),
    )
    monkeypatch.setattr(session_module.session_factory, "create_session", lambda: nullcontext(sqlite_session))

    class Handler:
        @with_session(write=False)
        @wraps_module.get_previewable_app_model(None)
        def get(self, injected_session, app_model):
            assert injected_session is sqlite_session
            return app_model.id

    assert Handler().get(app_id=app_id) == app_id
    recommended_app_queries.is_previewable.assert_called_once_with(app_id)
    assert request_transaction_begins == 1


def test_get_previewable_app_model_requires_injected_session() -> None:
    @wraps_module.get_previewable_app_model(None)
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
