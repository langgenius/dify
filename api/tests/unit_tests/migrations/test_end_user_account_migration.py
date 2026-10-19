import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_account_link_upgrade_and_downgrade_preserve_legacy_users() -> None:
    path = (
        Path(__file__).resolve().parents[3]
        / "migrations/versions/2026_10_16_1000-b27e8d49a103_link_browser_end_users_to_accounts.py"
    )
    spec = importlib.util.spec_from_file_location("end_user_account_migration", path)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE end_users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, "
                "app_id TEXT, type TEXT NOT NULL, session_id TEXT NOT NULL)"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO end_users VALUES ('guest-1', 'tenant', 'app', 'browser', 'session'), "
                "('guest-2', 'tenant', 'app', 'browser', 'session')"
            )
        )
        migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        assert connection.execute(sa.text("SELECT id, account_id FROM end_users ORDER BY id")).all() == [
            ("guest-1", None),
            ("guest-2", None),
        ]
        assert sa.inspect(connection).get_unique_constraints("end_users")[0]["column_names"] == [
            "tenant_id",
            "app_id",
            "type",
            "account_id",
        ]
        migration.downgrade()
        assert "account_id" not in {column["name"] for column in sa.inspect(connection).get_columns("end_users")}
        assert connection.execute(sa.text("SELECT id, session_id FROM end_users ORDER BY id")).all() == [
            ("guest-1", "session"),
            ("guest-2", "session"),
        ]
    engine.dispose()
