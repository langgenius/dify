from __future__ import annotations

import importlib.util
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[4]
    / "migrations/versions/2026_10_21_1300-3edd6cd27f54_limit_active_knowledge_fs_upgrades_on_mysql.py"
)


def _render(dialect_name: str, step: str) -> str:
    spec = importlib.util.spec_from_file_location(_MIGRATION_PATH.stem, _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load MySQL active upgrade uniqueness migration")
    migration: ModuleType = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    output = StringIO()
    context = MigrationContext.configure(dialect_name=dialect_name, opts={"as_sql": True, "output_buffer": output})
    migration.__dict__["op"] = Operations(context)
    {"upgrade": migration.upgrade, "downgrade": migration.downgrade}[step]()
    return output.getvalue()


def test_mysql_unique_index_only_covers_active_jobs() -> None:
    sql = _render("mysql", "upgrade")

    drop = sql.index("DROP INDEX kfs_upgrade_job_active_dataset_uq ON knowledge_fs_upgrade_jobs")
    add = sql.index(
        "ADD COLUMN active_old_dataset_id CHAR(36) GENERATED ALWAYS AS "
        "(CASE WHEN status IN ('queued', 'running') THEN old_dataset_id ELSE NULL END) STORED"
    )
    create = sql.index(
        "CREATE UNIQUE INDEX kfs_upgrade_job_active_dataset_uq ON knowledge_fs_upgrade_jobs "
        "(tenant_id, active_old_dataset_id)"
    )
    assert drop < add < create


def test_mysql_downgrade_restores_index_name_without_rejecting_history() -> None:
    sql = _render("mysql", "downgrade")

    assert "DROP COLUMN active_old_dataset_id" in sql
    assert (
        "CREATE INDEX kfs_upgrade_job_active_dataset_uq ON knowledge_fs_upgrade_jobs (tenant_id, old_dataset_id)" in sql
    )
    assert "CREATE UNIQUE INDEX" not in sql


@pytest.mark.parametrize("step", ["upgrade", "downgrade"])
def test_postgresql_keeps_its_partial_index(step: str) -> None:
    assert _render("postgresql", step) == ""
