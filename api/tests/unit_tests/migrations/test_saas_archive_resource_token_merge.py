from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory


def test_deployed_archive_revision_still_creates_resource_token_tables() -> None:
    scripts = ScriptDirectory(str(Path(__file__).resolve().parents[3] / "migrations"))
    steps = scripts._upgrade_revs("head", "f1d3c5b7a902")
    assert [step.revision.revision for step in steps] == ["a8c9e2f1b704", "b4f8c2e6a901"]
    assert scripts.get_heads() == ["b4f8c2e6a901"]

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
