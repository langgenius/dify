"""The historical first-use migration does not infer usage from retained runs."""

from datetime import datetime
from importlib import import_module

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from tests.helpers.consumer import new_consumer_run
from tests.helpers.end_user_api_key import make_harness

MIGRATION = "migrations.versions.2026_11_04_1600-8d2f6a9c4b71_add_account_first_app_used_at"


def test_upgrade_leaves_historical_usage_unset_and_downgrades(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine
) -> None:
    base = make_harness(sqlite_session_factory)
    assert base.context.account_id is not None
    historical_usage = datetime(2026, 11, 4, 10)
    with sqlite_session_factory.begin() as session:
        session.add(new_consumer_run(base, created_at=historical_usage))
    migration = import_module(MIGRATION)
    with sqlite_engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
        migration.upgrade()
        column = next(
            column for column in sa.inspect(connection).get_columns("accounts") if column["name"] == "first_app_used_at"
        )
        assert column["nullable"]
        assert column["default"] is None
        legacy_accounts = sa.table("accounts", sa.column("first_app_used_at", sa.DateTime()))
        assert connection.scalars(sa.select(legacy_accounts.c.first_app_used_at)).one() is None
        migration.downgrade()
        assert "first_app_used_at" not in {column["name"] for column in sa.inspect(connection).get_columns("accounts")}
