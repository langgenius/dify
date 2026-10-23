from __future__ import annotations

from pathlib import Path

from alembic.script import ScriptDirectory

_VERSIONS = Path(__file__).resolve().parents[3] / "migrations/versions"
_MAIN_HEAD = "d6b9e2f1a407"
# KnowledgeFS revisions run in this order after main's head, without merge revisions.
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


def test_knowledge_fs_chain_ends_in_the_single_head() -> None:
    scripts = _scripts()
    assert scripts.get_heads() == ["e7c2a9f4b603"]
    merged = scripts.get_revision("e7c2a9f4b603")
    assert merged is not None
    assert isinstance(merged.down_revision, tuple)
    assert set(merged.down_revision) == {"c8e3a6d91f02", _KNOWLEDGE_FS_CHAIN[-1], "d64a3c92f810"}


def test_upgrade_from_main_head_applies_knowledge_fs_chain_linearly() -> None:
    scripts = _scripts()
    applied_on_main = {revision.revision for revision in scripts.iterate_revisions(_MAIN_HEAD, "base")}
    pending = [
        revision.revision
        for revision in reversed(list(scripts.iterate_revisions(_KNOWLEDGE_FS_CHAIN[-1], "base")))
        if revision.revision not in applied_on_main
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
