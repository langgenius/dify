from collections.abc import Callable

import pytest

from services.enterprise.base import EnterpriseRequest
from services.workspace.contracts import WorkspaceMemberRole, WorkspaceMemberRoleSubject
from services.workspace.gateways import DeploymentWorkspaceMemberRoleResolver
from tests.unit_tests.rbac_fakes import RBACTransport


def make_subject(account_id: str, *, legacy_role: str = "normal") -> WorkspaceMemberRoleSubject:
    return WorkspaceMemberRoleSubject(account_id=account_id, legacy_role=legacy_role)


@pytest.fixture
def transport(monkeypatch: pytest.MonkeyPatch) -> RBACTransport:
    transport = RBACTransport()
    monkeypatch.setattr(EnterpriseRequest, "send_inner_rbac_request", transport.send)
    return transport


def test_builtin_mode_projects_join_roles_without_enterprise_call(
    config_overrides: Callable[..., None], transport: RBACTransport
) -> None:
    config_overrides(RBAC_ENABLED=False)

    result = DeploymentWorkspaceMemberRoleResolver().resolve_many(
        "workspace-1", "actor-1", [make_subject("owner", legacy_role="owner"), make_subject("member")]
    )

    assert result == {
        "owner": (WorkspaceMemberRole(id="owner", name="owner"),),
        "member": (WorkspaceMemberRole(id="normal", name="normal"),),
    }
    assert transport.requests == []


@pytest.mark.parametrize("language", [None, "ja"])
def test_rbac_mode_maps_batch_response_without_builtin_fallback(
    config_overrides: Callable[..., None], transport: RBACTransport, language: str | None
) -> None:
    config_overrides(RBAC_ENABLED=True)
    transport.response = {
        "owner": [
            {"id": "workspace.owner", "name": "Owner", "type": "builtin"},
            {"id": "workspace.editor", "name": "Editor", "type": "builtin"},
        ]
    }

    result = DeploymentWorkspaceMemberRoleResolver().resolve_many(
        "workspace-1",
        "actor-1",
        [make_subject("owner", legacy_role="owner"), make_subject("omitted", legacy_role="admin")],
        language=language,
    )

    assert result == {
        "owner": (
            WorkspaceMemberRole(id="workspace.owner", name="Owner"),
            WorkspaceMemberRole(id="workspace.editor", name="Editor"),
        )
    }
    sent = transport.only_request
    assert (sent.method, sent.endpoint) == ("POST", "/rbac/members/rbac-roles/batch")
    assert (sent.tenant_id, sent.account_id) == ("workspace-1", "actor-1")
    assert sent.json == {"member_ids": ["owner", "omitted"]}
    assert sent.params == ({"language": language} if language else None)


def test_rbac_failure_propagates(config_overrides: Callable[..., None], transport: RBACTransport) -> None:
    config_overrides(RBAC_ENABLED=True)
    transport.failure = RoleResolutionError("enterprise unavailable")

    with pytest.raises(RoleResolutionError, match="enterprise unavailable"):
        DeploymentWorkspaceMemberRoleResolver().resolve_many("workspace-1", "actor-1", [make_subject("member-1")])


def test_empty_member_list_skips_enterprise_call(
    config_overrides: Callable[..., None], transport: RBACTransport
) -> None:
    config_overrides(RBAC_ENABLED=True)

    assert DeploymentWorkspaceMemberRoleResolver().resolve_many("workspace-1", "actor-1", []) == {}
    assert transport.requests == []


class RoleResolutionError(Exception):
    pass
