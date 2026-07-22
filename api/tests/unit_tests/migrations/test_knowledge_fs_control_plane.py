from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSApiCredential,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSLifecycleOutbox,
)

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_07_21_1200-a4e7c2f91b30_add_knowledge_fs_control_plane.py"
)

_TABLES = {
    "knowledge_fs_control_spaces",
    "knowledge_fs_control_space_permissions",
    "knowledge_fs_external_access_policies",
    "knowledge_fs_api_credentials",
    "app_knowledge_fs_space_joins",
    "knowledge_fs_authorization_revisions",
    "knowledge_fs_capability_issuance_audits",
    "knowledge_fs_lifecycle_outbox",
}

_FORBIDDEN_DEPENDENCIES = ("datasets", "documents", "dataset_permissions", "api_tokens")

_MODELS_BY_TABLE = {
    model.__tablename__: model
    for model in (
        KnowledgeFSControlSpace,
        KnowledgeFSControlSpacePermission,
        KnowledgeFSExternalAccessPolicy,
        KnowledgeFSApiCredential,
        AppKnowledgeFSSpaceJoin,
        KnowledgeFSAuthorizationRevision,
        KnowledgeFSCapabilityIssuanceAudit,
        KnowledgeFSLifecycleOutbox,
    )
}


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("knowledge_fs_control_plane", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_migration_step(module: object, engine: sa.Engine, step_name: str) -> None:
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        operations = Operations(context)
        original_op = module.op
        module.op = operations
        try:
            getattr(module, step_name)()
        finally:
            module.op = original_op


def test_upgrade_creates_only_independent_knowledge_fs_control_plane_tables() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()

    _run_migration_step(module, engine, "upgrade")

    inspector = sa.inspect(engine)
    assert set(inspector.get_table_names()) >= _TABLES
    for table_name in _TABLES:
        migrated_columns = {column["name"] for column in inspector.get_columns(table_name)}
        assert migrated_columns == set(_MODELS_BY_TABLE[table_name].__table__.columns.keys())
        dependency_text = " ".join(
            [
                table_name,
                *migrated_columns,
                *(
                    referred_table
                    for fk in inspector.get_foreign_keys(table_name)
                    if (referred_table := fk.get("referred_table")) is not None
                ),
            ]
        ).lower()
        assert not any(forbidden in dependency_text for forbidden in _FORBIDDEN_DEPENDENCIES)

    workspace_fks = inspector.get_foreign_keys("knowledge_fs_control_spaces")
    assert any(
        fk.get("referred_table") == "tenants"
        and fk.get("referred_columns") == ["id"]
        and (fk.get("options") or {}).get("ondelete") == "RESTRICT"
        for fk in workspace_fks
    )
    control_space_indexes = {
        index["name"]: tuple(index["column_names"]) for index in inspector.get_indexes("knowledge_fs_control_spaces")
    }
    assert control_space_indexes["kfs_control_space_state_updated_idx"] == ("state", "updated_at")


def test_migration_downgrade_is_symmetric() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()

    _run_migration_step(module, engine, "upgrade")
    _run_migration_step(module, engine, "downgrade")

    assert not (_TABLES & set(sa.inspect(engine).get_table_names()))
