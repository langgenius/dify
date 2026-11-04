"""SaaS deployments can apply Account WebApp migrations through one head."""

from pathlib import Path

from alembic.script import ScriptDirectory


def test_saas_head_upgrades_account_webapps_without_replaying_migrations() -> None:
    scripts = ScriptDirectory(str(Path(__file__).resolve().parents[3] / "migrations"))

    assert len(scripts.get_heads()) == 1
    steps = scripts._upgrade_revs("8c2d5f7a1e64", "f6a2c8e4b901")
    revisions = {step.revision.revision for step in steps}
    assert revisions == {"b43e8c1d9a72", "6a1f3e8c2d47", "8c2d5f7a1e64"}
