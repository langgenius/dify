"""SaaS deployments can apply consumer indexes through one migration head."""

from pathlib import Path

from alembic.script import ScriptDirectory


def test_saas_head_upgrades_to_consumer_indexes_without_replaying_migrations() -> None:
    scripts = ScriptDirectory(str(Path(__file__).resolve().parents[3] / "migrations"))

    assert scripts.get_heads() == ["f6a2c8e4b901"]
    steps = scripts._upgrade_revs("head", "e4b7c1a9d603")
    assert [step.revision.revision for step in steps] == ["b73e9c40a215", "4f2a90b8c317", "f6a2c8e4b901"]
