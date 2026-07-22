from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.knowledge_fs_cutover import KnowledgeFSWorkspaceCutoverLedger

_VERSIONS = Path(__file__).resolve().parents[3] / "migrations/versions"
_MIGRATION_PATHS = (
    _VERSIONS / "2026_07_21_1300-b7f2a9d41c60_add_knowledge_fs_cutover.py",
    _VERSIONS / "2026_07_21_1400-c8e31b7d52a4_add_knowledge_fs_cleanup_authorization.py",
    _VERSIONS / "2026_07_21_1500-d4f6e8a1c305_add_knowledge_fs_remote_freeze_evidence.py",
)


def _load(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
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


def test_remote_freeze_migration_matches_ledger_and_is_symmetric() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    cutover, cleanup, freeze = (_load(path) for path in _MIGRATION_PATHS)
    _run(cutover, engine, "upgrade")
    _run(cleanup, engine, "upgrade")
    columns_before = {
        column["name"] for column in sa.inspect(engine).get_columns(KnowledgeFSWorkspaceCutoverLedger.__tablename__)
    }

    _run(freeze, engine, "upgrade")

    inspector = sa.inspect(engine)
    assert {column["name"] for column in inspector.get_columns(KnowledgeFSWorkspaceCutoverLedger.__tablename__)} == set(
        KnowledgeFSWorkspaceCutoverLedger.__table__.columns.keys()
    )
    assert {
        "kfs_workspace_cutover_remote_freeze_fields_ck",
        "kfs_workspace_cutover_remote_freeze_time_ck",
    } <= {
        constraint["name"]
        for constraint in inspector.get_check_constraints(KnowledgeFSWorkspaceCutoverLedger.__tablename__)
    }
    assert freeze.down_revision == "c8e31b7d52a4"

    _run(freeze, engine, "downgrade")

    assert {
        column["name"] for column in sa.inspect(engine).get_columns(KnowledgeFSWorkspaceCutoverLedger.__tablename__)
    } == columns_before
