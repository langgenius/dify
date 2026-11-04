"""Account first-use backfill, ownership filtering and portable migration DDL."""

from datetime import datetime, timedelta
from importlib import import_module
from typing import cast
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.engine import Connection, Engine, create_mock_engine
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account
from models.account_webapp import AccountWebApp
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.model import App, AppMode, EndUser
from tests.helpers.consumer import new_consumer_run
from tests.helpers.end_user_api_key import make_harness

MIGRATION = "migrations.versions.2026_11_04_1600-8d2f6a9c4b71_add_account_first_app_used_at"


def test_upgrade_backfills_earliest_owned_browser_execution_and_downgrades(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine
) -> None:
    base = make_harness(sqlite_session_factory)
    other = make_harness(sqlite_session_factory)
    unused = make_harness(sqlite_session_factory)
    unsupported = make_harness(sqlite_session_factory)
    assert unused.context.account_id is not None
    moment = datetime(2026, 11, 4, 10)
    earliest = moment - timedelta(days=1)
    with sqlite_session_factory.begin() as session:
        session.execute(
            sa.update(EndUser).where(EndUser.id == other.context.end_user_id).values(account_id=base.context.account_id)
        )
        session.execute(sa.update(App).where(App.id == base.context.app_id).values(enable_site=False))
        session.execute(sa.update(App).where(App.id == other.context.app_id).values(mode=AppMode.ADVANCED_CHAT))
        session.execute(sa.update(App).where(App.id == unsupported.context.app_id).values(mode=AppMode.CHAT))
        session.add(new_consumer_run(base, created_at=moment))
        session.add(new_consumer_run(other, created_at=earliest))
        session.add(new_consumer_run(unsupported, created_at=earliest))
        session.add(
            AccountWebApp(
                account_id=unused.context.account_id,
                tenant_id=unused.context.tenant_id,
                app_id=unused.context.app_id,
                last_used_at=moment,
                favorited_at=moment,
            )
        )
        for mismatch in ("tenant", "app", "role", "source", "guest", "type"):
            run = new_consumer_run(base, created_at=earliest - timedelta(days=1))
            if mismatch == "tenant":
                run.tenant_id = str(uuid4())
            elif mismatch == "app":
                run.app_id = str(uuid4())
            elif mismatch == "role":
                run.created_by_role = CreatorUserRole.ACCOUNT
            elif mismatch == "source":
                run.triggered_from = WorkflowRunTriggeredFrom.DEBUGGING
            else:
                user = EndUser(
                    tenant_id=base.context.tenant_id,
                    app_id=base.context.app_id,
                    session_id=str(uuid4()),
                    type=EndUserType.SERVICE_API if mismatch == "type" else EndUserType.BROWSER,
                    account_id=base.context.account_id if mismatch == "type" else None,
                )
                session.add(user)
                run.created_by = user.id
            session.add(run)
    migration = import_module(MIGRATION)
    with sqlite_engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
        Operations(MigrationContext.configure(connection)).drop_column("accounts", "first_app_used_at")
        migration.upgrade()
    with sqlite_session_factory() as session:
        assert dict(session.execute(sa.select(Account.id, Account.first_app_used_at)).tuples().all()) == {
            base.context.account_id: earliest,
            other.context.account_id: None,
            unused.context.account_id: None,
            unsupported.context.account_id: None,
        }
    with sqlite_session_factory.begin() as session:
        session.execute(
            sa.update(Account)
            .where(Account.id == base.context.account_id)
            .values(first_app_used_at=earliest - timedelta(days=2))
        )
    with sqlite_engine.begin() as connection:
        migration.backfill_first_app_usage(connection)
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(Account.first_app_used_at).where(Account.id == base.context.account_id)) == (
            earliest - timedelta(days=2)
        )
    with sqlite_engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
        migration.downgrade()
        assert "first_app_used_at" not in {column["name"] for column in sa.inspect(connection).get_columns("accounts")}


@pytest.mark.parametrize("dialect", ["postgresql", "mysql", "sqlite"])
def test_first_app_usage_backfill_compiles_for_supported_dialects(dialect: str) -> None:
    statements = []
    engine = create_mock_engine(f"{dialect}://", lambda statement, *_args, **_kwargs: statements.append(statement))
    import_module(MIGRATION).backfill_first_app_usage(cast(Connection, engine))
    assert len(statements) == 1
    sql = str(statements[0].compile(dialect=engine.dialect))
    assert "UPDATE accounts SET first_app_used_at=" in sql
    assert "min(workflow_runs.created_at)" in sql
    assert "accounts.first_app_used_at IS NULL" in sql
