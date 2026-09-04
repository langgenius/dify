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
        _returns(call, {})
        yield call


def _returns(call: MagicMock, payload: dict[str, object]) -> None:
    call.return_value = payload


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


def _assert_agent_endpoint(endpoint: str, suffix: str) -> None:
    assert endpoint == f"/rbac/agents/{suffix}"
    assert "/agents/" in endpoint
    assert "/apps/" not in endpoint
    assert "/datasets/" not in endpoint


class TestResourceAccessRoute:
    @pytest.mark.parametrize(
        ("resource_type", "segment", "id_param"),
        [
            (svc.RBACResourceType.APP, "apps", "app_id"),
            (svc.RBACResourceType.DATASET, "datasets", "dataset_id"),
            (svc.RBACResourceType.AGENT, "agents", "agent_id"),
        ],
    )
    def test_route_data_lives_on_the_enum(
        self, resource_type: svc.RBACResourceType, segment: str, id_param: str
    ) -> None:
        route = resource_type.route
        assert route.segment == segment
        assert route.id_param == id_param


class TestResourceIdParams:
    @pytest.mark.parametrize(
        ("resource_type", "expected"),
        [
            (svc.RBACResourceType.APP, {"resource_type": "app", "app_id": "resource-1"}),
            (svc.RBACResourceType.DATASET, {"resource_type": "dataset", "dataset_id": "resource-1"}),
            (svc.RBACResourceType.AGENT, {"resource_type": "agent", "agent_id": "resource-1"}),
            ("agent", {"resource_type": "agent", "agent_id": "resource-1"}),
        ],
    )
    def test_id_key_comes_from_the_enum_route(
        self, resource_type: svc.RBACResourceType | str, expected: dict[str, str]
    ) -> None:
        assert svc._resource_id_params(resource_type, " resource-1 ") == expected

    def test_unknown_resource_type_raises(self) -> None:
        with pytest.raises(ValueError):
            svc._resource_id_params("workflow", "resource-1")


