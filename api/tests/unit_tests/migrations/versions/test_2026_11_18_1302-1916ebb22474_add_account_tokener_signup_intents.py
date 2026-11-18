from __future__ import annotations

import importlib.util
from datetime import datetime
from io import StringIO
from pathlib import Path
from types import ModuleType
from unittest.mock import patch
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.dialects import mysql, postgresql, sqlite
from sqlalchemy.engine import Dialect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateTable

from models.tokener import AccountTokenerSignupIntent
from models.types import StringUUID

_PATH = Path(__file__).resolve().parents[4] / (
    "migrations/versions/2026_11_18_1302-1916ebb22474_add_account_tokener_signup_intents.py"
)
_TABLE = "account_tokener_signup_intents"
_CHECK = "CHECK (consumed_tenant_id IS NULL OR consumed_at IS NOT NULL)"


def _migration() -> ModuleType:
    """Load only the owned revision without executing any migration."""
    spec = importlib.util.spec_from_file_location("account_tokener_signup_intents", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("dialect", [postgresql.dialect(), mysql.dialect(), sqlite.dialect()])
def test_supported_dialect_ddl_preserves_schema_and_only_omits_mysql_check(dialect: Dialect) -> None:
    migration = _migration()
    assert migration.revision == "1916ebb22474"
    assert migration.down_revision == "3bb4ecc03baa"
    output = StringIO()
    context = MigrationContext.configure(dialect=dialect, opts={"as_sql": True, "output_buffer": output})
    with patch.object(migration, "op", Operations(context)):
        migration.upgrade()
        migration.downgrade()
    migration_sql = output.getvalue()
    model_table = AccountTokenerSignupIntent.__table__
    assert isinstance(model_table, sa.Table)
    model_sql = str(CreateTable(model_table).compile(dialect=dialect))
    for ddl in (migration_sql, model_sql):
        assert f"CREATE TABLE {_TABLE}" in ddl
        assert "PRIMARY KEY (account_id)" in ddl
        assert "UNIQUE (consumed_tenant_id)" in ddl
        assert "FOREIGN KEY(account_id) REFERENCES accounts (id) ON DELETE CASCADE" in ddl
        assert "FOREIGN KEY(consumed_tenant_id) REFERENCES tenants (id) ON DELETE SET NULL" in ddl
        assert "plugin_unique_identifier VARCHAR(255)" in ddl
        assert (_CHECK in ddl) is (dialect.name != "mysql")
    assert f"DROP TABLE {_TABLE}" in migration_sql


def test_consumption_check_and_foreign_keys_preserve_tombstone_on_tenant_deletion() -> None:
    """On an isolated schema, reject invalid consumption and preserve its timestamp on tenant deletion."""
    engine = sa.create_engine("sqlite:///:memory:")
    migration = _migration()
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            parents = sa.MetaData()
            accounts = sa.Table("accounts", parents, sa.Column("id", StringUUID(), primary_key=True))
            tenants = sa.Table("tenants", parents, sa.Column("id", StringUUID(), primary_key=True))
            accounts.create(connection)
            tenants.create(connection)
            with patch.object(migration, "op", Operations(MigrationContext.configure(connection))):
                migration.upgrade()
                intent = sa.Table(_TABLE, sa.MetaData(), autoload_with=connection)
                account, other_account, tenant = (str(uuid4()) for _ in range(3))
                connection.execute(accounts.insert(), [{"id": account}, {"id": other_account}])
                connection.execute(tenants.insert().values(id=tenant))

                with pytest.raises(IntegrityError, match="consumed_check"), connection.begin_nested():
                    connection.execute(intent.insert().values(account_id=account, consumed_tenant_id=tenant))

                consumed_at = datetime(2026, 11, 18, 5, 0)
                connection.execute(
                    intent.insert().values(account_id=account, consumed_tenant_id=tenant, consumed_at=consumed_at)
                )
                with pytest.raises(IntegrityError, match="UNIQUE"), connection.begin_nested():
                    connection.execute(
                        intent.insert().values(
                            account_id=other_account, consumed_tenant_id=tenant, consumed_at=consumed_at
                        )
                    )
                with pytest.raises(IntegrityError, match="FOREIGN KEY"), connection.begin_nested():
                    connection.execute(
                        intent.insert().values(
                            account_id=other_account, consumed_tenant_id=str(uuid4()), consumed_at=consumed_at
                        )
                    )

                connection.execute(tenants.delete().where(tenants.c.id == tenant))
                tombstone = connection.execute(sa.select(intent.c.consumed_tenant_id, intent.c.consumed_at)).one()
                assert tombstone == (None, consumed_at)
                assert connection.scalar(sa.select(sa.func.count()).select_from(intent)) == 1

                connection.execute(accounts.delete().where(accounts.c.id == account))
                assert connection.scalar(sa.select(sa.func.count()).select_from(intent)) == 0
                migration.downgrade()
                assert not sa.inspect(connection).has_table(_TABLE)
                assert sa.inspect(connection).has_table("accounts")
                assert sa.inspect(connection).has_table("tenants")
    finally:
        engine.dispose()
