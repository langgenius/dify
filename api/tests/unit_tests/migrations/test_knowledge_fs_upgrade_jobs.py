from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.knowledge_fs import (
    KnowledgeFSUpgradeDocument,
    KnowledgeFSUpgradeFileLease,
    KnowledgeFSUpgradeJob,
    KnowledgeFSUpgradeSource,
)

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_08_17_1200-f3a8c1d7e920_add_knowledge_fs_upgrade_jobs.py"
)
_MODELS = (
    KnowledgeFSUpgradeJob,
    KnowledgeFSUpgradeDocument,
    KnowledgeFSUpgradeSource,
    KnowledgeFSUpgradeFileLease,
)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("knowledge_fs_upgrade_jobs", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_step(module: object, engine: sa.Engine, step_name: str) -> None:
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.op
        module.op = operations
        try:
            getattr(module, step_name)()
        finally:
            module.op = original_op


def test_upgrade_schema_matches_upgrade_models_and_downgrades_cleanly() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()

    _run_step(module, engine, "upgrade")

    inspector = sa.inspect(engine)
    assert set(inspector.get_table_names()) == {model.__tablename__ for model in _MODELS}
    for model in _MODELS:
        migrated_columns = {column["name"] for column in inspector.get_columns(model.__tablename__)}
        assert migrated_columns == set(model.__table__.columns.keys())

    _run_step(module, engine, "downgrade")
    assert sa.inspect(engine).get_table_names() == []
