"""Checked fixture rows and real SQLAlchemy objects with explicit IO boundaries."""

from collections.abc import Callable, Generator, Mapping, Sequence
from contextlib import AbstractContextManager, contextmanager
from types import TracebackType
from typing import Self, override

import pytest
from sqlalchemy import Select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.types import TypeDecorator

type SqlMethods = Mapping[str, Callable[..., object]]


def checked_row[T](model: type[T], value: object) -> T:
    """Require the selected fixture row to be an instance of its declared model."""
    assert isinstance(value, model)
    return value


def checked_rows[T](model: type[T], values: Sequence[object]) -> list[T]:
    """Validate selected rows while preserving the identity of each ORM object."""
    return [checked_row(model, value) for value in values]


def selected_rows[T](query: Select[tuple[T]], values: Sequence[object]) -> list[T]:
    """Validate entity/scalar results against the Select's runtime type metadata."""
    selected_type = query.column_descriptions[0]["type"]
    if isinstance(selected_type, TypeDecorator):
        selected_type = selected_type.impl
    result_type: type[T] = selected_type if isinstance(selected_type, type) else selected_type.python_type
    return checked_rows(result_type, values)


def _bind_sql_methods(monkeypatch: pytest.MonkeyPatch, session: Session, methods: SqlMethods) -> None:
    """Bind explicitly selected IO methods; all other Session behavior stays real."""
    for name, method in methods.items():
        monkeypatch.setattr(session, name, method)


def sql_session(monkeypatch: pytest.MonkeyPatch, methods: SqlMethods) -> Session:
    """Construct a real Session with the fixture's declared SQL operations."""
    session = Session()
    _bind_sql_methods(monkeypatch, session, methods)
    return session


def sql_session_factory[Boundary](
    monkeypatch: pytest.MonkeyPatch,
    read: Callable[[], AbstractContextManager[Boundary]],
    write: Callable[[], AbstractContextManager[Boundary]] | None = None,
    *,
    methods: Callable[[Boundary], SqlMethods],
) -> sessionmaker[Session]:
    """Retain fixture context entry/exit around a normally initialized Session.

    The context owns SQL timing and commit observations. No database durability
    is claimed by the patched IO methods.
    """

    class BoundarySession(Session):
        scope: AbstractContextManager[Boundary]

        @override
        def __enter__(self) -> Self:
            boundary = self.scope.__enter__()
            _bind_sql_methods(monkeypatch, self, methods(boundary))
            return self

        @override
        def __exit__(
            self,
            type_: type[BaseException] | None,
            value: BaseException | None,
            traceback: TracebackType | None,
        ) -> None:
            self.scope.__exit__(type_, value, traceback)

    class BoundaryFactory(sessionmaker[Session]):
        @override
        def __call__(self, **local_kw: object) -> Session:
            session = super().__call__(**local_kw)
            assert isinstance(session, BoundarySession)
            session.scope = read()
            return session

        @override
        @contextmanager
        def begin(self) -> Generator[Session]:
            session = super().__call__()
            assert isinstance(session, BoundarySession)
            session.scope = (write or read)()
            with session:
                yield session

    return BoundaryFactory(class_=BoundarySession)
