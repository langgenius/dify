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
