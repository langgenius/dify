from __future__ import annotations

import pytest

from controllers.common import session as session_module


class FakeSession:
    committed: bool
    rolled_back: bool
    closed: bool

    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False
        self.closed = False

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


def test_with_session_write_commits_on_success(monkeypatch: pytest.MonkeyPatch) -> None:
    session = FakeSession()
    session_maker = FakeSessionMaker(session)
    monkeypatch.setattr(session_module.session_factory, "get_session_maker", lambda: session_maker)

    class Handler:
        @session_module.with_session(write=True)
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


def test_with_session_default_write_commits_on_success(monkeypatch: pytest.MonkeyPatch) -> None:
    session = FakeSession()
    session_maker = FakeSessionMaker(session)
    monkeypatch.setattr(session_module.session_factory, "get_session_maker", lambda: session_maker)

    class Handler:
        @session_module.with_session
        def post(self, injected_session):
            assert injected_session is session
            return "ok"

    assert Handler().post() == "ok"
    assert session.committed
    assert not session.rolled_back


def test_with_session_write_rolls_back_on_error(monkeypatch: pytest.MonkeyPatch) -> None:
    session = FakeSession()
    session_maker = FakeSessionMaker(session)
    monkeypatch.setattr(session_module.session_factory, "get_session_maker", lambda: session_maker)

    class Handler:
        @session_module.with_session(write=True)
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


def test_with_session_read_mode_does_not_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    session = FakeSession()
    session_context = FakeSessionContext(session)
    monkeypatch.setattr(session_module.session_factory, "create_session", lambda: session_context)

    class Handler:
        @session_module.with_session(write=False)
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


def test_with_session_preserves_wrapped_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    session = FakeSession()
    session_maker = FakeSessionMaker(session)
    monkeypatch.setattr(session_module.session_factory, "get_session_maker", lambda: session_maker)

    class Handler:
        @session_module.with_session
        def get(self, _session):
            """handler docs"""
            return "ok"

    assert Handler.get.__name__ == "get"
    assert Handler.get.__doc__ == "handler docs"
