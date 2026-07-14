import re
from collections.abc import Generator, Iterable, Sequence
from contextlib import AbstractContextManager, contextmanager
from typing import Any, Protocol, TypeVar, override

from sqlalchemy import Engine, event
from sqlalchemy.engine import Connection
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker
from sqlalchemy.sql.dml import Delete, Insert, Update
from sqlalchemy.sql.elements import TextClause

_T = TypeVar("_T")

READONLY_SESSION_FLAG = "dify_readonly_session"
READONLY_CONNECTION_FLAG = "dify_readonly_connection"

_LEADING_WRITE_SQL_RE = re.compile(
    r"^\s*(?:--[^\n]*(?:\n|$)|/\*.*?\*/\s*)*"
    r"(?:insert|update|delete|merge|replace|create|alter|drop|truncate|grant|revoke|call)\b",
    re.IGNORECASE | re.DOTALL,
)


class ReadonlySession(Protocol):
    """Structural read-only SQLAlchemy session capability for gradual typing.

    A normal ``Session`` satisfies this protocol, so existing write sessions can
    be passed to read-only helpers. The protocol intentionally omits mutation
    methods such as ``add()``, ``delete()``, ``flush()``, and ``commit()``.
    """

    info: dict[Any, Any]

    def get(self, entity: type[_T], ident: object, **kwargs: Any) -> _T | None: ...

    def scalar(self, statement: Any, **kwargs: Any) -> Any: ...

    def scalars(self, statement: Any, **kwargs: Any) -> Any: ...

    def execute(self, statement: Any, params: Any | None = None, **kwargs: Any) -> Any: ...


class ReadonlySessionError(RuntimeError):
    """Base error for writes attempted through a read-only session."""


class ReadonlySessionWriteError(ReadonlySessionError):
    """Raised when a read-only session is asked to mutate database state."""


class ReadonlySessionCommitError(ReadonlySessionError):
    """Raised when code attempts to commit a read-only session."""


def _is_readonly_session(session: Session) -> bool:
    return bool(session.info.get(READONLY_SESSION_FLAG))


def _looks_like_write_sql(statement: str) -> bool:
    return bool(_LEADING_WRITE_SQL_RE.match(statement))


class GuardedSession(Session):
    """SQLAlchemy session with opt-in read-only write guards.

    Only sessions created by ``create_readonly_session()`` use this subclass and
    set ``READONLY_SESSION_FLAG``. Normal write sessions use SQLAlchemy's
    standard ``Session`` class.
    """

    @override
    def add(self, instance: object, _warn: bool = True) -> None:
        if _is_readonly_session(self):
            raise ReadonlySessionWriteError("Cannot add ORM objects with a read-only session.")
        super().add(instance, _warn=_warn)

    @override
    def add_all(self, instances: Iterable[object]) -> None:
        if _is_readonly_session(self):
            raise ReadonlySessionWriteError("Cannot add ORM objects with a read-only session.")
        super().add_all(instances)

    @override
    def delete(self, instance: object) -> None:
        if _is_readonly_session(self):
            raise ReadonlySessionWriteError("Cannot delete ORM objects with a read-only session.")
        super().delete(instance)

    @override
    def merge(self, instance: _T, *, load: bool = True, options: Sequence[Any] | None = None) -> _T:
        if _is_readonly_session(self):
            raise ReadonlySessionWriteError("Cannot merge ORM objects with a read-only session.")
        return super().merge(instance, load=load, options=options)

    @override
    def flush(self, objects: Sequence[object] | None = None) -> None:
        if _is_readonly_session(self):
            raise ReadonlySessionWriteError("Cannot flush a read-only session.")
        super().flush(objects=objects)

    @override
    def commit(self) -> None:
        if _is_readonly_session(self):
            raise ReadonlySessionCommitError("Cannot commit a read-only session.")
        super().commit()


@event.listens_for(GuardedSession, "before_flush")
def _prevent_readonly_flush(session: GuardedSession, _flush_context: object, _instances: object) -> None:
    if _is_readonly_session(session):
        raise ReadonlySessionWriteError("Cannot flush a read-only session.")


