"""Recent-only backfill and portable personal WebApp schema migration."""

from datetime import datetime, timedelta
from importlib import import_module
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.engine import Engine, create_mock_engine
from sqlalchemy.orm import Session, sessionmaker

from models.account_webapp import AccountWebApp
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.model import App, AppMode, AppStar, EndUser
from tests.helpers.consumer import make_consumer_harness, new_consumer_run
from tests.helpers.end_user_api_key import make_harness

MIGRATION = "migrations.versions.2026_11_04_1200-6a1f3e8c2d47_add_account_webapps"


def test_backfill_seeds_only_owned_recent_usage_and_never_stars(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    harness = make_consumer_harness(sqlite_session_factory, monkeypatch)
    base = harness.oauth.base
    unused = make_harness(base.sessions)
    unsupported = make_harness(base.sessions)
    now = datetime(2026, 11, 4)
    with base.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == base.context.app_id).values(enable_site=False))
        session.execute(sa.update(App).where(App.id == unsupported.context.app_id).values(mode=AppMode.CHAT))
        session.add(new_consumer_run(unsupported, created_at=now + timedelta(days=1)))
        for moment in (now, now - timedelta(days=1), now + timedelta(hours=1)):
            session.add(new_consumer_run(base, created_at=moment))
        for mismatch in ("tenant", "app", "role", "source", "guest", "type"):
            run = new_consumer_run(base, created_at=now + timedelta(days=1))
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
                    account_id=harness.identity.account_id if mismatch == "type" else None,
                )
                session.add(user)
                run.created_by = user.id
            session.add(run)
        for app in (base, unused):
            session.add(
                AppStar(
                    tenant_id=app.context.tenant_id, app_id=app.context.app_id, account_id=harness.identity.account_id
                )
            )
    engine = sqlite_engine
    migration = import_module(MIGRATION)
    with engine.begin() as connection:
        AccountWebApp.metadata.tables[AccountWebApp.__tablename__].drop(connection)
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
    with base.sessions() as session:
        rows = session.scalars(sa.select(AccountWebApp)).all()
        assert len(rows) == 1
        assert rows[0].account_id == harness.identity.account_id
        assert rows[0].tenant_id == base.context.tenant_id
        assert rows[0].app_id == base.context.app_id
        assert rows[0].last_used_at == now + timedelta(hours=1)
        assert rows[0].favorited_at is None
        assert rows[0].removed_at is None
        assert session.scalar(sa.select(sa.func.count()).select_from(AppStar)) == 2

    # Re-running a backfill must not overwrite live collection preferences.
    with base.sessions.begin() as session:
        state = session.scalar(sa.select(AccountWebApp))
        assert state is not None
        state.last_used_at = now + timedelta(days=2)
        state.favorited_at = now + timedelta(days=2)
    with engine.begin() as connection:
        migration.backfill_recent_usage(connection)
    with base.sessions() as session:
        state = session.scalar(sa.select(AccountWebApp))
        assert state is not None
        assert state.last_used_at == now + timedelta(days=2)
        assert state.favorited_at == now + timedelta(days=2)
    with base.sessions.begin() as session:
        state = session.scalar(sa.select(AccountWebApp))
        assert state is not None
        state.favorited_at = None
        state.removed_at = now + timedelta(days=3)
    with engine.begin() as connection:
        migration.backfill_recent_usage(connection)
    with base.sessions() as session:
        state = session.scalar(sa.select(AccountWebApp))
        assert state is not None
        assert state.removed_at == now + timedelta(days=3)
        assert state.favorited_at is None
    with engine.begin() as connection:
        metadata = sa.MetaData()
        AccountWebApp.metadata.tables[AccountWebApp.__tablename__].to_metadata(metadata)
        context = MigrationContext.configure(
            connection,
            opts={
                "compare_type": True,
                "compare_server_default": True,
                "include_name": lambda name, type_, _parents: type_ != "table" or name == "account_webapps",
            },
        )
        assert compare_metadata(context, metadata) == []
        with Operations.context(context):
            migration.downgrade()
        assert not sa.inspect(connection).has_table("account_webapps")
        assert connection.scalar(sa.select(sa.func.count()).select_from(AppStar)) == 2


@pytest.mark.parametrize("dialect", ["postgresql", "mysql", "sqlite"])
def test_backfill_compiles_for_supported_dialects(dialect: str) -> None:
    statements = []
    engine = create_mock_engine(f"{dialect}://", lambda statement, *_args, **_kwargs: statements.append(statement))
    import_module(MIGRATION).backfill_recent_usage(engine.connect())
    assert len(statements) == 1
    sql = str(statements[0].compile(dialect=engine.dialect))
    assert "app_stars" not in sql
    assert "favorited_at" not in sql
    assert "INSERT INTO account_webapps" in sql
