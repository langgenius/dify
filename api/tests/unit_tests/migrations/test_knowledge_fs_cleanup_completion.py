from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.knowledge_fs_cleanup import KnowledgeFSCleanupAuthorization

_VERSIONS = Path(__file__).resolve().parents[3] / "migrations/versions"
_MIGRATION_PATHS = (
    _VERSIONS / "2026_07_21_1300-b7f2a9d41c60_add_knowledge_fs_cutover.py",
    _VERSIONS / "2026_07_21_1400-c8e31b7d52a4_add_knowledge_fs_cleanup_authorization.py",
    _VERSIONS / "2026_07_21_1500-d4f6e8a1c305_add_knowledge_fs_remote_freeze_evidence.py",
    _VERSIONS / "2026_07_21_1600-e5a7c9b2d416_add_knowledge_fs_cleanup_completion.py",
)
_COMPLETION_COLUMNS = {
    "completed_by_account_id",
    "completed_at",
    "completion_evidence",
    "completed_ledger_cas_version",
}


def _load(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(module: ModuleType, engine: sa.Engine, step: str) -> None:
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        with patch.object(module, "op", operations):
            {"upgrade": module.upgrade, "downgrade": module.downgrade}[step]()


def test_cleanup_completion_migration_matches_model_and_is_symmetric() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    cutover, cleanup, freeze, completion = (_load(path) for path in _MIGRATION_PATHS)
    _run(cutover, engine, "upgrade")
    _run(cleanup, engine, "upgrade")
    _run(freeze, engine, "upgrade")
    table_name = KnowledgeFSCleanupAuthorization.__tablename__
    columns_before = {column["name"] for column in sa.inspect(engine).get_columns(table_name)}

    _run(completion, engine, "upgrade")

    inspector = sa.inspect(engine)
    assert {column["name"] for column in inspector.get_columns(table_name)} == set(
        KnowledgeFSCleanupAuthorization.__table__.columns.keys()
    )
    assert {
        "kfs_cleanup_authorization_completion_time_ck",
        "kfs_cleanup_authorization_ledger_versions_ck",
        "kfs_cleanup_authorization_status_fields_ck",
    } <= {constraint["name"] for constraint in inspector.get_check_constraints(table_name)}
    assert completion.down_revision == "d4f6e8a1c305"

    _run(completion, engine, "downgrade")

    assert {column["name"] for column in sa.inspect(engine).get_columns(table_name)} == columns_before
    assert not (_COMPLETION_COLUMNS & columns_before)


def test_cleanup_completion_downgrade_keeps_completed_rows_as_started() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    modules = [_load(path) for path in _MIGRATION_PATHS]
    for module in modules:
        _run(module, engine, "upgrade")
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO knowledge_fs_cleanup_authorizations ("
                "id, tenant_id, ledger_id, request_id, plan_schema_version, plan_digest, targets,"
                " readiness_evidence, requested_by_account_id, requested_at, readiness_ledger_cas_version,"
                " status, approved_by_account_id, approved_at, approval_expires_at, approved_ledger_cas_version,"
                " started_by_account_id, started_at, started_ledger_cas_version, completed_by_account_id,"
                " completed_at, completion_evidence, completed_ledger_cas_version"
                ") VALUES ("
                "'auth-1', 'tenant-1', 'ledger-1', 'request-1', 'v1', 'sha256:plan', '[]', '{}', 'account-1',"
                " '2026-07-21 10:00:00', 1, 'completed', 'account-2', '2026-07-21 11:00:00',"
                " '2026-07-22 11:00:00', 2, 'account-1', '2026-07-21 12:00:00', 3, 'account-1',"
                " '2026-07-21 13:00:00', '{\"deleted\": 1}', 4)"
            )
        )

    _run(modules[-1], engine, "downgrade")

    with engine.connect() as connection:
        row = connection.execute(
            sa.text(
                "SELECT status, started_by_account_id, started_ledger_cas_version"
                " FROM knowledge_fs_cleanup_authorizations WHERE id = 'auth-1'"
            )
        ).one()
    assert tuple(row) == ("started", "account-1", 3)
