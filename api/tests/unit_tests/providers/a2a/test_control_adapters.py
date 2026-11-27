"""Exercise real workspace/member adapters with recorded enterprise transport."""

from collections.abc import Callable
from datetime import UTC, datetime

import pytest
from pydantic import JsonValue

from enums.account import TenantAccountRole
from machinery.context import RequestContext
from models.account import TenantAccountJoin
from providers.a2a.control_adapters import WorkspaceExternalAssetAccess
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.external_agents.contracts import ExternalAsset
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


def _asset(identifier: str, *, creator: str) -> ExternalAsset:
    """Build a detached admitted resource, without fabricating any permission result."""
    return ExternalAsset(
        id=identifier,
        tenant_id=CONTEXT.active_workspace_id,
        name=identifier,
        description="",
        role="",
        icon_type=None,
        icon=None,
        icon_background=None,
        enabled=True,
        tracing_enabled=False,
        active_connection_revision_id="connection",
        metadata_revision=1,
        row_version=1,
        test_display_generation=1,
        overrides=(),
        created_by=creator,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


@pytest.mark.parametrize("role", list(TenantAccountRole))
@pytest.mark.parametrize("creator", [True, False])
def test_ce_asset_acl_projection_preserves_legacy_roles_even_for_creators(
    rbac_domain: RBACDomain, config_overrides: Callable[..., None], role: TenantAccountRole, creator: bool
) -> None:
    """Creator bypass is an RBAC-only rule; CE Normal cannot acquire edit through ownership."""
    config_overrides(RBAC_ENABLED=False)
    rbac_domain.transport.failure = AssertionError("Legacy ACL projection must not call Enterprise.")
    with rbac_domain.sessions.begin() as session:
        session.add(TenantAccountJoin(tenant_id=CONTEXT.active_workspace_id, account_id=CONTEXT.account_id, role=role))
    access = WorkspaceExternalAssetAccess(
        workspaces=WorkspaceRepository(rbac_domain.sessions), permissions=rbac_domain.rbac.members, rbac_enabled=False
    )
    asset = _asset("asset", creator=CONTEXT.account_id if creator else "other")
    projected = access.permission_keys(CONTEXT, (asset,))
    assert ("agent.acl.edit" in projected[asset.id]) == (
        role in {TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}
    )
    assert access.permission_keys(CONTEXT, ()) == {}
    assert rbac_domain.transport.requests == []


@pytest.mark.parametrize("creator", [True, False])
@pytest.mark.parametrize("policy", ["default_edit", "default_denied", "override_edit", "override_denied"])
def test_ee_asset_acl_projection_batches_effective_custom_policies_and_creator_bypass(
    rbac_domain: RBACDomain, config_overrides: Callable[..., None], creator: bool, policy: str
) -> None:
    """Shared-tag management never grants resource editing; overrides and creator semantics match binding admission."""
    config_overrides(RBAC_ENABLED=True)
    default: list[JsonValue] = (
        ["agent.acl.preview", "agent.acl.edit"] if policy in {"default_edit", "override_denied"} else [PREVIEW]
    )
    override: list[JsonValue] = ["agent.acl.edit"] if policy == "override_edit" else []
    snapshot: dict[str, JsonValue] = {"default_permission_keys": default}
    if policy.startswith("override"):
        snapshot["overrides"] = [{"resource_id": "asset", "permission_keys": override}]
    rbac_domain.transport.responses = {
        "/rbac/my-permissions": {"agent": snapshot, "workspace": {"permission_keys": ["agent.tag.manage"]}}
    }
    access = WorkspaceExternalAssetAccess(
        workspaces=WorkspaceRepository(rbac_domain.sessions), permissions=rbac_domain.rbac.members, rbac_enabled=True
    )
    assets = (
        _asset("asset", creator=CONTEXT.account_id if creator else "other"),
        *(_asset(f"other-{i}", creator="other") for i in range(3)),
    )
    result = access.permission_keys(CONTEXT, assets)
    assert ("agent.acl.edit" in result["asset"]) == (creator or policy in {"default_edit", "override_edit"})
    assert result["other-0"] == tuple(default)
    assert len(rbac_domain.transport.requests) == 1
    assert access.permission_keys(CONTEXT, ()) == {}
    assert len(rbac_domain.transport.requests) == 1
