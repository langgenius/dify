from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from services import workspace_member_query_compat
from services.enterprise.rbac_service import MemberRolesResponse, RBACRole
from services.workspace_member_query_service import WorkspaceMemberRecord, WorkspaceMemberRole


def make_member(member_id: str, *, legacy_role: str = "normal") -> WorkspaceMemberRecord:
    created_at = datetime(2026, 1, 1)
    return WorkspaceMemberRecord(
        id=member_id,
        name=f"Member {member_id}",
        email=f"{member_id}@example.com",
        avatar=None,
        last_login_at=None,
        last_active_at=created_at,
        created_at=created_at,
        status="active",
        legacy_role=legacy_role,
    )


@pytest.fixture
def batch_get(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    batch_get = MagicMock()
    monkeypatch.setattr(
        workspace_member_query_compat.enterprise_rbac_service.RBACService.MemberRoles,
        "batch_get",
        batch_get,
    )
    return batch_get


def configure_rbac(monkeypatch: pytest.MonkeyPatch, *, enabled: bool) -> None:
    monkeypatch.setattr(
        workspace_member_query_compat,
        "dify_config",
        SimpleNamespace(RBAC_ENABLED=enabled),
    )


def test_legacy_mode_projects_join_roles_without_enterprise_call(
    monkeypatch: pytest.MonkeyPatch,
    batch_get: MagicMock,
) -> None:
    configure_rbac(monkeypatch, enabled=False)
    owner = make_member("owner", legacy_role="owner")
    member_without_role = make_member("no-role", legacy_role="")

    result = workspace_member_query_compat.LegacyWorkspaceMemberRoleGateway().resolve_many(
        "workspace-1",
        "actor-1",
        [owner, member_without_role],
    )

    assert result == {
        "owner": (WorkspaceMemberRole(id="owner", name="owner"),),
        "no-role": (),
    }
    batch_get.assert_not_called()


def test_rbac_mode_maps_batch_response_without_legacy_fallback(
    monkeypatch: pytest.MonkeyPatch,
    batch_get: MagicMock,
) -> None:
    configure_rbac(monkeypatch, enabled=True)
    owner = make_member("owner", legacy_role="owner")
    omitted = make_member("omitted", legacy_role="admin")
    batch_get.return_value = [
        MemberRolesResponse(
            account_id=owner.id,
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

    result = workspace_member_query_compat.LegacyWorkspaceMemberRoleGateway().resolve_many(
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
        workspace_member_query_compat.LegacyWorkspaceMemberRoleGateway().resolve_many(
            "workspace-1",
            "actor-1",
            [make_member("member-1")],
        )


def test_empty_member_list_skips_enterprise_call(
    monkeypatch: pytest.MonkeyPatch,
    batch_get: MagicMock,
) -> None:
    configure_rbac(monkeypatch, enabled=True)

    result = workspace_member_query_compat.LegacyWorkspaceMemberRoleGateway().resolve_many(
        "workspace-1",
        "actor-1",
        [],
    )

    assert result == {}
    batch_get.assert_not_called()


class RoleResolutionError(Exception):
    pass
