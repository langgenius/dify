"""Exercise the repair against real SQLAlchemy tables and Alembic operations."""

import importlib.util
from collections.abc import Iterator
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _migration() -> ModuleType:
    """Load the real revision without importing the unrelated application graph."""
    path = Path(__file__).resolve().parents[4] / (
        "migrations/versions/2026_11_20_1400-c1120oauthfix_repair_oauth_provider_app_auto_authorize.py"
    )
    spec = importlib.util.spec_from_file_location("repair_oauth_provider_app_auto_authorize", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def connection() -> Iterator[sa.Connection]:
    """Provide one real in-memory database transaction and dispose it afterward."""
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        yield connection
    engine.dispose()


def test_missing_column_preserves_rows_and_defaults_old_and_new_apps_to_false(connection: sa.Connection) -> None:
    table = sa.Table("oauth_provider_apps", sa.MetaData(), sa.Column("id", sa.Integer, primary_key=True))
    table.create(connection)
    connection.execute(table.insert(), [{"id": 1}, {"id": 2}])
    migration = _migration()
    with Operations.context(MigrationContext.configure(connection)):
        migration.upgrade()
        migration.upgrade()
    reflected = sa.Table("oauth_provider_apps", sa.MetaData(), autoload_with=connection)
    connection.execute(reflected.insert().values(id=3))
    assert connection.execute(sa.select(reflected).order_by(reflected.c.id)).all() == [
        (1, False),
        (2, False),
        (3, False),
    ]
    assert not reflected.c.auto_authorize.nullable


def test_existing_true_and_false_flags_survive_upgrade_and_downgrade(connection: sa.Connection) -> None:
    table = sa.Table(
        "oauth_provider_apps",
        sa.MetaData(),
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("auto_authorize", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    table.create(connection)
    connection.execute(table.insert(), [{"id": 1, "auto_authorize": True}, {"id": 2, "auto_authorize": False}])
    migration = _migration()
    with Operations.context(MigrationContext.configure(connection)):
        migration.upgrade()
        migration.upgrade()
        migration.downgrade()
    assert connection.execute(sa.select(table).order_by(table.c.id)).all() == [(1, True), (2, False)]


@pytest.mark.parametrize(
    ("column_type", "nullable", "server_default"),
    [
        (sa.Integer(), False, "false"),
        (sa.Boolean(), True, "false"),
        (sa.Boolean(), False, "true"),
        (sa.Boolean(), False, None),
    ],
)
def test_incompatible_existing_column_fails_without_changing_rows(
    connection: sa.Connection, column_type: sa.types.TypeEngine, nullable: bool, server_default: str | None
) -> None:
    table = sa.Table(
        "oauth_provider_apps",
        sa.MetaData(),
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "auto_authorize",
            column_type,
            nullable=nullable,
            server_default=sa.text(server_default) if server_default is not None else None,
        ),
    )
    table.create(connection)
    connection.execute(table.insert().values(id=1, auto_authorize=True))
    before = connection.execute(sa.select(table)).all()
    migration = _migration()
    with Operations.context(MigrationContext.configure(connection)):
        with pytest.raises(RuntimeError, match="must be Boolean NOT NULL with DEFAULT false"):
            migration.upgrade()
    assert connection.execute(sa.select(table)).all() == before


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_offline_sql_adds_false_flag_and_never_drops_the_predecessor_column(dialect: str) -> None:
    output = StringIO()
    context = MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    migration = _migration()
    with Operations.context(context):
        migration.upgrade()
        migration.downgrade()
    sql = output.getvalue()
    assert "ALTER TABLE oauth_provider_apps ADD COLUMN auto_authorize" in sql
    assert "NOT NULL DEFAULT false" in sql or "DEFAULT false NOT NULL" in sql
    assert "DROP" not in sql
