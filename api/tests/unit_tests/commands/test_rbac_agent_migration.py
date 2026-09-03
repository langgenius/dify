import json
from unittest.mock import patch

from click.testing import CliRunner

from commands.rbac import migrate_agent_permissions_to_rbac
from services.enterprise.rbac_service import LegacyAgentRoleMigration

MODULE = "commands.rbac"


def _events(output: str) -> list[dict]:
    return [json.loads(line) for line in output.splitlines() if line.startswith("{")]


def _report() -> list[LegacyAgentRoleMigration]:
    return [
        LegacyAgentRoleMigration(
            role_id="r1",
            role_name="ops",
            added_keys=["agent.create"],
            removed_keys=["agent.manage"],
            bound_policies=["agent.full_access"],
        ),
        LegacyAgentRoleMigration(role_id="r2", role_name="stuck", skipped="policy row missing"),
    ]


def test_dry_run_by_default_and_one_event_per_role():
    with (
        patch(f"{MODULE}._iter_tenant_ids", return_value=iter(["t1"])),
        patch(f"{MODULE}.RBACService.Migrations.migrate_agent_manage_roles", return_value=_report()) as migrate,
    ):
        result = CliRunner().invoke(migrate_agent_permissions_to_rbac, [])

    assert result.exit_code == 0, result.output
    migrate.assert_called_once_with("t1", apply=False)
    events = _events(result.output)
    assert [e["event"] for e in events] == [
        "agent_manage_role_migration_proposed_change",
        "agent_manage_role_migration_skipped",
    ]
    assert events[0]["dry_run"] is True
    assert events[0]["after"] == {
        "added_keys": ["agent.create"],
        "removed_keys": ["agent.manage"],
        "bound_policies": ["agent.full_access"],
    }
    assert events[1]["reason"] == "policy row missing"
    assert "dry run" in result.output.lower()
    assert "would change" in result.output


def test_apply_flag_writes_and_reports_applied():
    with (
        patch(f"{MODULE}._iter_tenant_ids", return_value=iter(["t1", "t2"])),
        patch(f"{MODULE}.RBACService.Migrations.migrate_agent_manage_roles", return_value=_report()[:1]) as migrate,
    ):
        result = CliRunner().invoke(migrate_agent_permissions_to_rbac, ["--apply"])

    assert result.exit_code == 0, result.output
    assert migrate.call_count == 2
    assert all(call.kwargs == {"apply": True} for call in migrate.call_args_list)
    events = _events(result.output)
    assert [e["event"] for e in events] == ["agent_manage_role_migration_applied"] * 2
    assert {e["tenant_id"] for e in events} == {"t1", "t2"}
    assert "changed" in result.output


def test_tenant_id_option_limits_scope():
    with (
        patch(f"{MODULE}._iter_tenant_ids", return_value=iter(["t9"])) as iter_tenants,
        patch(f"{MODULE}.RBACService.Migrations.migrate_agent_manage_roles", return_value=[]),
    ):
        result = CliRunner().invoke(migrate_agent_permissions_to_rbac, ["--tenant-id", "t9"])

    assert result.exit_code == 0, result.output
    iter_tenants.assert_called_once_with("t9", batch_size=500)


def test_service_error_stops_with_tenant_in_message():
    with (
        patch(f"{MODULE}._iter_tenant_ids", return_value=iter(["t1"])),
        patch(f"{MODULE}.RBACService.Migrations.migrate_agent_manage_roles", side_effect=RuntimeError("boom")),
    ):
        result = CliRunner().invoke(migrate_agent_permissions_to_rbac, [])

    assert result.exit_code != 0
    assert "t1" in result.output
    assert "boom" in result.output
