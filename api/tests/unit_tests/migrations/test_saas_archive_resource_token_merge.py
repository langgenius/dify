from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory


def test_deployed_archive_revision_still_creates_resource_token_tables() -> None:
    scripts = ScriptDirectory(str(Path(__file__).resolve().parents[3] / "migrations"))
    steps = scripts._upgrade_revs("b4f8c2e6a901", "f1d3c5b7a902")
    assert [step.revision.revision for step in steps] == ["a8c9e2f1b704", "b4f8c2e6a901"]

    engine = sa.create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            context = MigrationContext.configure(connection)
            with Operations.context(context):
                for step in steps:
                    step.migration_fn()

            inspector = sa.inspect(connection)
            assert set(inspector.get_table_names()) == {
                "resource_access_tokens",
                "resource_access_tokens_relation",
            }
            assert any(index["unique"] for index in inspector.get_indexes("resource_access_tokens"))
    finally:
        engine.dispose()


@pytest.mark.parametrize(
    ("deployed_revision", "expected_steps"),
    [
        ("b4f8c2e6a901", ["c6f4a90d8b31", "c8e3a6d91f02"]),
        ("c6f4a90d8b31", ["a8c9e2f1b704", "b4f8c2e6a901", "c8e3a6d91f02"]),
    ],
)
def test_saas_and_main_heads_upgrade_without_replaying_deployed_migrations(
    deployed_revision: str, expected_steps: list[str]
) -> None:
    scripts = ScriptDirectory(str(Path(__file__).resolve().parents[3] / "migrations"))

    steps = scripts._upgrade_revs("c8e3a6d91f02", deployed_revision)

    assert [step.revision.revision for step in steps] == expected_steps
