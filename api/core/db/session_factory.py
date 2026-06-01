"""Global SQLAlchemy session factories for shared application code.

The synchronous factory is configured from the Flask-SQLAlchemy engine during
extension initialization. FastAPI also configures the async engine/sessionmaker.
"""

from typing import Any, TypedDict

from sqlalchemy import Engine
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config

_engine: Engine | None = None
_session_maker: sessionmaker[Session] | None = None
_async_engine: AsyncEngine | None = None
_async_session_maker: async_sessionmaker[AsyncSession] | None = None


def configure_session_factory(engine: Engine, expire_on_commit: bool = False) -> sessionmaker[Session]:
    """Configure the global sync session factory and return it."""
    global _engine, _session_maker
    _engine = engine
    _session_maker = sessionmaker(bind=engine, expire_on_commit=expire_on_commit)
    return _session_maker


def get_session_maker() -> sessionmaker[Session]:
    if _session_maker is None:
        raise RuntimeError("Session factory not configured. Call configure_session_factory() first.")
    return _session_maker


def create_session() -> Session:
    return get_session_maker()()


class SessionFactory:
    """Facade for configured sync and async SQLAlchemy session factories."""

    @staticmethod
    def configure(engine: Engine, expire_on_commit: bool = False) -> sessionmaker[Session]:
        return configure_session_factory(engine, expire_on_commit)

    @staticmethod
    def get_engine() -> Engine:
        if _engine is None:
            raise RuntimeError("Session factory not configured. Call configure_session_factory() first.")
        return _engine

    @staticmethod
    def get_session_maker() -> sessionmaker[Session]:
        return get_session_maker()

    @staticmethod
    def create_session() -> Session:
        return create_session()

    @staticmethod
    def configure_async(
        async_engine: AsyncEngine,
        expire_on_commit: bool = False,
    ) -> async_sessionmaker[AsyncSession]:
        global _async_engine, _async_session_maker
        _async_engine = async_engine
        _async_session_maker = async_sessionmaker(bind=async_engine, expire_on_commit=expire_on_commit)
        return _async_session_maker

    @staticmethod
    def configure_async_from_uri(
        sync_uri: str,
        *,
        echo: bool | str = False,
        expire_on_commit: bool = False,
    ) -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
        async_engine = SessionFactory.create_async_database_engine(sync_uri, echo=echo)
        async_session_maker = SessionFactory.configure_async(async_engine, expire_on_commit=expire_on_commit)
        return async_engine, async_session_maker

    @staticmethod
    def build_async_database_uri(sync_uri: str) -> str:
        """Return the async SQLAlchemy URL matching Dify's configured sync URL."""

        url = make_url(sync_uri)
        drivername = _async_drivername(url)
        async_url = url.set(drivername=drivername)
        return async_url.render_as_string(hide_password=False)

    @staticmethod
    def create_async_database_engine(sync_uri: str, *, echo: bool | str = False) -> AsyncEngine:
        """Create the async engine matching Dify's configured sync database URL."""

        async_uri = SessionFactory.build_async_database_uri(sync_uri)
        async_url = make_url(async_uri)
        return create_async_engine(
            async_uri,
            echo=_normalize_sqlalchemy_echo(echo),
            **_async_engine_options(async_url),
        )


session_factory = SessionFactory()


def _async_drivername(url: URL) -> str:
    drivername = url.drivername
    if drivername in {"postgresql", "postgresql+psycopg2"}:
        return "postgresql+asyncpg"
    if drivername in {"mysql", "mysql+pymysql"}:
        return "mysql+aiomysql"
    if drivername in {"sqlite", "sqlite+pysqlite"}:
        return "sqlite+aiosqlite"
    raise ValueError(f"Unsupported async database driver for '{drivername}'.")


def _normalize_sqlalchemy_echo(value: bool | str) -> bool | str:
    if not isinstance(value, str):
        return value

    normalized = value.strip().lower()
    if normalized in {"true", "1", "yes", "on"}:
        return True
    if normalized in {"false", "0", "no", "off", ""}:
        return False
    return value


class _AsyncEngineOptions(TypedDict, total=False):
    pool_size: int | None
    max_overflow: int | None
    pool_recycle: int | None
    pool_pre_ping: bool | None
    pool_use_lifo: bool | None
    pool_reset_on_return: str | bool | None
    pool_timeout: int | None
    connect_args: dict[str, Any]


def _async_engine_options(url: URL) -> _AsyncEngineOptions:
    """Return async engine options that are valid for the target database driver."""

    if url.drivername == "sqlite+aiosqlite":
        return {}

    options: _AsyncEngineOptions = {
        "pool_size": dify_config.SQLALCHEMY_POOL_SIZE,
        "max_overflow": dify_config.SQLALCHEMY_MAX_OVERFLOW,
        "pool_recycle": dify_config.SQLALCHEMY_POOL_RECYCLE,
        "pool_pre_ping": dify_config.SQLALCHEMY_POOL_PRE_PING,
        "pool_use_lifo": dify_config.SQLALCHEMY_POOL_USE_LIFO,
        "pool_reset_on_return": dify_config.SQLALCHEMY_POOL_RESET_ON_RETURN,
        "pool_timeout": dify_config.SQLALCHEMY_POOL_TIMEOUT,
    }

    if url.drivername == "postgresql+asyncpg":
        timezone = dify_config.DB_SESSION_TIMEZONE_OVERRIDE.strip()
        if timezone:
            options["connect_args"] = {"server_settings": {"timezone": timezone}}

    return options
