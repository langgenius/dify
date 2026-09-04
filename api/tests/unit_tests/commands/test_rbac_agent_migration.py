import json
from unittest.mock import patch

from click.testing import CliRunner

from commands.rbac import migrate_agent_permissions_to_rbac
from services.enterprise.rbac_service import LegacyAgentMigrationReport, LegacyAgentRoleMigration

MODULE = "commands.rbac"


def _events(output: str) -> list[dict[str, object]]:
    return [json.loads(line) for line in output.splitlines() if line.startswith("{")]


def _roles() -> list[LegacyAgentRoleMigration]:
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


def _report(*, role_templates: list[LegacyAgentRoleMigration] | None = None) -> LegacyAgentMigrationReport:
    kwargs = {} if role_templates is None else {"role_templates": role_templates}
    return LegacyAgentMigrationReport(roles=_roles(), **kwargs)


def test_dry_run_by_default_and_one_event_per_role() -> None:
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
    assert "0 template(s) would change" in result.output


def test_apply_flag_writes_and_reports_applied() -> None:
    with (
        patch(f"{MODULE}._iter_tenant_ids", return_value=iter(["t1", "t2"])),
        patch(
            f"{MODULE}.RBACService.Migrations.migrate_agent_manage_roles",
            return_value=LegacyAgentMigrationReport(roles=_roles()[:1]),
        ) as migrate,
    ):
        result = CliRunner().invoke(migrate_agent_permissions_to_rbac, ["--apply"])

    assert result.exit_code == 0, result.output
    assert migrate.call_count == 2
    assert all(call.kwargs == {"apply": True} for call in migrate.call_args_list)
    events = _events(result.output)
    assert [e["event"] for e in events] == ["agent_manage_role_migration_applied"] * 2
    assert {e["tenant_id"] for e in events} == {"t1", "t2"}
    assert "changed" in result.output


def test_tenant_id_option_limits_scope() -> None:
    with (
        patch(f"{MODULE}._iter_tenant_ids", return_value=iter(["t9"])) as iter_tenants,
        patch(
            f"{MODULE}.RBACService.Migrations.migrate_agent_manage_roles",
            return_value=LegacyAgentMigrationReport(),
        ),
    ):
        result = CliRunner().invoke(migrate_agent_permissions_to_rbac, ["--tenant-id", "t9"])

    assert result.exit_code == 0, result.output
    iter_tenants.assert_called_once_with("t9", batch_size=500)


def test_service_error_stops_with_tenant_in_message() -> None:
    with (
        patch(f"{MODULE}._iter_tenant_ids", return_value=iter(["t1"])),
        patch(f"{MODULE}.RBACService.Migrations.migrate_agent_manage_roles", side_effect=RuntimeError("boom")),
    ):
        result = CliRunner().invoke(migrate_agent_permissions_to_rbac, [])

    assert result.exit_code != 0
    assert "t1" in result.output
    assert "boom" in result.output


def test_role_templates_deduped_across_tenants() -> None:
    template = LegacyAgentRoleMigration(
        role_id="tmpl-1",
        role_name="Agent Manager Template",
        added_keys=["agent.create"],
        removed_keys=["agent.manage"],
        bound_policies=["agent.full_access"],
    )
    reports = [
        LegacyAgentMigrationReport(roles=[], role_templates=[template]),
        LegacyAgentMigrationReport(roles=[], role_templates=[template]),
    ]
    with (
        patch(f"{MODULE}._iter_tenant_ids", return_value=iter(["t1", "t2"])),
        patch(f"{MODULE}.RBACService.Migrations.migrate_agent_manage_roles", side_effect=reports),
    ):
        result = CliRunner().invoke(migrate_agent_permissions_to_rbac, [])

    assert result.exit_code == 0, result.output
    events = _events(result.output)
    template_events = [e for e in events if e["event"] == "agent_manage_role_template_migration_proposed_change"]
    assert len(template_events) == 1
    assert template_events[0]["role_id"] == "tmpl-1"
    assert "tenant_id" not in template_events[0]
    assert "1 template(s) would change" in result.output


def test_role_templates_missing_from_response_does_not_break() -> None:
    with (
        patch(f"{MODULE}._iter_tenant_ids", return_value=iter(["t1"])),
        patch(
            f"{MODULE}.RBACService.Migrations.migrate_agent_manage_roles",
            return_value=LegacyAgentMigrationReport.model_validate({"roles": []}),
        ),
    ):
        result = CliRunner().invoke(migrate_agent_permissions_to_rbac, [])

    assert result.exit_code == 0, result.output
    events = _events(result.output)
    assert events == []
    assert "0 template(s) would change" in result.output


def test_skipped_role_template_is_reported_like_a_skipped_role() -> None:
    template = LegacyAgentRoleMigration(role_id="tmpl-1", role_name="stuck template", skipped="policy row missing")
    with (
        patch(f"{MODULE}._iter_tenant_ids", return_value=iter(["t1"])),
        patch(
            f"{MODULE}.RBACService.Migrations.migrate_agent_manage_roles",
            return_value=LegacyAgentMigrationReport(roles=[], role_templates=[template]),
        ),
    ):
        result = CliRunner().invoke(migrate_agent_permissions_to_rbac, [])

    assert result.exit_code == 0, result.output
    events = _events(result.output)
    assert [e["event"] for e in events] == ["agent_manage_role_template_migration_skipped"]
    assert events[0]["reason"] == "policy row missing"
    assert "tenant_id" not in events[0]
