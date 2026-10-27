from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL, Engine
from sqlalchemy.exc import UnboundExecutionError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

import core.db.session_factory as session_factory_module
from models.account import Account
from models.base import TypeBase
from models.model import ExporleBanner


def test_sqlite_session_contains_the_full_registered_schema(sqlite_session: Session) -> None:
    table_names = set(inspect(sqlite_session.get_bind()).get_table_names())

    assert table_names == set(TypeBase.metadata.tables)


@pytest.mark.parametrize("sqlite_session", [(Account,)], indirect=True)
def test_sqlite_session_accepts_deferred_legacy_indirect_parameters(sqlite_session: Session) -> None:
    """Prove legacy model parameters no longer limit the copied schema."""

    assert inspect(sqlite_session.get_bind()).has_table(ExporleBanner.__tablename__)


def test_sqlite_engine_is_a_pristine_file_copy(
    sqlite_engine: Engine,
    request: pytest.FixtureRequest,
) -> None:
    sqlite_database_template: Path = request.getfixturevalue("_sqlite_database_template")
    assert isinstance(sqlite_engine.pool, QueuePool)
    assert sqlite_engine.url.database != str(sqlite_database_template)

    with sqlite_engine.begin() as connection:
        connection.execute(text("CREATE TABLE per_test_mutation (value INTEGER NOT NULL)"))

    template_engine = create_engine(URL.create("sqlite", database=str(sqlite_database_template)))
    try:
        assert not inspect(template_engine).has_table("per_test_mutation")
    finally:
        template_engine.dispose()


def test_core_session_factory_uses_the_shared_sqlite_session_factory(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    assert session_factory_module.session_factory.get_session_maker() is sqlite_session_factory

    with sqlite_session_factory.begin() as session:
        session.execute(text("CREATE TABLE global_factory_probe (value INTEGER NOT NULL)"))
        session.execute(text("INSERT INTO global_factory_probe (value) VALUES (42)"))

    with session_factory_module.session_factory.create_session() as session:
        assert session.scalar(text("SELECT value FROM global_factory_probe")) == 42


def test_unbound_session_factory_disables_explicit_and_global_database_access(
    unbound_session_factory: sessionmaker[Session],
) -> None:
    assert session_factory_module.session_factory.get_session_maker() is unbound_session_factory

    with unbound_session_factory() as session:
        with pytest.raises(UnboundExecutionError):
            session.get_bind()

    with session_factory_module.session_factory.create_session() as session:
        with pytest.raises(UnboundExecutionError):
            session.execute(text("SELECT 1"))


def test_unbound_session_rejects_database_access(unbound_session: Session) -> None:
    with pytest.raises(UnboundExecutionError):
        unbound_session.scalar(text("SELECT 1"))


def test_sqlite_session_factory_shares_one_database_across_worker_sessions(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.execute(text("CREATE TABLE thread_probe (value INTEGER NOT NULL)"))
        session.execute(text("INSERT INTO thread_probe (value) VALUES (42)"))

    worker_barrier = Barrier(2)

    def read_value() -> tuple[int, int]:
        with sqlite_session_factory() as session:
            connection = session.connection()
            worker_barrier.wait(timeout=1)
            value = session.scalar(text("SELECT value FROM thread_probe"))
            connection_id = id(connection.connection.dbapi_connection)
            return connection_id, value

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(read_value) for _ in range(2)]
        results = [future.result() for future in futures]

    assert {value for _, value in results} == {42}
    assert len({connection_id for connection_id, _ in results}) == 2
