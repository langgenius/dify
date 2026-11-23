"""Builder storage is created directly with its final names on both dialects."""

from io import StringIO

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations

from tests.helpers.builder_migration import load_builder_migration


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_builder_storage_exports_final_indexes_and_constraints(dialect: str) -> None:
    migration = load_builder_migration()
    output = StringIO()
    with Operations.context(
        MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    ):
        migration._create_builder_storage()
        migration._drop_builder_storage()
    sql = output.getvalue()
    assert "workflow_copilot_" not in sql
    assert "CREATE TABLE dify_builder_sessions" in sql
    assert "CREATE INDEX dify_builder_session_tenant_idx" in sql
    assert "CONSTRAINT dify_builder_conversation_item_session_seq_key UNIQUE" in sql
    assert "DROP TABLE dify_builder_sessions" in sql
