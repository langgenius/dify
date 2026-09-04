import json
from collections.abc import Iterator
from contextlib import ExitStack
from dataclasses import dataclass, field
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner, Result
from sqlalchemy import Select

from commands.rbac import _iter_agent_rows as real_iter_agent_rows
from commands.rbac import migrate_agent_permissions_to_rbac
from models import AgentStatus
from services.enterprise.rbac_service import (
    LegacyAgentMigrationReport,
    LegacyAgentRoleMigration,
    _LegacyResourceWhitelistConfig,
)

MODULE = "commands.rbac"


def _events(output: str) -> list[dict[str, object]]:
    return [json.loads(line) for line in output.splitlines() if line.startswith("{")]


@pytest.fixture(autouse=True)
def _no_agents() -> Iterator[None]:
    """Phase 2 always runs, so keep it off the database unless a test supplies agent rows."""
    with patch(f"{MODULE}._iter_agent_rows", return_value=iter(())):
        yield


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


def _whitelist_config(
    scope: str | None = "all",
    account_ids: list[str] | None = None,
    configured: bool | None = None,
) -> _LegacyResourceWhitelistConfig:
    return _LegacyResourceWhitelistConfig(
        rbac_whitelist_scope=scope, account_ids=account_ids or [], configured=configured
    )


@dataclass
class _AgentPhaseMocks:
    agent_whitelist_config: MagicMock
    app_whitelist_config: MagicMock
    replace_whitelist: MagicMock
    replace_user_access_policies: MagicMock
    sync_creator_bindings: MagicMock
    owner_account_id: MagicMock
    member_batches: MagicMock
    write_order: MagicMock


@dataclass
class _AgentPhaseSetup:
    agents: list[tuple[str, str | None, str | None]]
    agent_configs: list[_LegacyResourceWhitelistConfig] | None = None
    app_config: _LegacyResourceWhitelistConfig = field(default_factory=_whitelist_config)
    workspace_members: list[str] = field(default_factory=lambda: ["m1", "m2", "m3"])
    owner_account_id: str = "owner-1"
    member_write_side_effect: list[object] | None = None


def _run_agent_phase(args: list[str], setup: _AgentPhaseSetup) -> tuple[Result, _AgentPhaseMocks]:
    def _member_batches(_tenant_id: str, batch_size: int) -> Iterator[list[str]]:
        for start in range(0, len(setup.workspace_members), batch_size):
            yield setup.workspace_members[start : start + batch_size]

    with ExitStack() as stack:
        stack.enter_context(patch(f"{MODULE}._iter_tenant_ids", return_value=iter(["t1"])))
        stack.enter_context(
            patch(
                f"{MODULE}.RBACService.Migrations.migrate_agent_manage_roles",
                return_value=LegacyAgentMigrationReport(),
            )
        )
        stack.enter_context(patch(f"{MODULE}._iter_agent_rows", return_value=iter(setup.agents)))
        agent_whitelist_config = stack.enter_context(patch(f"{MODULE}.RBACService.AgentAccess.legacy_whitelist_config"))
        if setup.agent_configs is None:
            agent_whitelist_config.return_value = _whitelist_config()
        else:
            agent_whitelist_config.side_effect = setup.agent_configs
        mocks = _AgentPhaseMocks(
            agent_whitelist_config=agent_whitelist_config,
            app_whitelist_config=stack.enter_context(
                patch(f"{MODULE}.RBACService.AppAccess.legacy_whitelist_config", return_value=setup.app_config)
            ),
            replace_whitelist=stack.enter_context(patch(f"{MODULE}.RBACService.AgentAccess.replace_whitelist")),
            replace_user_access_policies=stack.enter_context(
                patch(f"{MODULE}.RBACService.AgentAccess.replace_user_access_policies")
            ),
            sync_creator_bindings=stack.enter_context(
                patch(f"{MODULE}.RBACService.AccessPolicies.sync_creator_access_policy_member_bindings")
            ),
            owner_account_id=stack.enter_context(
                patch(f"{MODULE}._owner_account_id", return_value=setup.owner_account_id)
            ),
            member_batches=stack.enter_context(
                patch(f"{MODULE}._workspace_member_account_id_batches", side_effect=_member_batches)
            ),
            write_order=MagicMock(),
        )
        if setup.member_write_side_effect is not None:
            mocks.replace_user_access_policies.side_effect = setup.member_write_side_effect
        # Attaching the write mocks to one parent records them on a single ordered call log.
        mocks.write_order.attach_mock(mocks.replace_user_access_policies, "seed_members")
        mocks.write_order.attach_mock(mocks.sync_creator_bindings, "sync_creator")
        mocks.write_order.attach_mock(mocks.replace_whitelist, "replace_whitelist")
        result = CliRunner().invoke(migrate_agent_permissions_to_rbac, args)
    return result, mocks


