"""Existing SaaS databases apply only the new Installed App connection table and merge."""

from pathlib import Path

from alembic.script import ScriptDirectory


def test_saas_head_upgrades_installed_app_connections_without_replaying_migrations() -> None:
    scripts = ScriptDirectory(str(Path(__file__).resolve().parents[3] / "migrations"))

    assert len(scripts.get_heads()) == 1
    steps = scripts._upgrade_revs("b6c1e9d4f372", "a7d9c2e5f831")
    assert [step.revision.revision for step in steps] == ["72bf1c9d8e40", "c64f2b7a913e", "b6c1e9d4f372"]
