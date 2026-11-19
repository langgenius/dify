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


def sessionmaker_for(session: Session) -> sessionmaker[Session]:
    """A maker for new sessions on the same bind as ``session``.

    A streamed response body runs after the handler's session has closed, so later reads
    need their own sessions. The maker is taken from the injected session. It does not
    consult the process-wide factory.

    Precondition: ``session`` is bound. Postcondition: no session is opened. Sessions
    created from the result use ``session``'s bind and expire-on-commit setting.
    """
    return sessionmaker(bind=session.get_bind(), expire_on_commit=session.expire_on_commit)


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