@event.listens_for(GuardedSession, "do_orm_execute")
def _prevent_readonly_orm_execute(state: ORMExecuteState) -> None:
    session = state.session
    if not _is_readonly_session(session):
        return

    statement = state.statement
    if state.is_insert or state.is_update or state.is_delete or isinstance(statement, (Insert, Update, Delete)):
        raise ReadonlySessionWriteError("Cannot execute DML with a read-only session.")
    if isinstance(statement, TextClause) and _looks_like_write_sql(statement.text):
        raise ReadonlySessionWriteError("Cannot execute write SQL with a read-only session.")


@event.listens_for(Engine, "before_cursor_execute")
def _prevent_readonly_connection_write(
    conn: Connection,
    _cursor: object,
    statement: str,
    _parameters: object,
    _context: object,
    _executemany: bool,
) -> None:
    if conn.info.get(READONLY_CONNECTION_FLAG) and _looks_like_write_sql(statement):
        raise ReadonlySessionWriteError("Cannot execute write SQL with a read-only session connection.")


def _start_native_readonly_transaction(session: Session) -> Connection:
    connection = session.connection()
    connection.info[READONLY_CONNECTION_FLAG] = True
    dialect_name = connection.dialect.name

    try:
        if dialect_name == "sqlite":
            connection.exec_driver_sql("PRAGMA query_only = ON")
        elif dialect_name == "postgresql":
            connection.exec_driver_sql("BEGIN READ ONLY")
        elif dialect_name in {"mysql", "mariadb"}:
            connection.exec_driver_sql("START TRANSACTION READ ONLY")
    except Exception:
        connection.info.pop(READONLY_CONNECTION_FLAG, None)
        raise

    return connection


def _reset_readonly_connection(connection: Connection | None) -> None:
    if connection is None:
        return
    try:
        if connection.dialect.name == "sqlite":
            connection.exec_driver_sql("PRAGMA query_only = OFF")
    finally:
        connection.info.pop(READONLY_CONNECTION_FLAG, None)


def _assert_readonly_session_clean(session: Session) -> None:
    if session.new or session.dirty or session.deleted:
        raise ReadonlySessionWriteError("Read-only session contains pending ORM mutations.")


_session_maker: sessionmaker[Session] | None = None
_readonly_session_maker: sessionmaker[GuardedSession] | None = None


def configure_session_factory(engine: Engine, expire_on_commit: bool = False):
    """Configure the global session factory"""
    global _session_maker, _readonly_session_maker
    _session_maker = sessionmaker(bind=engine, expire_on_commit=expire_on_commit)
    _readonly_session_maker = sessionmaker(bind=engine, expire_on_commit=expire_on_commit, class_=GuardedSession)


def get_session_maker() -> sessionmaker[Session]:
    if _session_maker is None:
        raise RuntimeError("Session factory not configured. Call configure_session_factory() first.")
    return _session_maker


def _get_readonly_session_maker() -> sessionmaker[GuardedSession]:
    if _readonly_session_maker is None:
        raise RuntimeError("Session factory not configured. Call configure_session_factory() first.")
    return _readonly_session_maker


def create_session() -> Session:
    return get_session_maker()()


@contextmanager
def create_readonly_session() -> Generator[GuardedSession, None, None]:
    """Create a session that is read-only for both runtime checks and DB-native guards."""
    session = _get_readonly_session_maker()()
    old_autoflush = session.autoflush
    session.autoflush = False
    session.info[READONLY_SESSION_FLAG] = True
    connection: Connection | None = None
    try:
        connection = _start_native_readonly_transaction(session)
        yield session
        _assert_readonly_session_clean(session)
    finally:
        _reset_readonly_connection(connection)
        session.rollback()
        session.autoflush = old_autoflush
        session.close()


# Class wrapper for convenience
class SessionFactory:
    @staticmethod
    def configure(engine: Engine, expire_on_commit: bool = False):
        configure_session_factory(engine, expire_on_commit)

    @staticmethod
    def get_session_maker() -> sessionmaker[Session]:
        return get_session_maker()

    @staticmethod
    def create_session() -> Session:
        return create_session()

    @staticmethod
    def create_readonly_session() -> AbstractContextManager[GuardedSession]:
        return create_readonly_session()


session_factory = SessionFactory()
