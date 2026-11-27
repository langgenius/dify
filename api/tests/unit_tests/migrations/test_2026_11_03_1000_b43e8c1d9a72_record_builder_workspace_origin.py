import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


@pytest.mark.parametrize("historical_status", ["normal", "archive"])
def test_upgrade_preserves_legacy_builders_and_leaves_consumers_unactivated(historical_status: str) -> None:
    path = (
        Path(__file__).resolve().parents[3]
        / "migrations/versions/2026_11_03_1000-b43e8c1d9a72_record_builder_workspace_origin.py"
    )
    spec = importlib.util.spec_from_file_location("builder_origin_migration", path)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE accounts (id TEXT PRIMARY KEY, status TEXT NOT NULL, "
                "initialized_at DATETIME, created_at DATETIME NOT NULL)"
            )
        )
        connection.execute(
            sa.text("CREATE TABLE tenants (id TEXT PRIMARY KEY, created_at DATETIME NOT NULL, status TEXT NOT NULL)")
        )
        connection.execute(sa.text("CREATE TABLE tenant_account_joins (account_id TEXT, tenant_id TEXT, role TEXT)"))
        connection.execute(
            sa.text(
                "INSERT INTO accounts VALUES "
                "('owner', 'active', '2020-01-01', '2019-01-01'), "
                "('removed', 'active', '2021-01-01', '2019-01-01'), "
                "('consumer', 'uninitialized', NULL, '2019-01-01'), "
                "('invited', 'pending', NULL, '2019-01-01')"
            )
        )
        connection.execute(
            sa.text("INSERT INTO tenants VALUES ('first', '2020-02-01', :status), ('second', '2022-01-01', 'normal')"),
            {"status": historical_status},
        )
        connection.execute(
            sa.text(
                "INSERT INTO tenant_account_joins VALUES "
                "('owner', 'first', 'owner'), ('owner', 'second', 'owner'), ('invited', 'first', 'normal')"
            )
        )
        migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        assert connection.execute(sa.text("SELECT id, first_workspace_created_at FROM accounts ORDER BY id")).all() == [
            ("consumer", None),
            ("invited", None),
            ("owner", "2020-02-01"),
            ("removed", "2021-01-01"),
        ]
        assert connection.scalar(sa.text("SELECT initialized_at FROM accounts WHERE id = 'owner'")) == "2020-01-01"
        migration.downgrade()
        assert "first_workspace_created_at" not in {
            column["name"] for column in sa.inspect(connection).get_columns("accounts")
        }
