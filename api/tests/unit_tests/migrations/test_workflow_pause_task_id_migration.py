from __future__ import annotations

import importlib.util
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from flask import Flask
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy

_MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "migrations"
_MIGRATION_PATH = _MIGRATIONS_DIR / "versions/2026_10_10_1200-c6f4a90d8b31_add_workflow_pause_task_id.py"


def _load_migration_module(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_repository_migration_graph_has_one_head() -> None:
    config = Config()
    config.set_main_option("script_location", str(_MIGRATIONS_DIR))
    assert len(ScriptDirectory.from_config(config).get_heads()) == 1


@pytest.mark.parametrize("dialect_name", ["postgresql", "mysql"])
def test_index_uses_concurrent_ddl_outside_postgresql_transactions(dialect_name: str) -> None:
    migration = _load_migration_module(_MIGRATION_PATH)
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name=dialect_name,
        opts={"as_sql": True, "output_buffer": output},
    )
    migration.__dict__["op"] = Operations(context)
    migration.upgrade()
    migration.downgrade()

    statements = [statement.strip() for statement in output.getvalue().split(";") if statement.strip()]
    assert not any(statement.startswith("UPDATE") for statement in statements)
    assert not any(
        "NOT NULL" in statement or "DEFAULT" in statement for statement in statements if "ADD COLUMN" in statement
    )
    if dialect_name == "postgresql":
        create = (
            "CREATE INDEX CONCURRENTLY workflow_run_task_id_idx ON workflow_runs (task_id) WHERE task_id IS NOT NULL"
        )
        drop = "DROP INDEX CONCURRENTLY IF EXISTS workflow_run_task_id_idx"
        index = statements.index(create)
        assert statements[index - 2 : index + 2] == ["COMMIT", drop, create, "BEGIN"]
        assert statements[index + 2 : index + 5] == ["COMMIT", drop, "BEGIN"]
    else:
        assert "CREATE INDEX workflow_run_task_id_idx ON workflow_runs (task_id)" in statements
        assert "DROP INDEX workflow_run_task_id_idx ON workflow_runs" in statements
        assert "CONCURRENTLY" not in output.getvalue()
        assert "IF NOT EXISTS" not in output.getvalue()


def test_alembic_commits_retryable_columns_before_index_and_stamps_revision_afterward(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output = StringIO()
    config = Config(str(_MIGRATIONS_DIR / "alembic.ini"), output_buffer=output)
    config.set_main_option("script_location", str(_MIGRATIONS_DIR))
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "postgresql://"
    database = SQLAlchemy(app)
    Migrate(app, database)
    monkeypatch.setattr("logging.config.fileConfig", lambda _filename: None)

    with app.app_context():
        command.upgrade(config, "f1d3c5b7a902:c6f4a90d8b31", sql=True)
        database.engine.dispose()

    sql = output.getvalue()
    add_task_id = sql.index("ADD COLUMN IF NOT EXISTS task_id")
    add_stop_requested_at = sql.index("ADD COLUMN IF NOT EXISTS stop_requested_at")
    drop_index = sql.index("DROP INDEX CONCURRENTLY IF EXISTS workflow_run_task_id_idx")
    create_index = sql.index("CREATE INDEX CONCURRENTLY workflow_run_task_id_idx")
    stamp_revision = sql.index("UPDATE alembic_version SET version_num='c6f4a90d8b31'")
    assert add_task_id < add_stop_requested_at < sql.index("COMMIT;") < drop_index < create_index < stamp_revision
    assert sql.count("UPDATE alembic_version") == 1


@pytest.mark.parametrize(("existing_column_count", "index_exists"), [(0, False), (1, False), (2, False), (2, True)])
def test_sqlite_upgrade_keeps_historical_rows_nullable_and_downgrade_preserves_rows(
    existing_column_count: int, index_exists: bool
) -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    runs = sa.Table(
        "workflow_runs",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        *[sa.Column("task_id", sa.String(36)), sa.Column("stop_requested_at", sa.DateTime())][:existing_column_count],
    )
    if index_exists:
        sa.Index("workflow_run_task_id_idx", runs.c.task_id)
    metadata.create_all(engine)
    migration = _load_migration_module(_MIGRATION_PATH)

    with engine.begin() as connection:
        connection.execute(runs.insert().values(id="historical-run"))
        if existing_column_count:
            connection.execute(runs.update().values(task_id="historical-task"))
        migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        columns = {column["name"]: column for column in sa.inspect(connection).get_columns("workflow_runs")}
        assert columns["task_id"]["nullable"] is True
        assert columns["stop_requested_at"]["nullable"] is True
        assert columns["task_id"]["default"] is None
        assert columns["stop_requested_at"]["default"] is None
        assert connection.execute(sa.text("SELECT id, task_id, stop_requested_at FROM workflow_runs")).one() == (
            "historical-run",
            "historical-task" if existing_column_count else None,
            None,
        )
        assert sa.inspect(connection).get_indexes("workflow_runs")[0]["name"] == "workflow_run_task_id_idx"

        migration.downgrade()

        assert [column["name"] for column in sa.inspect(connection).get_columns("workflow_runs")] == ["id"]
        assert connection.scalar(sa.text("SELECT id FROM workflow_runs")) == "historical-run"
        assert sa.inspect(connection).get_indexes("workflow_runs") == []

    engine.dispose()


@pytest.mark.parametrize("remaining_column_count", [2, 1, 0])
def test_sqlite_downgrade_resumes_after_index_or_columns_were_dropped(remaining_column_count: int) -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    runs = sa.Table(
        "workflow_runs",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        *[sa.Column("task_id", sa.String(36)), sa.Column("stop_requested_at", sa.DateTime())][:remaining_column_count],
    )
    metadata.create_all(engine)
    migration = _load_migration_module(_MIGRATION_PATH)

    with engine.begin() as connection:
        connection.execute(runs.insert().values(id="historical-run"))
        migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
        migration.downgrade()

        assert [column["name"] for column in sa.inspect(connection).get_columns("workflow_runs")] == ["id"]
        assert connection.scalar(sa.text("SELECT id FROM workflow_runs")) == "historical-run"
        assert sa.inspect(connection).get_indexes("workflow_runs") == []

    engine.dispose()
