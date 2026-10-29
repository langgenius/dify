from __future__ import annotations

from pathlib import Path

from alembic.script import ScriptDirectory

_VERSIONS = Path(__file__).resolve().parents[4] / "migrations/versions"
_MAIN_HEAD = "d6b9e2f1a407"
# This fixed KnowledgeFS interval runs after main's historical head, without merge revisions.
# Later migrations may extend the chain beyond this interval.
_KNOWLEDGE_FS_CHAIN = [
    "a4e7c2f91b30",
    "b7f2a9d41c60",
    "c8e31b7d52a4",
    "d4f6e8a1c305",
    "e5a7c9b2d416",
    "7c1e9a4b2d60",
    "9d4e6f8a1b2c",
    "4f8b2c7d9e10",
    "f3a8c1d7e920",
    "e6b4a2c9d731",
    "9a4e7d1c2b60",
    "b6e2c4d8f1a0",
    "3edd6cd27f54",
    "a8c2e6f4b901",
    "b9d3f7a5c102",
]


def _scripts() -> ScriptDirectory:
    return ScriptDirectory(str(_VERSIONS.parent))


def test_migration_graph_has_a_single_head() -> None:
    assert len(_scripts().get_heads()) == 1


def test_latest_head_includes_knowledge_fs_chain() -> None:
    scripts = _scripts()
    head = scripts.get_current_head()
    assert head is not None
    ancestors = {revision.revision for revision in scripts.iterate_revisions(head, "base")}
    assert _KNOWLEDGE_FS_CHAIN[-1] in ancestors


def test_upgrade_from_main_head_applies_knowledge_fs_chain_linearly() -> None:
    scripts = _scripts()
    pending = [
        revision.revision for revision in reversed(list(scripts.iterate_revisions(_KNOWLEDGE_FS_CHAIN[-1], _MAIN_HEAD)))
    ]

    assert pending == _KNOWLEDGE_FS_CHAIN
    for parent, revision in zip([_MAIN_HEAD, *_KNOWLEDGE_FS_CHAIN[:-1]], _KNOWLEDGE_FS_CHAIN, strict=True):
        script = scripts.get_revision(revision)
        assert script is not None
        assert script.down_revision == parent


def test_clean_legacy_agent_soul_files_keeps_main_parent() -> None:
    current = _scripts().get_revision("fbdfcf5f5a6e")
    assert current is not None
    assert current.down_revision == "89919253ca7a"
