"""Merge revisions preserve deployed histories and add no schema operations."""

from importlib import import_module
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory


@pytest.mark.parametrize(
    ("module", "parents"),
    [
        (
            "2026_11_05_1200-c64f2b7a913e_merge_end_user_auth_and_main",
            {"53c10126d551", "b43e8c1d9a72", "72bf1c9d8e40", "8d2f6a9c4b71"},
        ),
        (
            "2026_11_11_1200-8e1a5c7b9d24_merge_end_user_auth_and_im_sync",
            {"c64f2b7a913e", "6b7e2a9c4d10"},
        ),
        (
            "2026_11_11_1300-92d7a3f1c6e8_merge_end_user_auth_personal_tokens_and_connections",
            {"b2e4c6d8a013", "e7f1a9c4d602", "8e1a5c7b9d24"},
        ),
        (
            "2026_11_11_1200-d9a72f03b8e1_merge_saas_and_im_sync_heads",
            {"b6c1e9d4f372", "6b7e2a9c4d10"},
        ),
        (
            "2026_11_11_1400-a7c4e2d9f681_merge_saas_and_end_user_auth_heads",
            {"d9a72f03b8e1", "92d7a3f1c6e8"},
        ),
        (
            "2026_11_13_1600-7f3d8c1a9b20_merge_saas_and_message_index_heads",
            {"a7c4e2d9f681", "2c7e9a4b1d60"},
        ),
    ],
)
def test_merge_preserves_parent_revisions_without_schema_operations(module: str, parents: set[str]) -> None:
    """Import each historical merge without a database and preserve its no-op contract."""
    migration = import_module(f"migrations.versions.{module}")

    assert set(migration.down_revision) == parents
    assert migration.upgrade() is None
    assert migration.downgrade() is None


def test_merge_has_one_acyclic_head_reaching_all_existing_revisions() -> None:
    """Require the filesystem graph to converge and remain fully reachable without a database."""
    migration = import_module("migrations.versions.2026_11_13_1600-7f3d8c1a9b20_merge_saas_and_message_index_heads")
    configuration = Config()
    configuration.set_main_option("script_location", str(Path(__file__).resolve().parents[3] / "migrations"))
    scripts = ScriptDirectory.from_config(configuration)

    assert scripts.get_heads() == [migration.revision]
    reachable_revisions = {revision.revision for revision in scripts.iterate_revisions(migration.revision, "base")}
    assert set(migration.down_revision) <= reachable_revisions
    assert reachable_revisions == {revision.revision for revision in scripts.walk_revisions()}
