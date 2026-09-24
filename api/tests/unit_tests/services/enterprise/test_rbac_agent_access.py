"""Unit tests for the agent-flavoured RBAC inner-API client.

`RBACService.AgentAccess`, the agent methods on `RBACService.WorkspaceAccess` and
`RBACService.Catalog.agent` are all built from one generic resource-access client.
These tests monkeypatch `_inner_call` and assert the HTTP method, the exact endpoint,
the query/body keys and the returned model for every operation.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from services.enterprise import rbac_service as svc

MODULE = "services.enterprise.rbac_service"

TENANT = "tenant-1"
ACTOR = "acct-1"
AGENT = "agent-1"
POLICY = "policy-1"


@pytest.fixture
def inner_call() -> Iterator[MagicMock]:
    with patch(f"{MODULE}._inner_call") as call:
        call.return_value = {"automatic_include_workspace_members": True}
        yield call


def _last(call: MagicMock) -> SimpleNamespace:
    call.assert_called_once()
    args, kwargs = call.call_args
    return SimpleNamespace(
        method=args[0],
        endpoint=args[1],
        tenant_id=kwargs.get("tenant_id"),
        account_id=kwargs.get("account_id"),
        json=kwargs.get("json"),
        params=kwargs.get("params"),
    )


_AGENT_CASES: list[tuple[str, str, str, Callable[[], object]]] = [
    (
        "whitelist_resources",
        "GET",
        "/rbac/agents/whitelist/resources",
        lambda: svc.RBACService.AgentAccess.whitelist_resources(TENANT, ACTOR),
    ),
    (
        "user_access_policies",
        "GET",
        "/rbac/agents/user-access-policies",
        lambda: svc.RBACService.AgentAccess.user_access_policies(TENANT, ACTOR, agent_id=AGENT),
    ),
    (
        "replace_user_access_policies",
        "PUT",
        "/rbac/agents/user-access-policies",
        lambda: svc.RBACService.AgentAccess.replace_user_access_policies(
            TENANT,
            ACTOR,
            agent_id=AGENT,
            target_account_id="member-1",
            payload=svc.ReplaceUserAccessPolicies(access_policy_ids=[POLICY], account_ids=["member-1"]),
        ),
    ),
    (
        "whitelist",
        "GET",
        "/rbac/agents/whitelist",
        lambda: svc.RBACService.AgentAccess.whitelist(TENANT, ACTOR, agent_id=AGENT),
    ),
    (
        "whitelist_config",
        "GET",
        "/rbac/agents/whitelist",
        lambda: svc.RBACService.AgentAccess.whitelist_config(TENANT, ACTOR, agent_id=AGENT),
    ),
    (
        "legacy_whitelist_config",
        "GET",
        "/rbac/agents/whitelist",
        lambda: svc.RBACService.AgentAccess.legacy_whitelist_config(TENANT, ACTOR, agent_id=AGENT),
    ),
    (
        "replace_whitelist",
        "PUT",
        "/rbac/agents/whitelist",
        lambda: svc.RBACService.AgentAccess.replace_whitelist(
            TENANT,
            ACTOR,
            agent_id=AGENT,
            payload=svc.ReplaceMemberBindings(automatic_include_workspace_members=True),
        ),
    ),
    (
        "append_whitelist_members_batch",
        "POST",
        "/rbac/agents/whitelist/members/batch",
        lambda: svc.RBACService.AgentAccess.append_whitelist_members_batch(
            tenant_id=TENANT,
            account_id=ACTOR,
            data=[svc.AppendAgentWhitelistMembersBatchItem(agent_id=AGENT, account_ids=["member-1"], policy_id=POLICY)],
        ),
    ),
    (
        "matrix",
        "GET",
        "/rbac/agents/access-policy",
        lambda: svc.RBACService.AgentAccess.matrix(TENANT, ACTOR, agent_id=AGENT),
    ),
    (
        "list_role_bindings",
        "GET",
        "/rbac/agents/access-policy/role-bindings",
        lambda: svc.RBACService.AgentAccess.list_role_bindings(TENANT, ACTOR, agent_id=AGENT, policy_id=POLICY),
    ),
    (
        "replace_role_bindings",
        "PUT",
        "/rbac/agents/access-policy/role-bindings",
        lambda: svc.RBACService.AgentAccess.replace_role_bindings(
            TENANT, ACTOR, agent_id=AGENT, policy_id=POLICY, payload=svc.ReplaceRoleBindings(role_ids=["role-1"])
        ),
    ),
    (
        "list_member_bindings",
        "GET",
        "/rbac/agents/access-policy/member-bindings",
        lambda: svc.RBACService.AgentAccess.list_member_bindings(TENANT, ACTOR, agent_id=AGENT, policy_id=POLICY),
    ),
    (
        "delete_member_bindings",
        "DELETE",
        "/rbac/agents/access-policy/member-bindings",
        lambda: svc.RBACService.AgentAccess.delete_member_bindings(
            TENANT, ACTOR, agent_id=AGENT, policy_id=POLICY, payload=svc.DeleteMemberBindings(account_ids=["member-1"])
        ),
    ),
    (
        "replace_bindings",
        "PUT",
        "/rbac/agents/access-policy/bindings",
        lambda: svc.RBACService.AgentAccess.replace_bindings(
            TENANT,
            ACTOR,
            agent_id=AGENT,
            policy_id=POLICY,
            payload=svc.ReplaceBindings(role_ids=["role-1"], account_ids=["member-1"]),
        ),
    ),
    (
        "workspace.agent_matrix",
        "GET",
        "/rbac/workspace/agents/access-policy",
        lambda: svc.RBACService.WorkspaceAccess.agent_matrix(TENANT, ACTOR),
    ),
    (
        "workspace.list_agent_role_bindings",
        "GET",
        "/rbac/workspace/agents/access-policy/role-bindings",
        lambda: svc.RBACService.WorkspaceAccess.list_agent_role_bindings(TENANT, ACTOR, POLICY),
    ),
    (
        "workspace.replace_agent_role_bindings",
        "PUT",
        "/rbac/workspace/agents/access-policy/role-bindings",
        lambda: svc.RBACService.WorkspaceAccess.replace_agent_role_bindings(
            TENANT, ACTOR, POLICY, svc.ReplaceRoleBindings(role_ids=["role-1"])
        ),
    ),
    (
        "workspace.list_agent_member_bindings",
        "GET",
        "/rbac/workspace/agents/access-policy/member-bindings",
        lambda: svc.RBACService.WorkspaceAccess.list_agent_member_bindings(TENANT, ACTOR, POLICY),
    ),
    (
        "workspace.replace_agent_bindings",
        "PUT",
        "/rbac/workspace/agents/access-policy/bindings",
        lambda: svc.RBACService.WorkspaceAccess.replace_agent_bindings(
            TENANT, ACTOR, POLICY, svc.ReplaceBindings(role_ids=["role-1"], account_ids=["member-1"])
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
    inner_call: MagicMock, method: str, endpoint: str, invoke: Callable[[], object]
) -> None:
    invoke()

    call = _last(inner_call)
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
        lambda: svc.RBACService.AppAccess.whitelist_resources(TENANT, ACTOR),
        lambda: svc.RBACService.AgentAccess.whitelist_resources(TENANT, ACTOR),
    ),
    (
        "whitelist",
        lambda: svc.RBACService.AppAccess.whitelist(TENANT, ACTOR, "res-1"),
        lambda: svc.RBACService.AgentAccess.whitelist(TENANT, ACTOR, agent_id="res-1"),
    ),
    (
        "user_access_policies",
        lambda: svc.RBACService.AppAccess.user_access_policies(TENANT, ACTOR, "res-1"),
        lambda: svc.RBACService.AgentAccess.user_access_policies(TENANT, ACTOR, agent_id="res-1"),
    ),
    (
        "matrix",
        lambda: svc.RBACService.AppAccess.matrix(TENANT, ACTOR, "res-1"),
        lambda: svc.RBACService.AgentAccess.matrix(TENANT, ACTOR, agent_id="res-1"),
    ),
    (
        "list_role_bindings",
        lambda: svc.RBACService.AppAccess.list_role_bindings(TENANT, ACTOR, "res-1", POLICY),
        lambda: svc.RBACService.AgentAccess.list_role_bindings(TENANT, ACTOR, agent_id="res-1", policy_id=POLICY),
    ),
    (
        "list_member_bindings",
        lambda: svc.RBACService.AppAccess.list_member_bindings(TENANT, ACTOR, "res-1", POLICY),
        lambda: svc.RBACService.AgentAccess.list_member_bindings(TENANT, ACTOR, agent_id="res-1", policy_id=POLICY),
    ),
]


@pytest.mark.parametrize(
    ("app_call", "agent_call"),
    [(case[1], case[2]) for case in _PARITY_CASES],
    ids=[case[0] for case in _PARITY_CASES],
)
def test_same_path_and_param_shape_modulo_segment(
    inner_call: MagicMock,
    app_call: Callable[[], object],
    agent_call: Callable[[], object],
) -> None:
    app_call()
    app = _last(inner_call)
    inner_call.reset_mock()
    agent_call()
    agent = _last(inner_call)

    assert app.endpoint.replace("/apps/", "/agents/") == agent.endpoint
    assert app.method == agent.method

    app_params = {("agent_id" if k == "app_id" else k): v for k, v in (app.params or {}).items()}
    assert app_params == (agent.params or {})
