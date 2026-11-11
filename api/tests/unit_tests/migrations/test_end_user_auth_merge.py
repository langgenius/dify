"""Merge revisions preserve existing histories and add no schema operations."""

from importlib import import_module
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def test_auth_and_im_merge_has_no_schema_operations() -> None:
    migration = import_module("migrations.versions.2026_11_11_1200-8e1a5c7b9d24_merge_end_user_auth_and_im_sync")

    assert set(migration.down_revision) == {"c64f2b7a913e", "6b7e2a9c4d10"}
    assert migration.upgrade() is None
    assert migration.downgrade() is None


def test_merge_has_one_head_and_preserves_all_histories_without_schema_operations() -> None:
    migration = import_module(
        "migrations.versions.2026_11_11_1300-92d7a3f1c6e8_merge_end_user_auth_personal_tokens_and_connections"
    )
    configuration = Config()
    configuration.set_main_option("script_location", str(Path(__file__).resolve().parents[3] / "migrations"))
    scripts = ScriptDirectory.from_config(configuration)

    assert scripts.get_heads() == [migration.revision]
    assert set(migration.down_revision) == {"b2e4c6d8a013", "e7f1a9c4d602", "8e1a5c7b9d24"}
    reachable_revisions = {revision.revision for revision in scripts.iterate_revisions(migration.revision, "base")}
    assert set(migration.down_revision) <= reachable_revisions
    assert reachable_revisions == {revision.revision for revision in scripts.walk_revisions()}
    assert migration.upgrade() is None
    assert migration.downgrade() is None
