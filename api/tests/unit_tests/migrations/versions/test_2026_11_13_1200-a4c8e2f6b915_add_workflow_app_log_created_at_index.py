import importlib.util
import shutil
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from flask import Flask
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event

from models.workflow import WorkflowAppLog

FILENAME = "2026_11_13_1200-a4c8e2f6b915_add_workflow_app_log_created_at_index.py"


def load_migration() -> ModuleType:
    path = Path(__file__).resolve().parents[4] / "migrations/versions" / FILENAME
    spec = importlib.util.spec_from_file_location("workflow_app_log_created_at_index", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _log_table(metadata: sa.MetaData, migration: ModuleType) -> sa.Table:
    return sa.Table(
        migration.TABLE,
        metadata,
        *(sa.Column(column, sa.String) for column in migration.COLUMNS),
        sa.Column("other", sa.String),
    )


def _index_summary(connection: sa.Connection, table: str) -> list[tuple[str | None, list[str | None], bool]]:
    return [
        (index["name"], index["column_names"], index["unique"]) for index in sa.inspect(connection).get_indexes(table)
    ]


@pytest.mark.parametrize("existing", [False, True])
@pytest.mark.parametrize("populated", [False, True])
def test_upgrade_preserves_rows_and_reuses_the_index(existing: bool, populated: bool) -> None:
    migration = load_migration()
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    table = _log_table(metadata, migration)
    if existing:
        sa.Index(migration.INDEX, *(table.c[column] for column in migration.COLUMNS))
    metadata.create_all(engine)
    ddl: list[str] = []

    @event.listens_for(engine, "before_cursor_execute")
    def record_ddl(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        if statement.strip().startswith(("CREATE INDEX", "DROP INDEX")):
            ddl.append(statement)

    with engine.begin() as connection:
        if populated:
            connection.execute(table.insert().values(tenant_id="tenant", app_id="app", created_at="2026-11-13"))
        migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.upgrade()
        assert len(ddl) == int(not existing)
        indexes = sa.inspect(connection).get_indexes(migration.TABLE)
        assert [(index["name"], index["column_names"]) for index in indexes] == [
            (migration.INDEX, list(migration.COLUMNS))
        ]
        assert connection.scalar(sa.select(sa.func.count()).select_from(table)) == int(populated)
        migration.downgrade()
        migration.downgrade()
        assert len(ddl) == 1 + int(not existing)
        assert sa.inspect(connection).get_indexes(migration.TABLE) == []
    engine.dispose()


@pytest.mark.parametrize("kind", ["wrong_columns", "wrong_order", "unique", "partial"])
def test_conflicting_index_fails_without_changing_it(kind: str) -> None:
    migration = load_migration()
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    table = _log_table(metadata, migration)
    tenant_id, app_id, created_at = (table.c[column] for column in migration.COLUMNS)
    columns = {
        "wrong_columns": (tenant_id, app_id, table.c.other),
        "wrong_order": (app_id, tenant_id, created_at),
    }.get(kind, (tenant_id, app_id, created_at))
    sa.Index(
        migration.INDEX,
        *columns,
        unique=kind == "unique",
        **({"sqlite_where": created_at.is_not(None)} if kind == "partial" else {}),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        before = _index_summary(connection, migration.TABLE)
        migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
        with pytest.raises(RuntimeError, match="invalid or differs"):
            migration.upgrade()
        with pytest.raises(RuntimeError, match="invalid or differs"):
            migration.downgrade()
        assert _index_summary(connection, migration.TABLE) == before
    engine.dispose()


def test_model_index_matches_migration() -> None:
    migration = load_migration()
    assert WorkflowAppLog.__tablename__ == migration.TABLE
    model_table = WorkflowAppLog.__table__
    assert isinstance(model_table, sa.Table)
    index = next(index for index in model_table.indexes if index.name == migration.INDEX)
    assert [column.name for column in index.columns] == list(migration.COLUMNS)
    assert not index.unique


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_offline_migration_emits_ddl_without_silently_skipping_an_existing_index(dialect: str) -> None:
    migration = load_migration()
    output = StringIO()
    context = MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    migration.__dict__["op"] = Operations(context)
    with context.begin_transaction():
        migration.upgrade()
        migration.downgrade()
    sql = output.getvalue()
    statements = [statement.strip() for statement in sql.split(";") if statement.strip()]
    columns = ", ".join(migration.COLUMNS)
    assert "IF NOT EXISTS" not in sql
    assert sql.count("CREATE INDEX") == 1
    assert sql.count("DROP INDEX") == 1
    if dialect == "postgresql":
        create = f"CREATE INDEX CONCURRENTLY {migration.INDEX} ON {migration.TABLE} ({columns})"
        drop = f"DROP INDEX CONCURRENTLY {migration.INDEX}"
        for ddl in (create, drop):
            position = statements.index(ddl)
            assert statements[position - 1] == "COMMIT"
            assert statements[position + 1] == "BEGIN"
    else:
        assert f"CREATE INDEX {migration.INDEX} ON {migration.TABLE} ({columns})" in statements
        assert f"DROP INDEX {migration.INDEX} ON {migration.TABLE}" in statements
        assert "CONCURRENTLY" not in sql


@pytest.mark.parametrize("database_uri", ["postgresql://", "mysql+pymysql://"])
def test_alembic_offline_upgrade_and_downgrade_stamp_revision(
    database_uri: str, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    migration = load_migration()
    migrations = Path(__file__).resolve().parents[4] / "migrations"
    # Exercise the real env.py and this revision without loading unrelated
    # local migration branches. The parent is only a starting revision marker.
    versions = tmp_path / "versions"
    versions.mkdir()
    shutil.copyfile(migrations / "env.py", tmp_path / "env.py")
    shutil.copyfile(migrations / "versions" / FILENAME, versions / FILENAME)
    (versions / "parent.py").write_text(f'revision = "{migration.down_revision}"\ndown_revision = None\n')
    output = StringIO()
    config = Config(str(migrations / "alembic.ini"), output_buffer=output)
    config.set_main_option("script_location", str(tmp_path))
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = database_uri
    database = SQLAlchemy(app)
    Migrate(app, database)
    monkeypatch.setattr("logging.config.fileConfig", lambda _filename: None)
    with app.app_context():
        command.upgrade(config, f"{migration.down_revision}:{migration.revision}", sql=True)
        command.downgrade(config, f"{migration.revision}:{migration.down_revision}", sql=True)
        database.engine.dispose()
    sql = output.getvalue()
    assert sql.count("CREATE INDEX") == 1
    assert sql.count("DROP INDEX") == 1
    upgrade_stamp = sql.index(f"UPDATE alembic_version SET version_num='{migration.revision}'")
    downgrade_stamp = sql.index(f"UPDATE alembic_version SET version_num='{migration.down_revision}'")
    assert sql.index("CREATE INDEX") < upgrade_stamp < sql.index("DROP INDEX")
    assert sql.index("DROP INDEX") < downgrade_stamp