def _write_order(mocks: _AgentPhaseMocks) -> list[str]:
    return [name for name, _, _ in mocks.write_order.mock_calls]


def test_agent_bootstrap_dry_run_proposes_every_agent_and_writes_nothing() -> None:
    result, mocks = _run_agent_phase([], _AgentPhaseSetup(agents=[("ag1", "c1", None), ("ag2", "c2", None)]))

    assert result.exit_code == 0, result.output
    events = _events(result.output)
    assert [e["event"] for e in events] == ["agent_access_bootstrap_proposed_change"] * 2
    assert [e["agent_id"] for e in events] == ["ag1", "ag2"]
    assert events[0]["dry_run"] is True
    assert events[0]["operator_account_id"] == "c1"
    assert events[0]["before"] == {"rbac_whitelist_scope": "all", "whitelist_account_ids": []}
    assert events[0]["after"] == {
        "automatic_include_workspace_members": True,
        "default_policy_member_source": "workspace_members",
        "creator_access_policy_synced": True,
    }
    mocks.replace_whitelist.assert_not_called()
    mocks.replace_user_access_policies.assert_not_called()
    mocks.sync_creator_bindings.assert_not_called()
    assert "2 agent(s) would change, 0 already initialised" in result.output


def test_agent_bootstrap_apply_writes_whitelist_member_batches_and_creator_sync() -> None:
    result, mocks = _run_agent_phase(
        ["--apply", "--member-batch-size", "2"],
        _AgentPhaseSetup(agents=[("ag1", "c1", None)], workspace_members=["m1", "m2", "m3"]),
    )

    assert result.exit_code == 0, result.output
    assert [e["event"] for e in _events(result.output)] == ["agent_access_bootstrap_applied"]
    assert _events(result.output)[0]["dry_run"] is False

    mocks.replace_whitelist.assert_called_once()
    assert mocks.replace_whitelist.call_args.kwargs["agent_id"] == "ag1"
    assert mocks.replace_whitelist.call_args.kwargs["account_id"] == "c1"
    assert mocks.replace_whitelist.call_args.kwargs["payload"].automatic_include_workspace_members is True

    mocks.member_batches.assert_called_once_with("t1", 2)
    assert mocks.replace_user_access_policies.call_count == 2
    calls = mocks.replace_user_access_policies.call_args_list
    assert [call.kwargs["payload"].account_ids for call in calls] == [["m1", "m2"], ["m3"]]
    assert all(call.kwargs["payload"].access_policy_ids == ["default"] for call in calls)
    assert all(call.kwargs["target_account_id"] is None for call in calls)

    mocks.sync_creator_bindings.assert_called_once()
    assert mocks.sync_creator_bindings.call_args.kwargs["resource_id"] == "ag1"
    assert mocks.sync_creator_bindings.call_args.kwargs["account_id"] == "c1"
    assert "1 agent(s) changed, 0 already initialised" in result.output


def test_scope_row_is_written_after_every_member_batch() -> None:
    """A crash before the last write must leave no scope row, so the next run redoes the agent."""
    _, mocks = _run_agent_phase(
        ["--apply", "--member-batch-size", "2"],
        _AgentPhaseSetup(agents=[("ag1", "c1", None)], workspace_members=["m1", "m2", "m3"]),
    )

    assert _write_order(mocks) == ["seed_members", "seed_members", "sync_creator", "replace_whitelist"]


def test_configured_false_with_members_present_is_still_bootstrapped() -> None:
    """A run that died part-way leaves seeded members but no scope row; resume it."""
    result, mocks = _run_agent_phase(
        ["--apply"],
        _AgentPhaseSetup(
            agents=[("ag1", "c1", None)],
            agent_configs=[_whitelist_config(account_ids=["m1", "m2"], configured=False)],
        ),
    )

    assert result.exit_code == 0, result.output
    assert [e["event"] for e in _events(result.output)] == ["agent_access_bootstrap_applied"]
    mocks.replace_whitelist.assert_called_once()
    assert "1 agent(s) changed, 0 already initialised" in result.output


