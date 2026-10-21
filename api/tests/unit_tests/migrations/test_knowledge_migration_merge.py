import importlib.util
from pathlib import Path
from types import ModuleType

_MIGRATION_PATH = (
    Path(__file__).parents[3]
    / "migrations/versions/2026_10_21_1300-c2e6fab0d795_merge_knowledge_and_workflow_trace_heads.py"
)


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("merge_knowledge_and_workflow_trace_heads", _MIGRATION_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_merge_revision_joins_both_heads_without_schema_operations() -> None:
    migration = _load_migration()

    assert migration.revision == "c2e6fab0d795"
    assert migration.down_revision == ("a8c3e7f4b912", "b1d5e9fac684")
    assert migration.upgrade() is None
    assert migration.downgrade() is None
