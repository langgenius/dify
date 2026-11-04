"""First-use timestamps start empty and are populated only by new usage writes."""

from datetime import datetime, timedelta
from importlib import import_module

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account
from repositories.app.console_repository import ConsoleAppRepository
from services.consumer_service import ConsumerIdentity
from tests.helpers.consumer import new_consumer_run
from tests.helpers.end_user_api_key import make_harness

MIGRATION = "migrations.versions.2026_11_04_1600-8d2f6a9c4b71_add_account_first_app_used_at"


def test_upgrade_leaves_historical_usage_unset_until_new_usage_and_downgrades(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine
) -> None:
    base = make_harness(sqlite_session_factory)
    assert base.context.account_id is not None
    historical_usage = datetime(2026, 11, 4, 10)
    with sqlite_session_factory.begin() as session:
        session.add(new_consumer_run(base, created_at=historical_usage))
    migration = import_module(MIGRATION)
    with sqlite_engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
        Operations(MigrationContext.configure(connection)).drop_column("accounts", "first_app_used_at")
        migration.upgrade()
        column = next(
            column for column in sa.inspect(connection).get_columns("accounts") if column["name"] == "first_app_used_at"
        )
        assert column["nullable"]
        assert column["default"] is None
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(Account.first_app_used_at).where(Account.id == base.context.account_id)) is None

    new_usage = historical_usage + timedelta(days=1)
    ConsoleAppRepository(session_factory=sqlite_session_factory).record_consumer_usage(
        ConsumerIdentity(base.context.account_id),
        tenant_id=base.context.tenant_id,
        app_id=base.context.app_id,
        end_user_id=base.context.end_user_id,
        used_at=new_usage,
    )
    with sqlite_session_factory() as session:
        assert (
            session.scalar(sa.select(Account.first_app_used_at).where(Account.id == base.context.account_id))
            == new_usage
        )
    with sqlite_engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
        migration.downgrade()
        assert "first_app_used_at" not in {column["name"] for column in sa.inspect(connection).get_columns("accounts")}