def test_configured_true_without_members_is_skipped() -> None:
    result, mocks = _run_agent_phase(
        ["--apply"],
        _AgentPhaseSetup(agents=[("ag1", "c1", None)], agent_configs=[_whitelist_config(configured=True)]),
    )

    assert result.exit_code == 0, result.output
    events = _events(result.output)
    assert [e["event"] for e in events] == ["agent_access_bootstrap_skipped"]
    assert events[0]["reason"] == "already_initialized"
    mocks.replace_whitelist.assert_not_called()
    assert "0 agent(s) changed, 1 already initialised" in result.output


def test_older_service_without_configured_key_falls_back_to_the_heuristic() -> None:
    older_service_body = _LegacyResourceWhitelistConfig.model_validate({"scope": "all", "account_ids": ["m1"]})
    assert older_service_body.configured is None

    result, mocks = _run_agent_phase(
        ["--apply"], _AgentPhaseSetup(agents=[("ag1", "c1", None)], agent_configs=[older_service_body])
    )

    assert result.exit_code == 0, result.output
    assert [e["event"] for e in _events(result.output)] == ["agent_access_bootstrap_skipped"]
    mocks.replace_whitelist.assert_not_called()


def test_a_failed_member_batch_reports_the_agent_and_stops_the_run() -> None:
    result, mocks = _run_agent_phase(
        ["--apply", "--member-batch-size", "1"],
        _AgentPhaseSetup(
            agents=[("ag1", "c1", None), ("ag2", "c2", None)],
            workspace_members=["m1", "m2", "m3"],
            member_write_side_effect=[None, RuntimeError("rbac unavailable")],
        ),
    )

    assert result.exit_code != 0
    events = _events(result.output)
    assert [e["event"] for e in events] == ["agent_access_bootstrap_failed"]
    assert events[0]["tenant_id"] == "t1"
    assert events[0]["agent_id"] == "ag1"
    assert events[0]["error"] == "rbac unavailable"
    assert "ag1" in result.output
    # No scope row was written, and the second agent was never reached.
    mocks.replace_whitelist.assert_not_called()
    assert mocks.agent_whitelist_config.call_count == 1


def test_agent_bootstrap_is_idempotent_on_a_second_apply() -> None:
    result, mocks = _run_agent_phase(
        ["--apply"],
        _AgentPhaseSetup(
            agents=[("ag1", "c1", None), ("ag2", "c2", None)],
            agent_configs=[
                _whitelist_config(account_ids=["m1", "m2"]),
                _whitelist_config(account_ids=["m1"]),
            ],
        ),
    )

    assert result.exit_code == 0, result.output
    events = _events(result.output)
    assert [e["event"] for e in events] == ["agent_access_bootstrap_skipped"] * 2
    assert {e["reason"] for e in events} == {"already_initialized"}
    mocks.replace_whitelist.assert_not_called()
    mocks.sync_creator_bindings.assert_not_called()
    assert "0 agent(s) changed, 2 already initialised" in result.output


def test_agent_with_hand_picked_whitelist_scope_is_left_alone() -> None:
    result, mocks = _run_agent_phase(
        ["--apply"],
        _AgentPhaseSetup(agents=[("ag1", "c1", None)], agent_configs=[_whitelist_config(scope="specific")]),
    )

    assert result.exit_code == 0, result.output
    events = _events(result.output)
    assert [e["event"] for e in events] == ["agent_access_bootstrap_skipped"]
    assert events[0]["reason"] == "already_initialized"
    mocks.replace_whitelist.assert_not_called()


def test_agent_without_creator_falls_back_to_owner_and_reports_no_creator() -> None:
    result, mocks = _run_agent_phase(
        ["--apply"], _AgentPhaseSetup(agents=[("ag1", None, None)], owner_account_id="owner-9")
    )

    assert result.exit_code == 0, result.output
    events = _events(result.output)
    assert events[0]["operator_account_id"] == "owner-9"
    assert events[0]["reason"] == "no_creator"
    assert events[0]["after"] == {
        "automatic_include_workspace_members": True,
        "default_policy_member_source": "workspace_members",
        "creator_access_policy_synced": False,
    }
    mocks.replace_whitelist.assert_called_once()
    mocks.sync_creator_bindings.assert_not_called()


def test_owner_lookup_is_cached_per_tenant() -> None:
    _, mocks = _run_agent_phase([], _AgentPhaseSetup(agents=[("ag1", None, None), ("ag2", None, None)]))

    mocks.owner_account_id.assert_called_once()


