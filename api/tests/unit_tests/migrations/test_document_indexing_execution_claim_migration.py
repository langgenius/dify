from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_20_1600-b5d9e3f6a028_add_document_indexing_execution_claim.py"
)


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("document_indexing_execution_claim", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load document indexing execution claim migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(module: ModuleType, engine: sa.Engine, step: str) -> None:
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.__dict__["op"]
        module.__dict__["op"] = operations
        try:
            getattr(module, step)()
        finally:
            module.__dict__["op"] = original_op


def test_document_indexing_execution_claim_migration_round_trip() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    sa.Table("documents", metadata, sa.Column("id", sa.String(255), primary_key=True))
    metadata.create_all(engine)
    module = _load_migration()

    assert module.revision == "b5d9e3f6a028"
    assert module.down_revision == "a4c8d2e5f917"

    _run(module, engine, "upgrade")
    columns = {column["name"]: column for column in sa.inspect(engine).get_columns("documents")}
    execution_column = columns["indexing_execution_id"]
    assert execution_column["nullable"] is True
    execution_column_type = execution_column["type"]
    assert isinstance(execution_column_type, sa.String)
    assert execution_column_type.length == 36

    _run(module, engine, "downgrade")
    assert "indexing_execution_id" not in {column["name"] for column in sa.inspect(engine).get_columns("documents")}
