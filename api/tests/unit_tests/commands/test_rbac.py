import json
from collections.abc import Iterator

import pytest
from click.testing import CliRunner

from commands import rbac
from enums.account import TenantAccountRole
from models import TenantAccountJoin
from models.agent import Agent, AgentScope, AgentSource
from tests.helpers.unit.model_factories import make_tenant
from tests.helpers.unit.rbac_fakes import RBACDomain

"""Exercise migration queries against SQLite and the shared RBAC transport fake."""


def _events(output: str) -> list[dict[str, object]]:
    return [json.loads(line) for line in output.splitlines() if line.startswith("{")]


def _seed_agent(domain: RBACDomain) -> None:
    with domain.sessions.begin() as session:
        session.add(make_tenant(tenant_id="t1"))
        session.add(
            Agent(
                id="ag1",
                tenant_id="t1",
                name="Agent",
                scope=AgentScope.ROSTER,
                source=AgentSource.ROSTER,
                created_by="c1",
            )
        )
        for index, account_id in enumerate(("owner-1", "m1", "admin-1", "m2", "m3")):
            membership = TenantAccountJoin(tenant_id="t1", account_id=account_id, role=TenantAccountRole.NORMAL)
            membership.id = f"membership-{index}"
            session.add(membership)
        session.add(TenantAccountJoin(tenant_id="other", account_id="foreign", role=TenantAccountRole.NORMAL))
    domain.transport.responses["/rbac/agents/whitelist"] = {"rbac_whitelist_scope": "all"}
    # Remote RBAC bindings protect administrators even when the local role is normal.
    domain.transport.responses["/rbac/members/rbac-roles/batch"] = {
        f"{role_tag}-1": [
            {
                "id": f"role-{role_tag}",
                "type": "workspace",
                "category": "global_system_default",
                "name": role_tag,
                "is_builtin": True,
                "role_tag": role_tag,
            }
        ]
        for role_tag in ("owner", "admin")
    }


class TestRbacAgentMigrationCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def migration_database(monkeypatch: pytest.MonkeyPatch, rbac_domain: RBACDomain) -> None:
        monkeypatch.setattr(rbac.session_factory, "create_session", rbac_domain.sessions)

    @staticmethod
    def test_apply_flag_writes_and_reports_applied(rbac_domain: RBACDomain) -> None:
        with rbac_domain.sessions.begin() as session:
            session.add_all([make_tenant(tenant_id="t1"), make_tenant(tenant_id="t2")])
        rbac_domain.transport.response = {
            "roles": [{"role_id": "r1", "role_name": "ops", "added_keys": ["agent.create"]}]
        }

        result = CliRunner().invoke(rbac.migrate_agent_permissions_to_rbac, ["--apply"])

        assert result.exit_code == 0, result.output
        assert len(rbac_domain.transport.requests) == 2
        for request in rbac_domain.transport.requests:
            assert (request.method, request.endpoint) == ("POST", "/rbac/migrations/agent-manage-roles")
            assert request.json == {"apply": True}
        events = _events(result.output)
        assert [event["event"] for event in events] == ["agent_manage_role_migration_applied"] * 2
        assert {event["tenant_id"] for event in events} == {"t1", "t2"}
        assert "changed" in result.output

    @staticmethod
    def test_agent_bootstrap_apply_writes_whitelist_member_batches_and_creator_sync(rbac_domain: RBACDomain) -> None:
        _seed_agent(rbac_domain)

        result = CliRunner().invoke(rbac.migrate_agent_permissions_to_rbac, ["--apply", "--member-batch-size", "2"])

        assert result.exit_code == 0, result.output
        assert [event["event"] for event in _events(result.output)] == ["agent_access_bootstrap_applied"]
        assert _events(result.output)[0]["dry_run"] is False
        role_queries = [
            request
            for request in rbac_domain.transport.requests
            if request.endpoint == "/rbac/members/rbac-roles/batch"
        ]
        assert [request.json for request in role_queries] == [
            {"member_ids": ["owner-1", "m1"]},
            {"member_ids": ["admin-1", "m2"]},
            {"member_ids": ["m3"]},
        ]
        for request in role_queries:
            assert (request.method, request.tenant_id, request.account_id) == ("POST", "t1", "c1")
        writes = [request for request in rbac_domain.transport.requests if request.method == "PUT"]
        assert [request.endpoint for request in writes] == [
            "/rbac/agents/user-access-policies",
            "/rbac/agents/user-access-policies",
            "/rbac/agents/user-access-policies",
            "/rbac/access-policies/creator-member-bindings",
            "/rbac/agents/whitelist",
        ]
        first, second, third, creator, whitelist = writes
        for request in writes:
            assert (request.tenant_id, request.account_id) == ("t1", "c1")
        for request, account_ids in ((first, ["m1"]), (second, ["m2"]), (third, ["m3"])):
            assert request.params == {"agent_id": "ag1", "account_id": None}
            assert request.json == {"account_ids": account_ids, "access_policy_ids": ["default"]}
        assert creator.params == {"resource_type": "agent", "agent_id": "ag1"}
        assert whitelist.params == {"agent_id": "ag1"}
        assert whitelist.json == {"automatic_include_workspace_members": True}
        assert "1 agent(s) changed, 0 already initialised" in result.output

    @staticmethod
    def test_agent_bootstrap_is_idempotent_on_a_second_apply(rbac_domain: RBACDomain) -> None:
        _seed_agent(rbac_domain)
        first = CliRunner().invoke(rbac.migrate_agent_permissions_to_rbac, ["--apply"])
        assert first.exit_code == 0, first.output
        assert any(request.method == "PUT" for request in rbac_domain.transport.requests)
        rbac_domain.transport.requests.clear()
        rbac_domain.transport.responses["/rbac/migrations/agent-access-state"] = {"configured_agent_ids": ["ag1"]}

        result = CliRunner().invoke(rbac.migrate_agent_permissions_to_rbac, ["--apply"])

        assert result.exit_code == 0, result.output
        events = _events(result.output)
        assert [event["event"] for event in events] == ["agent_access_bootstrap_skipped"]
        assert events[0]["reason"] == "already_initialized"
        assert not any(request.method == "PUT" for request in rbac_domain.transport.requests)
        assert "0 agent(s) changed, 1 already initialised" in result.output


