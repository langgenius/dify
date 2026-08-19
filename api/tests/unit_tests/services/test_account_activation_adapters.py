from contextlib import nullcontext
from unittest.mock import MagicMock, patch

import pytest

from services.account_activation_adapters import (
    BillingAccountActivationEligibility,
    DeploymentWorkspaceInvitePolicy,
    RegisterServiceInvitationTokenStore,
    assign_legacy_invitation_membership,
    assign_rbac_invitation_membership,
)
from services.account_activation_service import InvalidInvitationError, WorkspaceMemberCapacityExceededError
from services.entities.account_activation_entities import AccountInvitation, InvitationLookup, InvitationToken
from services.errors.account import MemberNotInTenantError, NoPermissionError, WorkspaceMembersLimitExceededError
from services.errors.enterprise import EnterpriseAPIError


def _invitation(
    *,
    rbac_role_id: str | None = "role-1",
    inviter_id: str | None = "inviter-1",
) -> AccountInvitation:
    return AccountInvitation(
        account_id="account-1",
        account_email="invitee@example.com",
        account_status="active",
        workspace_id="workspace-1",
        workspace_name="Workspace",
        role="editor",
        requires_setup=False,
        rbac_role_id=rbac_role_id,
        inviter_id=inviter_id,
    )


def test_invitation_token_store_converts_legacy_service_data() -> None:
    lookup = InvitationLookup(workspace_id="workspace-1", email="invitee@example.com", token="token-1")
    with patch(
        "services.account_activation_adapters.RegisterService.get_invitation_by_token",
        return_value={
            "account_id": "account-1",
            "email": "invitee@example.com",
            "workspace_id": "workspace-1",
            "role": "editor",
            "requires_setup": False,
            "rbac_role_id": "role-1",
            "inviter_id": "inviter-1",
        },
    ) as find:
        result = RegisterServiceInvitationTokenStore().find(lookup)

    assert result == InvitationToken(
        account_id="account-1",
        email="invitee@example.com",
        workspace_id="workspace-1",
        role="editor",
        requires_setup=False,
        rbac_role_id="role-1",
        inviter_id="inviter-1",
    )
    find.assert_called_once_with("token-1", "workspace-1", "invitee@example.com")


def test_invitation_token_store_revokes_with_legacy_key_inputs() -> None:
    lookup = InvitationLookup(workspace_id="workspace-1", email="invitee@example.com", token="token-1")
    with patch("services.account_activation_adapters.RegisterService.revoke_token") as revoke:
        RegisterServiceInvitationTokenStore().revoke(lookup)

    revoke.assert_called_once_with("workspace-1", "invitee@example.com", "token-1")


def test_billing_eligibility_skips_gateway_when_disabled() -> None:
    with patch("services.account_activation_adapters.BillingService.is_email_in_freeze") as is_frozen:
        result = BillingAccountActivationEligibility(enabled=False).is_frozen("invitee@example.com")

    assert result is False
    is_frozen.assert_not_called()


def test_workspace_policy_delegates_to_existing_policy_owner() -> None:
    with patch("services.account_activation_adapters.check_workspace_member_invite_permission") as ensure_allowed:
        DeploymentWorkspaceInvitePolicy().ensure_allowed("workspace-1")

    ensure_allowed.assert_called_once_with("workspace-1")


def test_legacy_membership_assigner_yields_requested_role() -> None:
    invitation = _invitation()
    with patch(
        "services.account_activation_adapters._invitation_membership_scope",
        return_value=nullcontext(),
    ) as scope:
        with assign_legacy_invitation_membership(invitation, "editor") as membership_role:
            assert membership_role == "editor"

    scope.assert_called_once_with(invitation)


def test_membership_scope_translates_capacity_failure() -> None:
    source_error = WorkspaceMembersLimitExceededError("workspace is full")
    session = MagicMock()
    with (
        patch("services.account_activation_adapters.workspace_membership_mutation_lock", return_value=nullcontext()),
        patch("services.account_activation_adapters.session_factory.create_session", return_value=nullcontext(session)),
        patch("services.account_activation_adapters.TenantService.account_belongs_to_tenant", return_value=False),
        patch(
            "services.account_activation_adapters.TenantService.ensure_member_capacity",
            side_effect=source_error,
        ),
        pytest.raises(WorkspaceMemberCapacityExceededError) as raised,
    ):
        with assign_legacy_invitation_membership(_invitation(), "editor"):
            pass

    assert raised.value.__cause__ is source_error


def test_membership_scope_skips_capacity_for_existing_member() -> None:
    session = MagicMock()
    with (
        patch("services.account_activation_adapters.workspace_membership_mutation_lock", return_value=nullcontext()),
        patch("services.account_activation_adapters.session_factory.create_session", return_value=nullcontext(session)),
        patch("services.account_activation_adapters.TenantService.account_belongs_to_tenant", return_value=True),
        patch("services.account_activation_adapters.TenantService.ensure_member_capacity") as ensure_capacity,
    ):
        with assign_legacy_invitation_membership(_invitation(), "editor") as membership_role:
            assert membership_role == "editor"

    ensure_capacity.assert_not_called()


def test_rbac_membership_assigner_delegates_to_existing_owner() -> None:
    invitation = _invitation()
    with patch(
        "services.account_activation_adapters.RBACService.MemberRoles.invited_member_assignment_scope",
        return_value=nullcontext(False),
    ) as assignment_scope:
        with assign_rbac_invitation_membership(invitation, "ignored-legacy-role") as membership_role:
            assert membership_role == "normal"

    assignment_scope.assert_called_once_with("workspace-1", "inviter-1", "account-1", "role-1")


@pytest.mark.parametrize(
    ("rbac_role_id", "inviter_id"),
    [(None, "inviter-1"), ("role-1", None)],
)
def test_rbac_membership_assigner_requires_invitation_metadata(
    rbac_role_id: str | None,
    inviter_id: str | None,
) -> None:
    with patch("services.account_activation_adapters.RBACService.MemberRoles.assign_invited_member") as assign:
        with pytest.raises(InvalidInvitationError):
            with assign_rbac_invitation_membership(
                _invitation(rbac_role_id=rbac_role_id, inviter_id=inviter_id),
                "editor",
            ):
                pass

    assign.assert_not_called()


@pytest.mark.parametrize(
    ("source_error", "application_error"),
    [
        (MemberNotInTenantError("missing inviter"), InvalidInvitationError),
        (NoPermissionError("stale role"), InvalidInvitationError),
        (ValueError("missing role"), InvalidInvitationError),
        (WorkspaceMembersLimitExceededError("workspace is full"), WorkspaceMemberCapacityExceededError),
    ],
)
def test_rbac_membership_assigner_translates_expected_failures(
    source_error: Exception,
    application_error: type[Exception],
) -> None:
    with (
        patch(
            "services.account_activation_adapters.RBACService.MemberRoles.invited_member_assignment_scope",
            side_effect=source_error,
        ),
        pytest.raises(application_error) as raised,
    ):
        with assign_rbac_invitation_membership(_invitation(), "editor"):
            pass

    assert raised.value.__cause__ is source_error


def test_rbac_membership_assigner_preserves_upstream_failure() -> None:
    source_error = EnterpriseAPIError("unavailable", status_code=503)
    with (
        patch(
            "services.account_activation_adapters.RBACService.MemberRoles.invited_member_assignment_scope",
            side_effect=source_error,
        ),
        pytest.raises(EnterpriseAPIError) as raised,
    ):
        with assign_rbac_invitation_membership(_invitation(), "editor"):
            pass

    assert raised.value is source_error