class TestAgentAccess:
    def test_whitelist_resources(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"unrestricted": False, "resource_ids": [AGENT]})

        out = svc.RBACService.AgentAccess.whitelist_resources(TENANT, ACTOR)

        call = _last(inner_call)
        assert call.method == "GET"
        _assert_agent_endpoint(call.endpoint, "whitelist/resources")
        assert call.tenant_id == TENANT
        assert call.account_id == ACTOR
        assert isinstance(out, svc.ResourceWhitelistResources)
        assert out.resource_ids == [AGENT]

    def test_user_access_policies(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"data": [], "pagination": None})

        out = svc.RBACService.AgentAccess.user_access_policies(
            TENANT,
            ACTOR,
            agent_id=AGENT,
            options=svc.ListOption(page_number=2, results_per_page=10),
        )

        call = _last(inner_call)
        assert call.method == "GET"
        _assert_agent_endpoint(call.endpoint, "user-access-policies")
        assert call.params == {"page_number": 2, "results_per_page": 10, "agent_id": AGENT}
        assert isinstance(out, svc.ResourceUserAccessPoliciesResponse)

    def test_replace_user_access_policies(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"access_policies": []})
        payload = svc.ReplaceUserAccessPolicies(access_policy_ids=[POLICY], account_ids=["member-1"])

        out = svc.RBACService.AgentAccess.replace_user_access_policies(
            TENANT, ACTOR, agent_id=AGENT, target_account_id="member-1", payload=payload
        )

        call = _last(inner_call)
        assert call.method == "PUT"
        _assert_agent_endpoint(call.endpoint, "user-access-policies")
        assert call.params == {"agent_id": AGENT, "account_id": "member-1"}
        assert call.json == {"access_policy_ids": [POLICY], "account_ids": ["member-1"]}
        assert isinstance(out, svc.ReplaceUserAccessPoliciesResponse)

    def test_whitelist(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"account_ids": ["member-1"]})

        out = svc.RBACService.AgentAccess.whitelist(TENANT, ACTOR, agent_id=AGENT)

        call = _last(inner_call)
        assert call.method == "GET"
        _assert_agent_endpoint(call.endpoint, "whitelist")
        assert call.params == {"agent_id": AGENT}
        assert isinstance(out, svc.ResourceWhitelist)
        assert out.account_ids == ["member-1"]

    def test_whitelist_config(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"automatic_include_workspace_members": True})

        out = svc.RBACService.AgentAccess.whitelist_config(TENANT, ACTOR, agent_id=AGENT)

        call = _last(inner_call)
        assert call.method == "GET"
        _assert_agent_endpoint(call.endpoint, "whitelist")
        assert call.params == {"agent_id": AGENT}
        assert isinstance(out, svc.ResourceWhitelistConfig)
        assert out.automatic_include_workspace_members is True

    def test_legacy_whitelist_config(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"account_ids": ["member-1"], "scope": "all_members"})

        out = svc.RBACService.AgentAccess.legacy_whitelist_config(TENANT, ACTOR, agent_id=AGENT)

        call = _last(inner_call)
        assert call.method == "GET"
        _assert_agent_endpoint(call.endpoint, "whitelist")
        assert call.params == {"agent_id": AGENT}
        assert isinstance(out, svc._LegacyResourceWhitelistConfig)
        assert out.rbac_whitelist_scope == "all_members"

    def test_replace_whitelist(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"account_ids": ["member-1"]})
        payload = svc.ReplaceMemberBindings(automatic_include_workspace_members=True)

        out = svc.RBACService.AgentAccess.replace_whitelist(TENANT, ACTOR, agent_id=AGENT, payload=payload)

        call = _last(inner_call)
        assert call.method == "PUT"
        _assert_agent_endpoint(call.endpoint, "whitelist")
        assert call.params == {"agent_id": AGENT}
        assert call.json == {"automatic_include_workspace_members": True}
        assert isinstance(out, svc.ResourceWhitelist)

    def test_append_whitelist_members_batch(self, inner_call: MagicMock) -> None:
        item = svc.AppendAgentWhitelistMembersBatchItem(agent_id=AGENT, account_ids=["member-1"], policy_id=POLICY)

        out = svc.RBACService.AgentAccess.append_whitelist_members_batch(
            tenant_id=TENANT, account_id=ACTOR, data=[item]
        )

        call = _last(inner_call)
        assert call.method == "POST"
        _assert_agent_endpoint(call.endpoint, "whitelist/members/batch")
        assert call.json == {"data": [{"agent_id": AGENT, "account_ids": ["member-1"], "policy_id": POLICY}]}
        assert out is None

    def test_matrix(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"resource_id": AGENT, "items": []})

        out = svc.RBACService.AgentAccess.matrix(TENANT, ACTOR, agent_id=AGENT)

        call = _last(inner_call)
        assert call.method == "GET"
        _assert_agent_endpoint(call.endpoint, "access-policy")
        assert call.params == {"agent_id": AGENT}
        assert isinstance(out, svc.AgentAccessMatrix)
        assert out.agent_id == AGENT

    def test_list_role_bindings(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"data": []})

        out = svc.RBACService.AgentAccess.list_role_bindings(TENANT, ACTOR, agent_id=AGENT, policy_id=POLICY)

        call = _last(inner_call)
        assert call.method == "GET"
        _assert_agent_endpoint(call.endpoint, "access-policy/role-bindings")
        assert call.params == {"agent_id": AGENT, "policy_id": POLICY}
        assert isinstance(out, svc.RoleBindingsResponse)

    def test_replace_role_bindings(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"data": []})
        payload = svc.ReplaceRoleBindings(role_ids=["role-1"])

        out = svc.RBACService.AgentAccess.replace_role_bindings(
            TENANT, ACTOR, agent_id=AGENT, policy_id=POLICY, payload=payload
        )

        call = _last(inner_call)
        assert call.method == "PUT"
        _assert_agent_endpoint(call.endpoint, "access-policy/role-bindings")
        assert call.params == {"agent_id": AGENT, "policy_id": POLICY}
        assert call.json == payload.model_dump(mode="json")
        assert isinstance(out, svc.RoleBindingsResponse)

    def test_list_member_bindings(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"data": []})

        out = svc.RBACService.AgentAccess.list_member_bindings(TENANT, ACTOR, agent_id=AGENT, policy_id=POLICY)

        call = _last(inner_call)
        assert call.method == "GET"
        _assert_agent_endpoint(call.endpoint, "access-policy/member-bindings")
        assert call.params == {"agent_id": AGENT, "policy_id": POLICY}
        assert isinstance(out, svc.MemberBindingsResponse)

    def test_delete_member_bindings(self, inner_call: MagicMock) -> None:
        payload = svc.DeleteMemberBindings(account_ids=["member-1"])

        out = svc.RBACService.AgentAccess.delete_member_bindings(
            TENANT, ACTOR, agent_id=AGENT, policy_id=POLICY, payload=payload
        )

        call = _last(inner_call)
        assert call.method == "DELETE"
        _assert_agent_endpoint(call.endpoint, "access-policy/member-bindings")
        assert call.params == {"agent_id": AGENT, "policy_id": POLICY}
        assert call.json == payload.model_dump(mode="json")
        assert out is None

    def test_replace_bindings(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"policy": None, "roles": [], "accounts": []})
        payload = svc.ReplaceBindings(role_ids=["role-1"], account_ids=["member-1"])

        out = svc.RBACService.AgentAccess.replace_bindings(
            TENANT, ACTOR, agent_id=AGENT, policy_id=POLICY, payload=payload
        )

        call = _last(inner_call)
        assert call.method == "PUT"
        _assert_agent_endpoint(call.endpoint, "access-policy/bindings")
        assert call.params == {"agent_id": AGENT, "policy_id": POLICY}
        assert call.json == payload.model_dump(mode="json")
        assert isinstance(out, svc.AccessMatrixItem)