class TestRbacMemberMigrationCases:
    @staticmethod
    @pytest.mark.parametrize("workers", [1, 2])
    def test_member_migration_uses_shared_remote_adapter_without_write_sessions(
        monkeypatch: pytest.MonkeyPatch, rbac_domain: RBACDomain, workers: int
    ) -> None:
        def batches(
            tenant_id: str | None, *, db_batch_size: int, api_batch_size: int
        ) -> Iterator[tuple[str, str, list[tuple[str, str]]]]:
            assert tenant_id is None
            assert db_batch_size > 0
            assert api_batch_size > 0
            yield "workspace", "owner", [("first", "editor"), ("second", "normal")]

        def unexpected_session() -> None:
            raise AssertionError("A remote role replacement must not open a database session")

        monkeypatch.setattr(rbac, "_iter_tenant_member_batches", batches)
        monkeypatch.setattr(
            rbac, "_resolve_builtin_role_ids", lambda *_args: {"editor": "role-editor", "normal": "role-normal"}
        )
        monkeypatch.setattr(rbac.RBACService.MemberRoles, "batch_get", lambda **_kwargs: [])
        monkeypatch.setattr(rbac.session_factory, "create_session", unexpected_session)
        rbac_domain.transport.response = {"account_id": "member", "roles": []}

        result = CliRunner().invoke(rbac.migrate_member_roles_to_rbac, ["--workers", str(workers)])

        assert result.exit_code == 0, result.output
        sent = rbac_domain.transport.requests
        assert len(sent) == 2
        for request in sent:
            assert (request.method, request.endpoint) == ("PUT", "/rbac/members/rbac-roles")
            assert (request.tenant_id, request.account_id) == ("workspace", "owner")
            assert request.params is not None
            expected_role = "role-editor" if request.params["account_id"] == "first" else "role-normal"
            assert request.json == {"role_ids": [expected_role]}
        assert {request.params["account_id"] for request in sent if request.params} == {"first", "second"}
