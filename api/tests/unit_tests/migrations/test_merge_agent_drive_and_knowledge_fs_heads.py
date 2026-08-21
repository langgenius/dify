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
    assert ScriptDirectory(str(_MIGRATION_PATH.parents[1])).get_heads() == ["fbdfcf5f5a6e"]