def test_backing_app_with_specific_whitelist_is_flagged_for_review() -> None:
    result, mocks = _run_agent_phase(
        [],
        _AgentPhaseSetup(
            agents=[("ag1", "c1", "app-1")],
            app_config=_whitelist_config(scope="specific", account_ids=["m2", "m1"]),
        ),
    )

    assert result.exit_code == 0, result.output
    events = _events(result.output)
    assert [e["event"] for e in events] == [
        "agent_backing_app_has_specific_whitelist",
        "agent_access_bootstrap_proposed_change",
    ]
    assert events[0]["app_id"] == "app-1"
    assert events[0]["agent_id"] == "ag1"
    assert events[0]["backing_app_account_ids"] == ["m1", "m2"]
    mocks.app_whitelist_config.assert_called_once()
    # The hand-picked members are reported for review, never copied onto the agent.
    assert mocks.replace_user_access_policies.call_count == 0


def test_backing_app_without_specific_whitelist_is_not_flagged() -> None:
    result, _ = _run_agent_phase([], _AgentPhaseSetup(agents=[("ag1", "c1", "app-1")]))

    assert result.exit_code == 0, result.output
    assert [e["event"] for e in _events(result.output)] == ["agent_access_bootstrap_proposed_change"]


def test_tenant_with_zero_agents_completes() -> None:
    result, mocks = _run_agent_phase([], _AgentPhaseSetup(agents=[]))

    assert result.exit_code == 0, result.output
    assert _events(result.output) == []
    assert "0 agent(s) would change, 0 already initialised" in result.output
    mocks.agent_whitelist_config.assert_not_called()


def test_unknown_agent_whitelist_scope_stops_the_migration() -> None:
    """A scope this build has never heard of is never guessed at: it fails the agent like any other error."""
    result, mocks = _run_agent_phase(
        ["--apply"],
        _AgentPhaseSetup(
            agents=[("ag1", "c1", None), ("ag2", "c2", None)],
            agent_configs=[_whitelist_config(scope="galaxy_brain")],
        ),
    )

    assert result.exit_code != 0
    events = _events(result.output)
    assert [e["event"] for e in events] == ["agent_access_bootstrap_failed"]
    assert events[0]["agent_id"] == "ag1"
    assert "galaxy_brain" in str(events[0]["error"])
    assert "ag1" in result.output
    mocks.replace_whitelist.assert_not_called()
    # The second agent was never reached.
    assert mocks.agent_whitelist_config.call_count == 1


def test_missing_agent_whitelist_scope_is_skipped_not_defaulted() -> None:
    result, mocks = _run_agent_phase(
        ["--apply"],
        _AgentPhaseSetup(agents=[("ag1", "c1", None)], agent_configs=[_whitelist_config(scope=None)]),
    )

    assert result.exit_code == 0, result.output
    events = _events(result.output)
    assert [e["event"] for e in events] == ["agent_access_bootstrap_skipped"]
    assert events[0]["reason"] == "missing_whitelist_scope"
    mocks.replace_whitelist.assert_not_called()
    assert "0 agent(s) changed, 0 already initialised" in result.output


def test_iter_agent_rows_skips_archived_and_keyset_paginates() -> None:
    statements: list[Select[tuple[str, str | None, str | None]]] = []
    batches: list[list[MagicMock]] = [[MagicMock(id="ag1", created_by="c1", backing_app_id="app-1")], []]

    def _execute(stmt: Select[tuple[str, str | None, str | None]]) -> MagicMock:
        statements.append(stmt)
        executed = MagicMock()
        executed.all.return_value = batches[len(statements) - 1]
        return executed

    session = MagicMock()
    session.execute.side_effect = _execute
    factory = MagicMock()
    factory.create_session.return_value.__enter__.return_value = session

    with patch(f"{MODULE}.session_factory", factory):
        rows = list(real_iter_agent_rows("t1", 500))

    assert rows == [("ag1", "c1", "app-1")]
    rendered = [str(stmt) for stmt in statements]
    assert len(rendered) == 2
    assert all("agents.status !=" in text for text in rendered)
    assert all("agents.tenant_id =" in text for text in rendered)
    assert "agents.id >" in rendered[1]
    # The excluded status is ARCHIVED specifically, not just "some status".
    for stmt in statements:
        assert AgentStatus.ARCHIVED in stmt.compile().params.values()
