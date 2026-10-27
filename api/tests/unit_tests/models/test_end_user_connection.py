import importlib.util
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.end_user_connection import AppConnection, EndUserConnection, EndUserConnectionClaim, SessionConnection
from tests.helpers.end_user_connection_contract import ConnectionPersistenceTests


@pytest.fixture
def connection_session() -> Iterator[Session]:
    engine = sa.create_engine("sqlite://")
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        EndUserConnection.metadata.create_all(
            connection,
            tables=[
                model.metadata.tables[model.__tablename__]
                for model in (EndUserConnection, AppConnection, SessionConnection)
            ],
        )
        connection.commit()
        with Session(connection) as session:
            yield session
    engine.dispose()


class TestEndUserConnection(ConnectionPersistenceTests):
    pass


def test_claim_migration_upgrade_constraints_and_downgrade() -> None:
    path = Path(__file__).parents[3] / "migrations/versions/2026_10_26_1000-e73b4d81a902_add_guest_connection_claims.py"
    spec = importlib.util.spec_from_file_location("claim_migration", path)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite://")
    guest_id, account_id = str(uuid4()), str(uuid4())
    tenant_id, app_id = str(uuid4()), str(uuid4())

    def receipt(guest: str, account: str, count: int) -> EndUserConnectionClaim:
        return EndUserConnectionClaim(
            tenant_id=tenant_id,
            app_id=app_id,
            end_user_id=guest,
            account_id=account,
            account_end_user_id=str(uuid4()),
            connection_count=count,
        )

    try:
        with engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        with Session(engine) as session, session.begin():
            session.add(receipt(guest_id, account_id, 0))
        for guest, account, count in ((guest_id, str(uuid4()), 0), (str(uuid4()), account_id, -1)):
            with Session(engine) as session:
                session.add(receipt(guest, account, count))
                with pytest.raises(IntegrityError):
                    session.flush()
        with engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
        assert "end_user_connection_claims" not in sa.inspect(engine).get_table_names()
    finally:
        engine.dispose()
