from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import Integer, String, create_engine, select, text, update
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from controllers.common import session as session_module
from core.db import session_factory as session_factory_module
from core.db.session_factory import (
    ReadonlySessionCommitError,
    ReadonlySessionWriteError,
    configure_session_factory,
    get_session_maker,
)


class ControllerSessionBase(DeclarativeBase):
    pass


class ControllerSessionWidget(ControllerSessionBase):
    __tablename__ = "controller_session_widgets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)


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


@pytest.fixture
def sqlite_controller_session_factory() -> Iterator[None]:
    old_session_maker = session_factory_module._session_maker
    old_readonly_session_maker = session_factory_module._readonly_session_maker
    engine = create_engine("sqlite:///:memory:")
    ControllerSessionBase.metadata.create_all(engine)
    configure_session_factory(engine)
    try:
        with get_session_maker().begin() as session:
            session.add(ControllerSessionWidget(id=1, name="one"))
        yield
    finally:
        session_factory_module._session_maker = old_session_maker
        session_factory_module._readonly_session_maker = old_readonly_session_maker
        engine.dispose()


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
    monkeypatch.setattr(session_module.session_factory, "create_readonly_session", lambda: session_context)

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


def test_with_session_read_mode_allows_reads_and_blocks_representative_writes(
    sqlite_controller_session_factory: None,
) -> None:
    del sqlite_controller_session_factory

    class Handler:
        @session_module.with_session(write=False)
        def read_scalar(self, session: Session) -> str:
            name = session.scalar(select(ControllerSessionWidget.name).where(ControllerSessionWidget.id == 1))
            assert name is not None
            return name

        @session_module.with_session(write=False)
        def read_text(self, session: Session) -> str:
            return session.execute(text("SELECT name FROM controller_session_widgets WHERE id = 1")).scalar_one()

        @session_module.with_session(write=False)
        def read_get(self, session: Session) -> str:
            widget = session.get(ControllerSessionWidget, 1)
            assert widget is not None
            return widget.name

        @session_module.with_session(write=False)
        def write_add(self, session: Session) -> None:
            session.add(ControllerSessionWidget(id=2, name="two"))

        @session_module.with_session(write=False)
        def write_core_update(self, session: Session) -> None:
            session.execute(
                update(ControllerSessionWidget).where(ControllerSessionWidget.id == 1).values(name="updated")
            )

        @session_module.with_session(write=False)
        def write_driver_insert(self, session: Session) -> None:
            session.connection().exec_driver_sql(
                "INSERT INTO controller_session_widgets (id, name) VALUES (3, 'three')"
            )

        @session_module.with_session(write=False)
        def write_dirty_return(self, session: Session) -> str:
            widget = session.get(ControllerSessionWidget, 1)
            assert widget is not None
            widget.name = "dirty"
            return "return before read-only context exit"

        @session_module.with_session(write=False)
        def write_commit(self, session: Session) -> None:
            session.commit()

        @session_module.with_session(write=True)
        def valid_write(self, session: Session) -> None:
            session.add(ControllerSessionWidget(id=4, name="four"))

    handler = Handler()
    assert handler.read_scalar() == "one"
    assert handler.read_text() == "one"
    assert handler.read_get() == "one"

    with pytest.raises(ReadonlySessionWriteError, match="add ORM objects"):
        handler.write_add()
    with pytest.raises(ReadonlySessionWriteError, match="DML"):
        handler.write_core_update()
    with pytest.raises(ReadonlySessionWriteError, match="write SQL"):
        handler.write_driver_insert()
    with pytest.raises(ReadonlySessionWriteError, match="pending ORM mutations"):
        handler.write_dirty_return()
    with pytest.raises(ReadonlySessionCommitError, match="commit"):
        handler.write_commit()

    handler.valid_write()
    with get_session_maker()() as session:
        names = session.scalars(select(ControllerSessionWidget.name).order_by(ControllerSessionWidget.id)).all()
    assert names == ["one", "four"]
