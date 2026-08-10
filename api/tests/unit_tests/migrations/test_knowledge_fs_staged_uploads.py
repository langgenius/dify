from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.knowledge_fs import KnowledgeFSStagedUpload

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_08_10_1200-7c1e9a4b2d60_add_knowledge_fs_staged_uploads.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location(_MIGRATION_PATH.stem, _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load KnowledgeFS staged-upload migration")
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


def test_staged_upload_migration_matches_model_and_merges_heads() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE tenants (id VARCHAR(36) PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE upload_files (id VARCHAR(36) PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE knowledge_fs_control_spaces ("
            "tenant_id VARCHAR(36) NOT NULL, id VARCHAR(36) NOT NULL, "
            "PRIMARY KEY (id), UNIQUE (tenant_id, id))"
        )
    migration = _load_migration()

    _run(migration, engine, "upgrade")

    table_name = KnowledgeFSStagedUpload.__tablename__
    inspector = sa.inspect(engine)
    assert {column["name"] for column in inspector.get_columns(table_name)} == set(
        KnowledgeFSStagedUpload.__table__.columns.keys()
    )
    assert {index["name"] for index in inspector.get_indexes(table_name)} == {
        "kfs_staged_upload_expiry_idx",
        "kfs_staged_upload_owner_status_expiry_idx",
    }
    assert {constraint["name"] for constraint in inspector.get_check_constraints(table_name)} == {
        "kfs_staged_upload_claimed_fields_ck",
        "kfs_staged_upload_session_scope_ck",
        "kfs_staged_upload_size_ck",
        "kfs_staged_upload_status_ck",
        "kfs_staged_upload_version_ck",
    }
    assert migration.revision == "7c1e9a4b2d60"
    assert migration.down_revision == ("e5a7c9b2d416", "e4708db55c1d")

    _run(migration, engine, "downgrade")

    assert table_name not in sa.inspect(engine).get_table_names()
