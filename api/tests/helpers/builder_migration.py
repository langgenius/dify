"""Load the single Builder revision for focused migration and schema tests."""

import importlib.util
from pathlib import Path
from types import ModuleType

BUILDER_REVISION = "430a56d97885"
BUILDER_MAIN_REVISION = "f8b6e2c4a901"
KNOWLEDGE_AGENT_REVISION = "6b1d2f4e8a90"
BUILDER_MERGE_REVISION = "998595ace7d2"
MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"
BUILDER_MIGRATION_PATH = MIGRATIONS_DIR / "versions" / "2026_11_23_1100-430a56d97885_add_dify_builder_schema.py"


def load_builder_migration() -> ModuleType:
    """Return a fresh revision module without executing any database operations."""
    spec = importlib.util.spec_from_file_location("builder_schema_migration", BUILDER_MIGRATION_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
