"""Check Alembic planning and version bookkeeping for the single Builder revision."""

from io import StringIO

import pytest
from alembic.migration import MigrationContext
from alembic.runtime.migration import HeadMaintainer, RevisionStep
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError

from tests.helpers.builder_migration import (
    BUILDER_MAIN_REVISION,
    BUILDER_MERGE_REVISION,
    BUILDER_REVISION,
    KNOWLEDGE_AGENT_REVISION,
    MIGRATIONS_DIR,
)

_RETIRED_REVISIONS = (
    "b28a1b2fbf4d",
    "df1b0114de40",
    "a9cc8d552db4",
    "b6ce72a91f04",
    "c84e6a217b90",
    "d82f9a6c31e0",
    "c67e12a904bf",
    "d28f0e3c912a",
    "f47a1c90d2e8",
    "e59b7d32a6c1",
    "7d2b9c4e61a8",
    "e832a94f210b",
    "3f51c8a6d902",
    "4a62d9b7e013",
    "5b73e0c8f124",
    "6c84f1d90235",
    "7d95a2e61346",
    "c34e2f7b5a10",
)


def _scripts() -> ScriptDirectory:
    """Discover the current revision graph without connecting to a database."""
    return ScriptDirectory(str(MIGRATIONS_DIR))


def _upgrade_steps(directory: ScriptDirectory, starting: str, target: str) -> list[RevisionStep]:
    """Return Alembic's ordered upgrade steps between the supplied checkpoints."""
    revisions = directory.iterate_revisions(target, starting, implicit_base=True)
    return [
        RevisionStep.upgrade_from_script(directory.revision_map, revision) for revision in reversed(list(revisions))
    ]


@pytest.mark.parametrize(
    ("starting", "pending"),
    [(BUILDER_REVISION, KNOWLEDGE_AGENT_REVISION), (KNOWLEDGE_AGENT_REVISION, BUILDER_REVISION)],
)
def test_each_branch_applies_only_the_missing_parent_and_merge(starting: str, pending: str) -> None:
    scripts = _scripts()
    assert scripts.get_heads() == [BUILDER_MERGE_REVISION]
    assert [step.revision.revision for step in _upgrade_steps(scripts, starting, "head")] == [
        pending,
        BUILDER_MERGE_REVISION,
    ]


@pytest.mark.parametrize("revision", _RETIRED_REVISIONS)
def test_intermediate_builder_checkpoints_require_the_previous_checkout(revision: str) -> None:
    with pytest.raises(CommandError, match=f"Can't locate revision identified by '{revision}'"):
        _scripts().get_revision(revision)


@pytest.mark.parametrize("starting", ["base", "e7b2a9c4d601", "f1d3c5b7a902", "53c10126d551", BUILDER_MAIN_REVISION])
def test_main_upgrade_keeps_upstream_steps_and_finishes_at_merged_head(starting: str) -> None:
    scripts = _scripts()
    upstream = _upgrade_steps(scripts, starting, BUILDER_MAIN_REVISION)
    planned = _upgrade_steps(scripts, starting, "head")
    assert [step.revision.revision for step in planned[:-3]] == [step.revision.revision for step in upstream]
    assert {step.revision.revision for step in planned[-3:-1]} == {BUILDER_REVISION, KNOWLEDGE_AGENT_REVISION}
    assert planned[-1].revision.revision == BUILDER_MERGE_REVISION
    initial = () if starting == "base" else (starting,)
    context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": StringIO()})
    maintainer = HeadMaintainer(context, initial)
    for step in planned:
        maintainer.update_to_step(step)
    assert maintainer.heads == {BUILDER_MERGE_REVISION}
