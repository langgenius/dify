from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import Select

from controllers.console.app import wraps as wraps_module
from controllers.console.app.error import AppNotFoundError
from models.model import App, AppMode, TrialApp


class FakeSession:
    app_model: object | None
    committed: bool
    rolled_back: bool
    closed: bool
    scalar_called: bool

    def __init__(self, app_model: object | None = None) -> None:
        self.app_model = app_model
        self.committed = False
        self.rolled_back = False
        self.closed = False
        self.scalar_called = False

    def scalar(self, *_args: object, **_kwargs: object) -> object | None:
        self.scalar_called = True
        return self.app_model

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True


class FakeSessionBegin:
    session: FakeSession
    entered: bool
    exited: bool
    exc_type: object | None

    def __init__(self, session: FakeSession) -> None:
        self.session = session
        self.entered = False
        self.exited = False
        self.exc_type = None

    def __enter__(self) -> FakeSession:
        self.entered = True
        return self.session

    def __exit__(self, exc_type: object | None, *_args: object) -> None:
        self.exited = True
        self.exc_type = exc_type
        if exc_type is None:
            self.session.commit()
        else:
            self.session.rollback()
        self.session.closed = True


class FakeSessionContext:
    session: FakeSession
    entered: bool
    exited: bool
    exc_type: object | None

    def __init__(self, session: FakeSession) -> None:
        self.session = session
        self.entered = False
        self.exited = False
        self.exc_type = None

    def __enter__(self) -> FakeSession:
        self.entered = True
        return self.session

    def __exit__(self, exc_type: object | None, *_args: object) -> None:
        self.exited = True
        self.exc_type = exc_type
        self.session.closed = True


class FakeSessionMaker:
    begin_context: FakeSessionBegin

    def __init__(self, session: FakeSession) -> None:
        self.begin_context = FakeSessionBegin(session)

    def begin(self) -> FakeSessionBegin:
        return self.begin_context


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


def test_with_session_defaults_to_write_session_for_get_app_model(monkeypatch: pytest.MonkeyPatch) -> None:
    app_model = SimpleNamespace(id="app-1", mode=AppMode.CHAT.value, status="normal", tenant_id="t1")
    session = FakeSession(app_model)
    session_maker = FakeSessionMaker(session)
    monkeypatch.setattr(wraps_module.session_factory, "get_session_maker", lambda: session_maker)
    monkeypatch.setattr(wraps_module, "current_account_with_tenant", lambda: (None, "t1"))
    monkeypatch.setattr(
        wraps_module.db,
        "session",
        SimpleNamespace(scalar=lambda *_args, **_kwargs: pytest.fail("db.session should not be used")),
    )

    class Handler:
        @wraps_module.with_session
        @wraps_module.get_app_model
        def get(self, injected_session, app_model):
            assert injected_session is session
            return app_model.id

    assert Handler().get(app_id="app-1") == "app-1"
    assert session.scalar_called
    assert session.committed
    assert not session.rolled_back
    assert session.closed
    assert session_maker.begin_context.entered
    assert session_maker.begin_context.exited
    assert session_maker.begin_context.exc_type is None


def test_with_session_read_mode_does_not_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    session = FakeSession()
    session_context = FakeSessionContext(session)
    monkeypatch.setattr(wraps_module.session_factory, "create_session", lambda: session_context)

    class Handler:
        @wraps_module.with_session(write=False)
        def get(self, injected_session):
            assert injected_session is session
            return "ok"

    assert Handler().get() == "ok"

    assert session.closed
    assert not session.committed
    assert not session.rolled_back
    assert session_context.entered
    assert session_context.exited
    assert session_context.exc_type is None


def test_with_session_write_commits_on_success(monkeypatch: pytest.MonkeyPatch) -> None:
    session = FakeSession()
    session_maker = FakeSessionMaker(session)
    monkeypatch.setattr(wraps_module.session_factory, "get_session_maker", lambda: session_maker)

    class Handler:
        @wraps_module.with_session(write=True)
        def post(self, injected_session):
            assert injected_session is session
            return "ok"

    assert Handler().post() == "ok"

    assert session.closed
    assert session.committed
    assert not session.rolled_back
    assert session_maker.begin_context.entered
    assert session_maker.begin_context.exited
    assert session_maker.begin_context.exc_type is None


def test_with_session_write_rolls_back_on_error(monkeypatch: pytest.MonkeyPatch) -> None:
    session = FakeSession()
    session_maker = FakeSessionMaker(session)
    monkeypatch.setattr(wraps_module.session_factory, "get_session_maker", lambda: session_maker)

    class Handler:
        @wraps_module.with_session(write=True)
        def get(self, _session):
            raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        Handler().get()

    assert session.closed
    assert not session.committed
    assert session.rolled_back
    assert session_maker.begin_context.entered
    assert session_maker.begin_context.exited
    assert session_maker.begin_context.exc_type is RuntimeError
