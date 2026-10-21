"""The Builder rename retains indexes and unique constraints on both databases."""

import importlib.util
from io import StringIO
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_builder_rename_exports_dialect_specific_index_and_constraint_renames(dialect: str) -> None:
    path = (
        Path(__file__).parents[3]
        / "migrations/versions/2026_08_23_1200-df1b0114de40_rename_workflow_copilot_to_dify_builder.py"
    )
    spec = importlib.util.spec_from_file_location("builder_rename", path)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    output = StringIO()
    migration.__dict__["op"] = Operations(
        MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    )
    migration.upgrade()
    migration.downgrade()
    sql = output.getvalue()
    if dialect == "mysql":
        assert (
            "ALTER TABLE dify_builder_sessions RENAME INDEX workflow_copilot_session_tenant_idx "
            "TO dify_builder_session_tenant_idx" in sql
        )
        assert (
            "ALTER TABLE dify_builder_sessions RENAME INDEX dify_builder_session_tenant_idx "
            "TO workflow_copilot_session_tenant_idx" in sql
        )
        assert (
            "RENAME INDEX workflow_copilot_conversation_item_session_seq_key "
            "TO dify_builder_conversation_item_session_seq_key" in sql
        )
        assert "ALTER INDEX" not in sql
        assert "RENAME CONSTRAINT" not in sql
    else:
        assert 'ALTER INDEX "workflow_copilot_session_tenant_idx" RENAME TO "dify_builder_session_tenant_idx"' in sql
        assert 'RENAME CONSTRAINT "workflow_copilot_session_pkey" TO "dify_builder_session_pkey"' in sql
