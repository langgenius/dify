"""Policy DDL compiles for both supported deployment databases."""

from io import StringIO

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations

from tests.helpers.builder_migration import load_builder_migration


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_current_policy_migration_is_portable(dialect: str, monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_builder_migration()
    output = StringIO()
    monkeypatch.setattr(
        module,
        "op",
        Operations(MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})),
    )
    module._create_cognition_policies()
    module._drop_cognition_policies()
    sql = output.getvalue()
    assert "CREATE TABLE dify_builder_cognition_policies" in sql
    assert "DROP TABLE dify_builder_cognition_policies" in sql
