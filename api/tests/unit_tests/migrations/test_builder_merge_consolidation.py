"""Keep historical schema ancestry while removing feature-only empty merges.

These tests exercise Alembic planning and version-table bookkeeping without
executing migration bodies. Database tests separately qualify the actual DDL.
"""

import ast
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.runtime.migration import HeadMaintainer, RevisionStep
from alembic.script import ScriptDirectory
from alembic.script.base import Script
from alembic.script.revision import RevisionMap

_MIGRATIONS = Path(__file__).resolve().parents[3] / "migrations"
_HEAD = "7d95a2e61346"
_REMOVED = {
    "733e4c46f90e": ("a9cc8d552db4", "e7b2a9c4d601"),
    "f9a3c62de418": ("d82f9a6c31e0", "a8c9e2f1b704"),
    "a61e9b2c7d40": ("f9a3c62de418", "f1d3c5b7a902"),
    "d41e6b8c2a75": ("c6f4a90d8b31", "7d2b9c4e61a8"),
    "db7f42c9a801": ("e832a94f210b", "b9d3f7a5c102"),
}
_ORIGINAL_PARENTS = {
    "b6ce72a91f04": "733e4c46f90e",
    "c67e12a904bf": "a61e9b2c7d40",
    "e832a94f210b": "d41e6b8c2a75",
    "3f51c8a6d902": "db7f42c9a801",
}
_COMPACT_PARENTS = {
    "b6ce72a91f04": ("a9cc8d552db4", "e7b2a9c4d601"),
    "c67e12a904bf": ("d82f9a6c31e0", "f1d3c5b7a902"),
    "e832a94f210b": ("c6f4a90d8b31", "7d2b9c4e61a8"),
    "3f51c8a6d902": ("e832a94f210b", "b9d3f7a5c102"),
}

type RevisionMetadata = dict[str, str | tuple[str, ...] | None]


def _metadata() -> dict[str, RevisionMetadata]:
    """Read literal revision metadata only; never import migration modules."""
    result = {}
    for path in sorted((_MIGRATIONS / "versions").glob("*.py")):
        values: RevisionMetadata = {
            target.id: ast.literal_eval(node.value)
            for node in ast.parse(path.read_text()).body
            if isinstance(node, ast.Assign)
            for target in node.targets
            if isinstance(target, ast.Name)
            and target.id in {"revision", "down_revision", "branch_labels", "depends_on"}
        }
        revision = values.get("revision")
        if isinstance(revision, str):
            result[revision] = values
    return result


def _noop() -> None:
    """Supply a callable to Alembic metadata scripts; no migration is run."""


def _directory(metadata: dict[str, RevisionMetadata]) -> ScriptDirectory:
    """Build an Alembic directory whose bodies cannot access a database."""
    scripts = []
    for revision, values in metadata.items():
        module = ModuleType(revision)
        module.__dict__.update(values, upgrade=_noop, downgrade=_noop)
        scripts.append(Script(module, revision, revision))
    directory = ScriptDirectory(str(_MIGRATIONS))
    directory.revision_map = RevisionMap(lambda: iter(scripts))
    return directory


def _old_metadata(current: dict[str, RevisionMetadata]) -> dict[str, RevisionMetadata]:
    """Restore exactly the five historical no-ops and their original children."""
    old = {revision: dict(values) for revision, values in current.items()}
    for revision, parents in _REMOVED.items():
        old[revision] = {
            "revision": revision,
            "down_revision": parents,
            "branch_labels": None,
            "depends_on": None,
        }
    for revision, parent in _ORIGINAL_PARENTS.items():
        old[revision]["down_revision"] = parent
    return old


def _upgrade_steps(directory: ScriptDirectory, starting: str | tuple[str, ...]) -> list[RevisionStep]:
    """Use the public multihead traversal contract to construct native steps."""
    revisions = directory.iterate_revisions("head", starting, implicit_base=True)
    return [
        RevisionStep.upgrade_from_script(directory.revision_map, revision) for revision in reversed(list(revisions))
    ]


_STARTS = [
    "base",
    *sorted(set(_metadata()) - _REMOVED.keys()),
    ("d82f9a6c31e0", "a8c9e2f1b704"),
    ("c6f4a90d8b31", "7d2b9c4e61a8"),
    ("e832a94f210b", "b9d3f7a5c102"),
]


def test_only_final_feature_merge_is_retained() -> None:
    current = _metadata()
    assert not _REMOVED.keys() & current.keys()
    assert current[_HEAD]["down_revision"] == ("6c84f1d90235", "53c10126d551")
    assert _directory(current).get_heads() == [_HEAD]


@pytest.mark.parametrize(("revision", "parents"), _COMPACT_PARENTS.items())
def test_real_migrations_retain_transitively_reduced_parent_dependencies(
    revision: str, parents: tuple[str, ...]
) -> None:
    assert _metadata()[revision]["down_revision"] == parents


@pytest.mark.parametrize("starting", _STARTS)
def test_retained_checkpoint_upgrade_preserves_schema_steps_and_version_rows(starting: str | tuple[str, ...]) -> None:
    """Every retained checkpoint must run the same ordered DDL and reach one head."""
    current = _metadata()
    old, new = _directory(_old_metadata(current)), _directory(current)
    old_plan = _upgrade_steps(old, starting)
    new_plan = _upgrade_steps(new, starting)
    assert [step.revision.revision for step in new_plan] == [
        step.revision.revision for step in old_plan if step.revision.revision not in _REMOVED
    ]
    initial = () if starting == "base" else ((starting,) if isinstance(starting, str) else starting)
    context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": StringIO()})
    maintainer = HeadMaintainer(context, initial)
    for step in new_plan:
        maintainer.update_to_step(step)
    assert maintainer.heads == {_HEAD}
