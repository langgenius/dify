from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

_session_maker: sessionmaker[Session] | None = None


def configure_session_factory(engine: Engine, expire_on_commit: bool = False):
    """Configure the global session factory"""
    global _session_maker
    _session_maker = sessionmaker(bind=engine, expire_on_commit=expire_on_commit)


def get_session_maker() -> sessionmaker[Session]:
    if _session_maker is None:
        raise RuntimeError("Session factory not configured. Call configure_session_factory() first.")
    return _session_maker


def create_session() -> Session:
    return get_session_maker()()


def release_session_connection(session: Session) -> None:
    """Return ``session``'s pooled connection while keeping the rows it loaded usable.

    Use it before work that opens another session or performs external I/O while ``session``
    is still needed afterwards. A session that stays inside a transaction keeps one pooled
    connection checked out; if the same request then needs a second connection, concurrent
    requests equal to the pool capacity can each hold one and wait for another forever.

    Precondition: ``session`` has no pending writes that must stay uncommitted.
    Postcondition: ``session`` is outside a transaction and its connection is back in the
    pool; rows it loaded stay attached and unexpired; its ``expire_on_commit`` setting is
    restored on success and on failure.
    """
    expire_on_commit = session.expire_on_commit
    session.expire_on_commit = False
    try:
        session.commit()
    finally:
        session.expire_on_commit = expire_on_commit


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


session_factory = SessionFactory()