class TestWorkspaceAgentAccess:
    def test_agent_matrix(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"items": [], "pagination": None})

        out = svc.RBACService.WorkspaceAccess.agent_matrix(
            TENANT, ACTOR, options=svc.ListOption(page_number=1, results_per_page=5)
        )

        call = _last(inner_call)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/workspace/agents/access-policy"
        assert "/apps/" not in call.endpoint
        assert call.params == {"page_number": 1, "results_per_page": 5}
        assert isinstance(out, svc.WorkspaceAccessMatrix)

    def test_agent_matrix_omits_empty_params(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"items": []})

        svc.RBACService.WorkspaceAccess.agent_matrix(TENANT)

        assert _last(inner_call).params is None

    def test_list_agent_role_bindings(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"data": []})

        out = svc.RBACService.WorkspaceAccess.list_agent_role_bindings(TENANT, ACTOR, POLICY)

        call = _last(inner_call)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/workspace/agents/access-policy/role-bindings"
        assert call.params == {"policy_id": POLICY}
        assert isinstance(out, svc.RoleBindingsResponse)

    def test_replace_agent_role_bindings(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"data": []})
        payload = svc.ReplaceRoleBindings(role_ids=["role-1"])

        out = svc.RBACService.WorkspaceAccess.replace_agent_role_bindings(TENANT, ACTOR, POLICY, payload)

        call = _last(inner_call)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/workspace/agents/access-policy/role-bindings"
        assert call.params == {"policy_id": POLICY}
        assert call.json == payload.model_dump(mode="json")
        assert isinstance(out, svc.RoleBindingsResponse)

    def test_list_agent_member_bindings(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"data": []})

        out = svc.RBACService.WorkspaceAccess.list_agent_member_bindings(TENANT, ACTOR, POLICY)

        call = _last(inner_call)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/workspace/agents/access-policy/member-bindings"
        assert call.params == {"policy_id": POLICY}
        assert isinstance(out, svc.MemberBindingsResponse)

    def test_replace_agent_bindings(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"policy": None, "roles": [], "accounts": []})
        payload = svc.ReplaceBindings(role_ids=["role-1"], account_ids=["member-1"])

        out = svc.RBACService.WorkspaceAccess.replace_agent_bindings(TENANT, ACTOR, POLICY, payload)

        call = _last(inner_call)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/workspace/agents/access-policy/bindings"
        assert call.params == {"policy_id": POLICY}
        assert call.json == payload.model_dump(mode="json")
        assert isinstance(out, svc.AccessMatrixItem)

    def test_existing_app_and_dataset_workspace_paths_unchanged(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"data": []})
        svc.RBACService.WorkspaceAccess.list_app_role_bindings(TENANT, ACTOR, POLICY)
        assert _last(inner_call).endpoint == "/rbac/workspace/apps/access-policy/role-bindings"

        inner_call.reset_mock()
        svc.RBACService.WorkspaceAccess.list_dataset_member_bindings(TENANT, ACTOR, POLICY)
        assert _last(inner_call).endpoint == "/rbac/workspace/datasets/access-policy/member-bindings"


class TestCatalog:
    def test_agent_catalog(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"groups": [{"group_key": "agent", "group_name": "Agent", "permissions": []}]})

        out = svc.RBACService.Catalog.agent(TENANT, account_id=ACTOR)

        call = _last(inner_call)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/role-permissions/catalog/agent"
        assert call.tenant_id == TENANT
        assert call.account_id == ACTOR
        assert isinstance(out, svc.PermissionCatalogResponse)
        assert out.groups[0].group_key == "agent"

    def test_app_and_dataset_catalog_unchanged(self, inner_call: MagicMock) -> None:
        _returns(inner_call, {"groups": []})
        svc.RBACService.Catalog.app(TENANT)
        assert _last(inner_call).endpoint == "/rbac/role-permissions/catalog/app"

        inner_call.reset_mock()
        svc.RBACService.Catalog.dataset(TENANT)
        assert _last(inner_call).endpoint == "/rbac/role-permissions/catalog/dataset"


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


class TestAppAgentParity:
    @pytest.mark.parametrize(
        ("app_call", "agent_call"),
        [(case[1], case[2]) for case in _PARITY_CASES],
        ids=[case[0] for case in _PARITY_CASES],
    )
    def test_same_path_and_param_shape_modulo_segment(
        self,
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
