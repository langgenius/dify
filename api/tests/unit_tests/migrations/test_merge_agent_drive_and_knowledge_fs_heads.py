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
    assert ScriptDirectory(str(_MIGRATION_PATH.parents[1])).get_heads() == ["d7b9e1f3a5c2"]


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


def test_dataset_api_token_binding_resource_type_follows_main_head() -> None:
    scripts = ScriptDirectory(str(_MIGRATION_PATH.parents[1]))
    current = scripts.get_revision("9a4e7d1c2b60")
    assert current is not None
    # KnowledgeFS migrations after the agent-drive merge sit linearly on main's head, so the
    # dataset_api_token_bindings table they alter already exists.
    assert current.down_revision == "f1d3c5b7a902"
    applied_before = {revision.revision for revision in scripts.iterate_revisions("f1d3c5b7a902", "base")}
    assert "c3f1a9b2e6d4" in applied_before
