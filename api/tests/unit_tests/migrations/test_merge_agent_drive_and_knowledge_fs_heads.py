from __future__ import annotations

import importlib.util
from pathlib import Path

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
    assert ScriptDirectory(str(_MIGRATION_PATH.parents[1])).get_heads() == ["e4c8a2d6f913"]


def test_workflow_pause_merge_joins_knowledge_fs_and_main_heads() -> None:
    merge = ScriptDirectory(str(_MIGRATION_PATH.parents[1])).get_revision("36036059b930")
    assert merge is not None
    # Deployed databases already applied the KnowledgeFS chain on f1d3c5b7a902, so main's
    # later c6f4a90d8b31 joins through a merge instead of re-parenting applied revisions.
    assert merge.down_revision == ("b6e2c4d8f1a0", "c6f4a90d8b31")


def test_workflow_tool_caller_merge_joins_knowledge_fs_and_main_heads() -> None:
    merge = ScriptDirectory(str(_MIGRATION_PATH.parents[1])).get_revision("d7b9e1f3a5c2")
    assert merge is not None
    assert merge.down_revision == ("36036059b930", "a8c3e7f4b912")


def test_tracing_merge_joins_main_and_knowledge_fs_heads() -> None:
    merge = ScriptDirectory(str(_MIGRATION_PATH.parents[1])).get_revision("e4c8a2d6f913")
    assert merge is not None
    assert merge.down_revision == ("d6b9e2f1a407", "b9d3f7a5c102")


def test_clean_legacy_agent_soul_files_keeps_main_parent() -> None:
    scripts = ScriptDirectory(str(_MIGRATION_PATH.parents[1]))
    current = scripts.get_revision("fbdfcf5f5a6e")
    assert current is not None
    # Databases on main already applied this revision on 89919253ca7a; re-parenting it onto the
    # KnowledgeFS merge would make Alembic treat the whole KnowledgeFS chain as applied.
    assert current.down_revision == "89919253ca7a"


def test_dataset_api_token_binding_resource_type_merges_main_and_knowledge_fs() -> None:
    scripts = ScriptDirectory(str(_MIGRATION_PATH.parents[1]))
    current = scripts.get_revision("9a4e7d1c2b60")
    assert current is not None
    assert current.down_revision == ("f1d3c5b7a902", "c4d8e2f7a1b6")
    applied_before = {
        revision.revision for revision in scripts.iterate_revisions(("f1d3c5b7a902", "c4d8e2f7a1b6"), "base")
    }
    assert {"c3f1a9b2e6d4", "a4e7c2f91b30", "e6b4a2c9d731"} <= applied_before


def test_upgrade_from_main_head_applies_knowledge_fs_chain_before_token_bindings() -> None:
    scripts = ScriptDirectory(str(_MIGRATION_PATH.parents[1]))
    applied_on_main = {revision.revision for revision in scripts.iterate_revisions("d6b9e2f1a407", "base")}
    pending = [
        revision.revision
        for revision in reversed(list(scripts.iterate_revisions("heads", "base")))
        if revision.revision not in applied_on_main
    ]

    assert pending[0] == "a4e7c2f91b30"
    assert pending.index("e6b4a2c9d731") < pending.index("c4d8e2f7a1b6") < pending.index("9a4e7d1c2b60")
    assert pending[-5:] == ["d7b9e1f3a5c2", "3edd6cd27f54", "a8c2e6f4b901", "b9d3f7a5c102", "e4c8a2d6f913"]


def test_branch_deployed_databases_keep_knowledge_fs_chain_applied() -> None:
    scripts = ScriptDirectory(str(_MIGRATION_PATH.parents[1]))
    applied = {revision.revision for revision in scripts.iterate_revisions("d7b9e1f3a5c2", "base")}
    assert {"a4e7c2f91b30", "e6b4a2c9d731", "c4d8e2f7a1b6", "fbdfcf5f5a6e", "a8c3e7f4b912"} <= applied
