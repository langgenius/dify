"""The baseline merge joins histories without applying additional schema changes."""

from importlib import import_module
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def test_merge_has_one_head_and_no_schema_operations() -> None:
    migration = import_module("migrations.versions.2026_11_11_1200-8e1a5c7b9d24_merge_end_user_auth_and_im_sync")
    configuration = Config()
    configuration.set_main_option("script_location", str(Path(__file__).resolve().parents[3] / "migrations"))
    scripts = ScriptDirectory.from_config(configuration)

    assert len(scripts.get_heads()) == 1
    assert scripts.get_revision(migration.revision) is not None
    assert set(migration.down_revision) == {"c64f2b7a913e", "6b7e2a9c4d10"}
    assert migration.upgrade() is None
    assert migration.downgrade() is None
