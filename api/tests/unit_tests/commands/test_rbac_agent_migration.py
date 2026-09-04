import json
from collections.abc import Iterator
from contextlib import ExitStack
from dataclasses import dataclass, field
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner, Result

from commands.rbac import migrate_agent_permissions_to_rbac
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
        mocks.write_order.attach_mock(mocks.replace_user_access_policies, "seed_members")
        mocks.write_order.attach_mock(mocks.sync_creator_bindings, "sync_creator")
        mocks.write_order.attach_mock(mocks.replace_whitelist, "replace_whitelist")
        result = CliRunner().invoke(migrate_agent_permissions_to_rbac, args)
    return result, mocks


def _write_order(mocks: _AgentPhaseMocks) -> list[str]:
    return [name for name, _, _ in mocks.write_order.mock_calls]


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

    assert _write_order(mocks) == ["seed_members", "seed_members", "sync_creator", "replace_whitelist"]


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
    mocks.replace_user_access_policies.assert_not_called()
    assert "0 agent(s) changed, 2 already initialised" in result.output
