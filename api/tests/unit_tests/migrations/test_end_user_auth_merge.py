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


def test_personal_token_merge_preserves_file_index_history_without_schema_operations() -> None:
    """Require both parent revisions and verify that merging has no schema side effects."""
    migration = import_module(
        "migrations.versions.2026_11_13_1600-7d4b1c8e6a20_merge_end_user_auth_and_personal_tokens"
    )

    assert set(migration.down_revision) == {"f8c2a6d4e901", "b2e4c6d8a013"}
    assert migration.upgrade() is None
    assert migration.downgrade() is None


def test_file_scan_merge_preserves_both_histories_without_schema_operations() -> None:
    """Require both parent revisions and verify a single head without schema side effects."""
    migration = import_module("migrations.versions.2026_11_13_1800-9f2c7a6e4b31_merge_end_user_auth_and_file_scan")
    configuration = Config()
    configuration.set_main_option("script_location", str(Path(__file__).resolve().parents[3] / "migrations"))
    scripts = ScriptDirectory.from_config(configuration)

    head = scripts.get_current_head()
    assert head is not None
    assert migration.revision in {revision.revision for revision in scripts.iterate_revisions(head, "base")}
    assert set(migration.down_revision) == {"7d4b1c8e6a20", "8c2f5d7a1e30"}
    assert all(scripts.get_revision(parent) is not None for parent in migration.down_revision)
    assert migration.upgrade() is None
    assert migration.downgrade() is None
