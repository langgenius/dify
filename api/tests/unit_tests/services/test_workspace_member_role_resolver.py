from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from services import workspace_member_role_resolver
from services.enterprise.rbac_service import MemberRolesResponse, RBACRole
from services.workspace_member_query_service import WorkspaceMemberRole, WorkspaceMemberRoleSubject


def make_subject(account_id: str, *, legacy_role: str = "normal") -> WorkspaceMemberRoleSubject:
    return WorkspaceMemberRoleSubject(account_id=account_id, legacy_role=legacy_role)


@pytest.fixture
def batch_get(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    batch_get = MagicMock()
    monkeypatch.setattr(
        workspace_member_role_resolver.enterprise_rbac_service.RBACService.MemberRoles,
        "batch_get",
        batch_get,
    )
    return batch_get


def configure_rbac(monkeypatch: pytest.MonkeyPatch, *, enabled: bool) -> None:
    monkeypatch.setattr(
        workspace_member_role_resolver,
        "dify_config",
        SimpleNamespace(RBAC_ENABLED=enabled),
    )


def test_legacy_mode_projects_join_roles_without_enterprise_call(
    monkeypatch: pytest.MonkeyPatch,
    batch_get: MagicMock,
) -> None:
    configure_rbac(monkeypatch, enabled=False)
    owner = make_subject("owner", legacy_role="owner")
    member = make_subject("member")

    result = workspace_member_role_resolver.DeploymentWorkspaceMemberRoleResolver().resolve_many(
        "workspace-1",
        "actor-1",
        [owner, member],
    )

    assert result == {
        "owner": (WorkspaceMemberRole(id="owner", name="owner"),),
        "member": (WorkspaceMemberRole(id="normal", name="normal"),),
    }
    batch_get.assert_not_called()


def test_rbac_mode_maps_batch_response_without_legacy_fallback(
    monkeypatch: pytest.MonkeyPatch,
    batch_get: MagicMock,
) -> None:
    configure_rbac(monkeypatch, enabled=True)
    owner = make_subject("owner", legacy_role="owner")
    omitted = make_subject("omitted", legacy_role="admin")
    batch_get.return_value = [
        MemberRolesResponse(
            account_id=owner.account_id,
            roles=[
                RBACRole(
                    id="workspace.owner",
                    name="Owner",
                    type="builtin",
                ),
                RBACRole(
                    id="workspace.editor",
                    name="Editor",
                    type="builtin",
                ),
            ],
        )
    ]

    result = workspace_member_role_resolver.DeploymentWorkspaceMemberRoleResolver().resolve_many(
        "workspace-1",
        "actor-1",
        [owner, omitted],
    )

    assert result == {
        "owner": (
            WorkspaceMemberRole(id="workspace.owner", name="Owner"),
            WorkspaceMemberRole(id="workspace.editor", name="Editor"),
        )
    }
    assert "omitted" not in result
    batch_get.assert_called_once_with("workspace-1", "actor-1", ["owner", "omitted"])


def test_rbac_failure_propagates(
    monkeypatch: pytest.MonkeyPatch,
    batch_get: MagicMock,
) -> None:
    configure_rbac(monkeypatch, enabled=True)
    batch_get.side_effect = RoleResolutionError("enterprise unavailable")

    with pytest.raises(RoleResolutionError, match="enterprise unavailable"):
        workspace_member_role_resolver.DeploymentWorkspaceMemberRoleResolver().resolve_many(
            "workspace-1",
            "actor-1",
            [make_subject("member-1")],
        )


def test_empty_member_list_skips_enterprise_call(
    monkeypatch: pytest.MonkeyPatch,
    batch_get: MagicMock,
) -> None:
    configure_rbac(monkeypatch, enabled=True)

    result = workspace_member_role_resolver.DeploymentWorkspaceMemberRoleResolver().resolve_many(
        "workspace-1",
        "actor-1",
        [],
    )

    assert result == {}
    batch_get.assert_not_called()


class RoleResolutionError(Exception):
    pass
