from __future__ import annotations

import importlib.util
from datetime import datetime
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_21_1200-b1d5e9fac684_bind_pipeline_execution_logs_to_generation.py"
)


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("pipeline_execution_log_generation", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load pipeline execution log generation migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(module: ModuleType, engine: sa.Engine, step: str) -> None:
    migration_step = module.__dict__[step]
    if not callable(migration_step):
        raise TypeError(f"migration step {step!r} is not callable")
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.__dict__["op"]
        module.__dict__["op"] = operations
        try:
            migration_step()
        finally:
            module.__dict__["op"] = original_op


def test_pipeline_execution_log_generation_backfills_only_latest_legacy_input() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    documents = sa.Table(
        "documents",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("indexing_generation", sa.String(36)),
    )
    logs = sa.Table(
        "document_pipeline_execution_logs",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("document_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(documents.insert(), {"id": "document-1", "indexing_generation": "generation-current"})
        connection.execute(
            logs.insert(),
            [
                {"id": "log-old", "document_id": "document-1", "created_at": datetime(2025, 1, 1)},
                {"id": "log-current", "document_id": "document-1", "created_at": datetime(2025, 2, 1)},
            ],
        )

    migration = _load_migration()
    assert migration.revision == "b1d5e9fac684"
    assert migration.down_revision == "a0c4d8ebf573"
    _run(migration, engine, "upgrade")

    migrated = sa.Table("document_pipeline_execution_logs", sa.MetaData(), autoload_with=engine)
    with engine.connect() as connection:
        rows = connection.execute(
            sa.select(migrated.c.id, migrated.c.indexing_generation).order_by(migrated.c.id)
        ).all()
    assert rows == [("log-current", "generation-current"), ("log-old", None)]
    indexes = {index["name"] for index in sa.inspect(engine).get_indexes("document_pipeline_execution_logs")}
    assert "document_pipeline_execution_logs_document_generation_idx" in indexes

    _run(migration, engine, "downgrade")
    assert "indexing_generation" not in {
        column["name"] for column in sa.inspect(engine).get_columns("document_pipeline_execution_logs")
    }
