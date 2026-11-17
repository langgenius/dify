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
        (
            "2026_11_13_1700-9c4a7e2b1d60_merge_saas_and_guest_file_index_heads",
            {"7f3d8c1a9b20", "f8c2a6d4e901"},
        ),
        (
            "2026_11_16_1200-c3a8e5d1f902_merge_saas_and_file_scan_heads",
            {"9c4a7e2b1d60", "9f2c7a6e4b31"},
        ),
        (
            "2026_11_17_1200-3b7a9d1e6c42_merge_end_user_auth_and_evaluation",
            {"92d7a3f1c6e8", "f8b6e2c4a901"},
        ),
        (
            "2026_11_17_1300-e6d2b8c4a913_merge_saas_and_evaluation_heads",
            {"c3a8e5d1f902", "3b7a9d1e6c42"},
        ),
        (
            "2026_11_17_1400-a7e4c9d2b610_merge_end_user_auth_histories",
            {"b6d8f2a4c901", "3b7a9d1e6c42"},
        ),
        (
            "2026_11_17_1500-c4f9a2d6b831_merge_saas_and_end_user_auth_histories",
            {"a7e4c9d2b610", "e6d2b8c4a913"},
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
    migration = import_module("migrations.versions.2026_11_17_1500-c4f9a2d6b831_merge_saas_and_end_user_auth_histories")
    configuration = Config()
    configuration.set_main_option("script_location", str(Path(__file__).resolve().parents[3] / "migrations"))
    scripts = ScriptDirectory.from_config(configuration)

    assert scripts.get_heads() == [migration.revision]
    reachable_revisions = {revision.revision for revision in scripts.iterate_revisions(migration.revision, "base")}
    assert set(migration.down_revision) <= reachable_revisions
    assert reachable_revisions == {revision.revision for revision in scripts.walk_revisions()}


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


def test_evaluation_merge_preserves_both_parents_without_schema_operations() -> None:
    """Require both parent histories and verify the merge has no schema side effects."""
    migration = import_module("migrations.versions.2026_11_17_1115-b6d8f2a4c901_merge_end_user_auth_and_evaluation")

    assert set(migration.down_revision) == {"9f2c7a6e4b31", "f8b6e2c4a901"}
    assert migration.upgrade() is None
    assert migration.downgrade() is None
