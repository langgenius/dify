"""Existing SaaS deployments apply only the new first-use column and merge."""

from pathlib import Path

from alembic.script import ScriptDirectory


def test_saas_head_upgrades_first_app_usage_without_replaying_migrations() -> None:
    scripts = ScriptDirectory(str(Path(__file__).resolve().parents[3] / "migrations"))

    assert len(scripts.get_heads()) == 1
    steps = scripts._upgrade_revs("a7d9c2e5f831", "8c2d5f7a1e64")
    assert [step.revision.revision for step in steps] == ["8d2f6a9c4b71", "a7d9c2e5f831"]
