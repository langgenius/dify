"""Unit tests for the agent-flavoured RBAC inner-API client.

The resource-access clients injected into the application services share one
implementation across apps, datasets and agents.
These tests replace the Enterprise transport and assert the HTTP method, the exact endpoint,
the query/body keys and the returned model for every operation.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest

from services.enterprise import rbac_service as svc
from services.enterprise.base import EnterpriseRequest
from services.rbac import contracts as rbac_contracts
from tests.unit_tests.rbac_fakes import RBACTransport, RecordedRequest

TENANT = "tenant-1"
ACTOR = "acct-1"
AGENT = "agent-1"
POLICY = "policy-1"


@pytest.fixture
def transport(monkeypatch: pytest.MonkeyPatch) -> RBACTransport:
    transport = RBACTransport(response={"automatic_include_workspace_members": True})
    monkeypatch.setattr(EnterpriseRequest, "send_inner_rbac_request", transport.send)
    return transport


def _last(transport: RBACTransport) -> RecordedRequest:
    return transport.only_request


_AGENT_CASES: list[tuple[str, str, str, Callable[[], object]]] = [
    (
        "whitelist_resources",
        "GET",
        "/rbac/agents/whitelist/resources",
        lambda: svc._AGENT_ACCESS.whitelist_resources(TENANT, ACTOR),
    ),
    (
        "user_access_policies",
        "GET",
        "/rbac/agents/user-access-policies",
        lambda: svc._AGENT_ACCESS.user_access_policies(TENANT, ACTOR, resource_id=AGENT),
    ),
    (
        "replace_user_access_policies",
        "PUT",
        "/rbac/agents/user-access-policies",
        lambda: svc._AGENT_ACCESS.replace_user_access_policies(
            TENANT,
            ACTOR,
            resource_id=AGENT,
            target_account_id="member-1",
            payload=rbac_contracts.ReplaceUserAccessPolicies(access_policy_ids=[POLICY], account_ids=["member-1"]),
        ),
    ),
    (
        "whitelist",
        "GET",
        "/rbac/agents/whitelist",
        lambda: svc._AGENT_ACCESS.whitelist(TENANT, ACTOR, resource_id=AGENT),
    ),
    (
        "whitelist_config",
        "GET",
        "/rbac/agents/whitelist",
        lambda: svc._AGENT_ACCESS.whitelist_config(TENANT, ACTOR, resource_id=AGENT),
    ),
    (
        "legacy_whitelist_config",
        "GET",
        "/rbac/agents/whitelist",
        lambda: svc._AGENT_ACCESS.legacy_whitelist_config(TENANT, ACTOR, resource_id=AGENT),
    ),
    (
        "replace_whitelist",
        "PUT",
        "/rbac/agents/whitelist",
        lambda: svc._AGENT_ACCESS.replace_whitelist(
            TENANT,
            ACTOR,
            resource_id=AGENT,
            payload=rbac_contracts.ReplaceMemberBindings(automatic_include_workspace_members=True),
        ),
    ),
    (
        "append_whitelist_members_batch",
        "POST",
        "/rbac/agents/whitelist/members/batch",
        lambda: svc._AGENT_ACCESS.append_whitelist_members_batch(
            tenant_id=TENANT,
            account_id=ACTOR,
            data=[
                rbac_contracts.AppendAgentWhitelistMembersBatchItem(
                    agent_id=AGENT, account_ids=["member-1"], policy_id=POLICY
                )
            ],
        ),
    ),
    (
        "matrix",
        "GET",
        "/rbac/agents/access-policy",
        lambda: svc._AGENT_ACCESS.matrix(TENANT, ACTOR, resource_id=AGENT),
    ),
    (
        "list_role_bindings",
        "GET",
        "/rbac/agents/access-policy/role-bindings",
        lambda: svc._AGENT_ACCESS.list_role_bindings(TENANT, ACTOR, resource_id=AGENT, policy_id=POLICY),
    ),
    (
        "list_member_bindings",
        "GET",
        "/rbac/agents/access-policy/member-bindings",
        lambda: svc._AGENT_ACCESS.list_member_bindings(TENANT, ACTOR, resource_id=AGENT, policy_id=POLICY),
    ),
    (
        "delete_member_bindings",
        "DELETE",
        "/rbac/agents/access-policy/member-bindings",
        lambda: svc._AGENT_ACCESS.delete_member_bindings(
            TENANT,
            ACTOR,
            resource_id=AGENT,
            policy_id=POLICY,
            payload=rbac_contracts.DeleteMemberBindings(account_ids=["member-1"]),
        ),
    ),
    (
        "workspace.agent_matrix",
        "GET",
        "/rbac/workspace/agents/access-policy",
        lambda: svc._WORKSPACE_AGENT_ACCESS.matrix(TENANT, ACTOR),
    ),
    (
        "workspace.list_agent_role_bindings",
        "GET",
        "/rbac/workspace/agents/access-policy/role-bindings",
        lambda: svc._WORKSPACE_AGENT_ACCESS.list_role_bindings(TENANT, ACTOR, POLICY),
    ),
    (
        "workspace.list_agent_member_bindings",
        "GET",
        "/rbac/workspace/agents/access-policy/member-bindings",
        lambda: svc._WORKSPACE_AGENT_ACCESS.list_member_bindings(TENANT, ACTOR, POLICY),
    ),
    (
        "workspace.replace_agent_bindings",
        "PUT",
        "/rbac/workspace/agents/access-policy/bindings",
        lambda: svc._WORKSPACE_AGENT_ACCESS.replace_bindings(
            TENANT, ACTOR, POLICY, rbac_contracts.ReplaceBindings(role_ids=["role-1"], account_ids=["member-1"])
        ),
    ),
    (
        "catalog.agent",
        "GET",
        "/rbac/role-permissions/catalog/agent",
        lambda: svc.RBACService.Catalog.agent(TENANT, account_id=ACTOR),
    ),
]


@pytest.mark.parametrize(
    ("method", "endpoint", "invoke"),
    [(case[1], case[2], case[3]) for case in _AGENT_CASES],
    ids=[case[0] for case in _AGENT_CASES],
)
def test_agent_operations_hit_the_agent_route(
    transport: RBACTransport, method: str, endpoint: str, invoke: Callable[[], object]
) -> None:
    invoke()

    call = _last(transport)
    assert call.method == method
    assert call.endpoint == endpoint
    assert "/apps/" not in call.endpoint
    assert "/datasets/" not in call.endpoint
    assert call.tenant_id == TENANT
    assert call.account_id == ACTOR
    params = call.params or {}
    assert "app_id" not in params
    assert "dataset_id" not in params
    if AGENT in params.values():
        assert params.get("agent_id") == AGENT


_PARITY_CASES: list[tuple[str, Callable[[], object], Callable[[], object]]] = [
    (
        "whitelist_resources",
        lambda: svc._APP_ACCESS.whitelist_resources(TENANT, ACTOR),
        lambda: svc._AGENT_ACCESS.whitelist_resources(TENANT, ACTOR),
    ),
    (
        "whitelist",
        lambda: svc._APP_ACCESS.whitelist(TENANT, ACTOR, "res-1"),
        lambda: svc._AGENT_ACCESS.whitelist(TENANT, ACTOR, resource_id="res-1"),
    ),
    (
        "user_access_policies",
        lambda: svc._APP_ACCESS.user_access_policies(TENANT, ACTOR, "res-1"),
        lambda: svc._AGENT_ACCESS.user_access_policies(TENANT, ACTOR, resource_id="res-1"),
    ),
    (
        "matrix",
        lambda: svc._APP_ACCESS.matrix(TENANT, ACTOR, "res-1"),
        lambda: svc._AGENT_ACCESS.matrix(TENANT, ACTOR, resource_id="res-1"),
    ),
    (
        "list_role_bindings",
        lambda: svc._APP_ACCESS.list_role_bindings(TENANT, ACTOR, "res-1", POLICY),
        lambda: svc._AGENT_ACCESS.list_role_bindings(TENANT, ACTOR, resource_id="res-1", policy_id=POLICY),
    ),
    (
        "list_member_bindings",
        lambda: svc._APP_ACCESS.list_member_bindings(TENANT, ACTOR, "res-1", POLICY),
        lambda: svc._AGENT_ACCESS.list_member_bindings(TENANT, ACTOR, resource_id="res-1", policy_id=POLICY),
    ),
]


@pytest.mark.parametrize(
    ("app_call", "agent_call"),
    [(case[1], case[2]) for case in _PARITY_CASES],
    ids=[case[0] for case in _PARITY_CASES],
)
def test_same_path_and_param_shape_modulo_segment(
    transport: RBACTransport,
    app_call: Callable[[], object],
    agent_call: Callable[[], object],
) -> None:
    app_call()
    app = _last(transport)
    transport.requests.clear()
    agent_call()
    agent = _last(transport)

    assert app.endpoint.replace("/apps/", "/agents/") == agent.endpoint
    assert app.method == agent.method

    app_params = {("agent_id" if k == "app_id" else k): v for k, v in (app.params or {}).items()}
    assert app_params == (agent.params or {})
