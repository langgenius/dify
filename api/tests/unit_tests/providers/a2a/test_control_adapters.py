"""Exercise real workspace/member adapters with recorded enterprise transport."""

from collections.abc import Callable

import pytest
from pydantic import JsonValue

from enums.account import TenantAccountRole
from machinery.context import RequestContext
from models.account import TenantAccountJoin
from providers.a2a.control_adapters import WorkspaceExternalAssetAccess
from repositories.workspace.workspace_repository import WorkspaceRepository
from tests.helpers.unit.rbac_fakes import RBACDomain

CONTEXT = RequestContext("external-access-test", None, "acct-1", "tenant-1")
PREVIEW = "agent.acl.preview"


def test_ce_visible_assets_never_call_enterprise_rbac_and_role_remains_tenant_scoped(
    rbac_domain: RBACDomain, config_overrides: Callable[..., None]
) -> None:
    config_overrides(RBAC_ENABLED=False)
    rbac_domain.transport.failure = AssertionError("CE External access must not call enterprise RBAC.")
    with rbac_domain.sessions.begin() as session:
        session.add(TenantAccountJoin(tenant_id="tenant-1", account_id="acct-1", role=TenantAccountRole.EDITOR))
    access = WorkspaceExternalAssetAccess(
        workspaces=WorkspaceRepository(rbac_domain.sessions), permissions=rbac_domain.rbac.members, rbac_enabled=False
    )
    assert access.visible_agent_ids(CONTEXT) is None
    assert access.role(CONTEXT) == "editor"
    assert access.role(CONTEXT._replace(active_workspace_id="other-tenant")) is None
    assert rbac_domain.transport.requests == []


@pytest.mark.parametrize(
    ("permissions", "scope", "expected"),
    [
        (
            {"agent": {"default_permission_keys": [PREVIEW]}},
            {"unrestricted": False, "resource_ids": ["allowed"]},
            frozenset({"allowed"}),
        ),
        ({"agent": {"default_permission_keys": [PREVIEW]}}, {"unrestricted": False, "resource_ids": []}, frozenset()),
        ({"agent": {"default_permission_keys": [PREVIEW]}}, {"unrestricted": True, "resource_ids": []}, None),
        ({"workspace": {"permission_keys": [PREVIEW]}}, {"unrestricted": True, "resource_ids": []}, None),
        (
            {
                "agent": {
                    "overrides": [
                        {"resource_id": "allowed", "permission_keys": [PREVIEW]},
                        {"resource_id": "denied", "permission_keys": []},
                    ]
                }
            },
            {"unrestricted": True, "resource_ids": []},
            frozenset({"allowed"}),
        ),
        ({"agent": {"default_permission_keys": []}}, {"unrestricted": True, "resource_ids": []}, frozenset()),
    ],
)
def test_ee_visible_assets_use_the_effective_enterprise_scope(
    rbac_domain: RBACDomain,
    config_overrides: Callable[..., None],
    permissions: JsonValue,
    scope: JsonValue,
    expected: frozenset[str] | None,
) -> None:
    config_overrides(RBAC_ENABLED=True)
    rbac_domain.transport.responses = {"/rbac/my-permissions": permissions, "/rbac/agents/whitelist/resources": scope}
    access = WorkspaceExternalAssetAccess(
        workspaces=WorkspaceRepository(rbac_domain.sessions), permissions=rbac_domain.rbac.members, rbac_enabled=True
    )
    assert access.visible_agent_ids(CONTEXT) == expected
    requests = rbac_domain.transport.requests
    assert [entry.endpoint for entry in requests] == ["/rbac/my-permissions", "/rbac/agents/whitelist/resources"]
    assert all(entry.method == "GET" for entry in requests)
    assert all(entry.tenant_id == CONTEXT.active_workspace_id for entry in requests)
    assert all(entry.account_id == CONTEXT.account_id for entry in requests)
