from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.knowledge_fs import KnowledgeFSControlSpace

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_08_17_1200-4f8b2c7d9e10_add_knowledge_fs_icon_background.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location(_MIGRATION_PATH.stem, _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load KnowledgeFS icon-background migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(module: object, engine: sa.Engine, step: str) -> None:
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.op
        module.op = operations
        try:
            getattr(module, step)()
        finally:
            module.op = original_op


def test_icon_background_migration_matches_model_and_merges_heads() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE knowledge_fs_control_spaces (id VARCHAR(36) PRIMARY KEY)")
    migration = _load_migration()

    _run(migration, engine, "upgrade")

    columns = {
        column["name"]: column for column in sa.inspect(engine).get_columns(KnowledgeFSControlSpace.__tablename__)
    }
    icon_background = columns["icon_background"]
    assert icon_background["nullable"] is False
    assert icon_background["type"].length == 7
    assert "F0F9FF" in icon_background["default"]
    assert migration.revision == "4f8b2c7d9e10"
    assert migration.down_revision == ("9d4e6f8a1b2c", "56124e050600")

    _run(migration, engine, "downgrade")

    assert "icon_background" not in {
        column["name"] for column in sa.inspect(engine).get_columns(KnowledgeFSControlSpace.__tablename__)
    }
