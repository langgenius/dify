from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from alembic.script import ScriptDirectory

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_08_20_1200-c4d8e2f7a1b6_merge_agent_drive_and_knowledge_fs_heads.py"
)


def test_merge_migration_produces_a_single_head() -> None:
    spec = importlib.util.spec_from_file_location(_MIGRATION_PATH.stem, _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load agent-drive and KnowledgeFS merge migration")
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    assert migration.revision == "c4d8e2f7a1b6"
    assert migration.down_revision == ("89919253ca7a", "e6b4a2c9d731")
    assert ScriptDirectory(str(_MIGRATION_PATH.parents[1])).get_heads() == ["a9c3e7f1b620"]


def test_email_merge_includes_both_deployed_heads() -> None:
    scripts = ScriptDirectory(str(_MIGRATION_PATH.parents[1]))
    current = scripts.get_revision("f7c8d9e0a1b2")
    assert current is not None
    assert current.down_revision == ("b6e2c4d8f1a0", "d8e4a6b1c902")
    assert current.module.upgrade() is None
    assert current.module.downgrade() is None
    # Each old head has a valid upgrade path through the missing sibling branch to the merge.
    for old_head in current.down_revision:
        pending = list(scripts.iterate_revisions(current.revision, old_head, implicit_base=True))
        assert pending[0].revision == current.revision
        assert old_head not in {revision.revision for revision in pending}
        assert set(current.down_revision) - {old_head} <= {revision.revision for revision in pending}


@pytest.mark.parametrize("old_head", ["f7c8d9e0a1b2", "e7b2a9c4d601"])
def test_current_merge_upgrades_from_either_deployed_head(old_head: str) -> None:
    scripts = ScriptDirectory(str(_MIGRATION_PATH.parents[1]))
    current = scripts.get_revision("head")
    assert current is not None
    assert current.down_revision == ("f7c8d9e0a1b2", "e7b2a9c4d601")
    assert current.module.upgrade() is None
    assert current.module.downgrade() is None

    pending = list(scripts.iterate_revisions("head", old_head, implicit_base=True))
    pending_ids = {revision.revision for revision in pending}
    assert pending[0].revision == current.revision
    assert old_head not in pending_ids
    assert set(current.down_revision) - {old_head} <= pending_ids
    already_applied = {revision.revision for revision in scripts.iterate_revisions(old_head, "base")}
    assert not pending_ids & already_applied


def test_current_merge_accepts_both_heads_already_applied() -> None:
    scripts = ScriptDirectory(str(_MIGRATION_PATH.parents[1]))
    pending = list(scripts.iterate_revisions("head", ("f7c8d9e0a1b2", "e7b2a9c4d601")))
    assert [revision.revision for revision in pending] == ["a9c3e7f1b620"]
