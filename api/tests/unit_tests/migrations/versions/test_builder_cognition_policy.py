"""Policy DDL compiles for both supported deployment databases."""

import importlib.util
from io import StringIO
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_current_policy_migration_is_portable(dialect: str, monkeypatch: pytest.MonkeyPatch) -> None:
    path = Path(__file__).parents[4] / "migrations/versions/2026_10_29_1000-3f51c8a6d902_builder_cognition_policy.py"
    spec = importlib.util.spec_from_file_location("builder_policy_migration", path)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    output = StringIO()
    monkeypatch.setattr(
        module,
        "op",
        Operations(MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})),
    )
    module.upgrade()
    module.downgrade()
    sql = output.getvalue()
    assert "CREATE TABLE dify_builder_cognition_policies" in sql
    assert "DROP TABLE dify_builder_cognition_policies" in sql
    assert module.down_revision == "db7f42c9a801"
