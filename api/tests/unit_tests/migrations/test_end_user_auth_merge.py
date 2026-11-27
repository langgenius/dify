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


def test_auth_tokens_and_connections_merge_has_no_schema_operations() -> None:
    migration = import_module(
        "migrations.versions.2026_11_11_1300-92d7a3f1c6e8_merge_end_user_auth_personal_tokens_and_connections"
    )
    assert set(migration.down_revision) == {"b2e4c6d8a013", "e7f1a9c4d602", "8e1a5c7b9d24"}
    assert migration.upgrade() is None
    assert migration.downgrade() is None


def test_auth_and_evaluation_merge_has_no_schema_operations() -> None:
    migration = import_module("migrations.versions.2026_11_17_1200-3b7a9d1e6c42_merge_end_user_auth_and_evaluation")

    assert set(migration.down_revision) == {"92d7a3f1c6e8", "f8b6e2c4a901"}
    assert migration.upgrade() is None
    assert migration.downgrade() is None


def test_auth_merge_preserves_both_histories_without_schema_operations() -> None:
    migration = import_module("migrations.versions.2026_11_17_1400-a7e4c9d2b610_merge_end_user_auth_histories")
    configuration = Config()
    configuration.set_main_option("script_location", str(Path(__file__).resolve().parents[3] / "migrations"))
    scripts = ScriptDirectory.from_config(configuration)

    assert set(migration.down_revision) == {"b6d8f2a4c901", "3b7a9d1e6c42"}
    reachable_revisions = {revision.revision for revision in scripts.iterate_revisions(migration.revision, "base")}
    assert set(migration.down_revision) <= reachable_revisions
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


def test_evaluation_merge_preserves_both_parents_without_schema_operations() -> None:
    """Require both parent histories and verify the merge has no schema side effects."""
    migration = import_module("migrations.versions.2026_11_17_1115-b6d8f2a4c901_merge_end_user_auth_and_evaluation")

    assert set(migration.down_revision) == {"9f2c7a6e4b31", "f8b6e2c4a901"}
    assert migration.upgrade() is None
    assert migration.downgrade() is None


def test_onboarding_merge_preserves_both_histories_under_one_head() -> None:
    migration = import_module("migrations.versions.2026_11_26_1730-151fcf64f8b2_merge_end_user_auth_and_onboarding")
    configuration = Config()
    configuration.set_main_option("script_location", str(Path(__file__).resolve().parents[3] / "migrations"))
    scripts = ScriptDirectory.from_config(configuration)

    head = scripts.get_current_head()
    assert head is not None
    assert set(migration.down_revision) == {"a7e4c9d2b610", "c17c8ae11622"}
    reachable = {revision.revision for revision in scripts.iterate_revisions(head, "base")}
    assert {migration.revision, *migration.down_revision} <= reachable
    assert reachable == {revision.revision for revision in scripts.walk_revisions()}
    assert migration.upgrade() is None
    assert migration.downgrade() is None


def test_knowledge_agent_merge_preserves_both_histories_under_one_head() -> None:
    """Verify upgrades have one head and preserve both published revision IDs."""
    migration = import_module(
        "migrations.versions.2026_11_27_1534-d6f48fa54d9b_merge_end_user_auth_and_knowledge_agent"
    )
    configuration = Config()
    configuration.set_main_option("script_location", str(Path(__file__).resolve().parents[3] / "migrations"))
    scripts = ScriptDirectory.from_config(configuration)

    assert set(migration.down_revision) == {"151fcf64f8b2", "6b1d2f4e8a90"}
    head = scripts.get_current_head()
    assert head is not None
    reachable = {revision.revision for revision in scripts.iterate_revisions(head, "base")}
    assert {migration.revision, *migration.down_revision} <= reachable
    assert migration.upgrade() is None
    assert migration.downgrade() is None
