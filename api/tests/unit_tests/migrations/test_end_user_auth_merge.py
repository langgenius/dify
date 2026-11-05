"""The baseline merge joins histories without applying additional schema changes."""

from importlib import import_module
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def test_merge_has_one_head_and_no_schema_operations() -> None:
    migration = import_module("migrations.versions.2026_11_05_1200-c64f2b7a913e_merge_end_user_auth_and_main")
    configuration = Config()
    configuration.set_main_option("script_location", str(Path(__file__).resolve().parents[3] / "migrations"))
    scripts = ScriptDirectory.from_config(configuration)

    assert scripts.get_heads() == [migration.revision]
    assert set(migration.down_revision) == {"53c10126d551", "b43e8c1d9a72", "72bf1c9d8e40", "8d2f6a9c4b71"}
    assert migration.upgrade() is None
    assert migration.downgrade() is None
