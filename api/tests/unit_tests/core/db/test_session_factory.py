from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import Integer, String, create_engine, select, text, update
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from core.db import session_factory as session_factory_module
from core.db.session_factory import (
    GuardedSession,
    ReadonlySessionCommitError,
    ReadonlySessionWriteError,
    configure_session_factory,
    create_readonly_session,
    create_session,
    get_session_maker,
)


class Base(DeclarativeBase):
    pass


class Widget(Base):
    __tablename__ = "widgets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)


@pytest.fixture
def sqlite_session_factory() -> Iterator[None]:
    old_session_maker = session_factory_module._session_maker
    old_readonly_session_maker = session_factory_module._readonly_session_maker
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    configure_session_factory(engine)
    try:
        with get_session_maker().begin() as session:
            session.add(Widget(id=1, name="one"))
        yield
    finally:
        session_factory_module._session_maker = old_session_maker
        session_factory_module._readonly_session_maker = old_readonly_session_maker
        engine.dispose()


def test_write_sessions_use_plain_sqlalchemy_session(sqlite_session_factory: None) -> None:
    del sqlite_session_factory

    with create_session() as session:
        assert not isinstance(session, GuardedSession)

    with create_readonly_session() as session:
        assert isinstance(session, GuardedSession)


def test_readonly_session_allows_reads(sqlite_session_factory: None) -> None:
    del sqlite_session_factory

    with create_readonly_session() as session:
        assert session.scalar(select(Widget.name).where(Widget.id == 1)) == "one"
        assert session.execute(text("SELECT name FROM widgets WHERE id = 1")).scalar_one() == "one"


def test_readonly_session_blocks_orm_write_apis(sqlite_session_factory: None) -> None:
    del sqlite_session_factory

    with create_readonly_session() as session:
        with pytest.raises(ReadonlySessionWriteError, match="add ORM objects"):
            session.add(Widget(id=2, name="two"))
        with pytest.raises(ReadonlySessionWriteError, match="flush"):
            session.flush()
        with pytest.raises(ReadonlySessionCommitError, match="commit"):
            session.commit()


def test_readonly_session_blocks_core_and_raw_writes(sqlite_session_factory: None) -> None:
    del sqlite_session_factory

    with create_readonly_session() as session:
        with pytest.raises(ReadonlySessionWriteError, match="DML"):
            session.execute(update(Widget).where(Widget.id == 1).values(name="updated"))
        with pytest.raises(ReadonlySessionWriteError, match="write SQL"):
            session.execute(text("INSERT INTO widgets (id, name) VALUES (2, 'two')"))
        with pytest.raises(ReadonlySessionWriteError, match="write SQL"):
            session.connection().exec_driver_sql("INSERT INTO widgets (id, name) VALUES (3, 'three')")


def _dirty_widget_in_readonly_session() -> None:
    with create_readonly_session() as session:
        widget = session.get(Widget, 1)
        assert widget is not None
        widget.name = "dirty"


def test_readonly_session_rejects_dirty_orm_objects_on_exit(sqlite_session_factory: None) -> None:
    del sqlite_session_factory

    with pytest.raises(ReadonlySessionWriteError, match="pending ORM mutations"):
        _dirty_widget_in_readonly_session()

    with get_session_maker().begin() as session:
        assert session.scalar(select(Widget.name).where(Widget.id == 1)) == "one"


def test_sqlite_query_only_is_reset_after_readonly_session(sqlite_session_factory: None) -> None:
    del sqlite_session_factory

    with create_readonly_session() as session:
        assert session.scalar(select(Widget.name).where(Widget.id == 1)) == "one"

    with get_session_maker().begin() as session:
        session.add(Widget(id=2, name="two"))

    with get_session_maker()() as session:
        assert session.scalar(select(Widget.name).where(Widget.id == 2)) == "two"
