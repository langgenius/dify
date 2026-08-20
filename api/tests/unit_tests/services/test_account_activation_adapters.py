from contextlib import nullcontext
from unittest.mock import MagicMock, patch

import pytest

from enums import DeploymentEdition
from services.account_activation_adapters import (
    BillingAccountActivationEligibility,
    DeploymentWorkspaceInvitePolicy,
    RegisterServiceInvitationTokenStore,
    assign_legacy_invitation_membership,
    assign_rbac_invitation_membership,
)
from services.account_activation_service import InvalidInvitationError
from services.entities.account_activation_entities import AccountInvitation, InvitationLookup, InvitationToken
from services.errors.account import MemberNotInTenantError, NoPermissionError, WorkspaceMembersLimitExceededError
from services.errors.enterprise import EnterpriseAPIError


def _invitation(
    *,
    rbac_role_id: str | None = "role-1",
    inviter_id: str = "inviter-1",
) -> AccountInvitation:
    return AccountInvitation(
        token="token-1",
        account_id="account-1",
        account_email="invitee@example.com",
        account_status="active",
        workspace_id="workspace-1",
        workspace_name="Workspace",
        role="editor",
        inviter_id=inviter_id,
        rbac_role_id=rbac_role_id,
    )


def test_invitation_token_store_converts_service_data_with_case_insensitive_email() -> None:
    lookup = InvitationLookup(workspace_id="workspace-1", email="Invitee@Example.com", token="token-1")
    with patch(
        "services.account_activation_adapters.RegisterService.get_invitation_by_token",
        return_value={
            "account_id": "account-1",
            "email": "invitee@example.com",
            "workspace_id": "workspace-1",
            "role": "editor",
            "rbac_role_id": "role-1",
            "inviter_id": "inviter-1",
        },
    ) as find:
        result = RegisterServiceInvitationTokenStore().find(lookup)

    assert result == InvitationToken(
        token="token-1",
        account_id="account-1",
        email="invitee@example.com",
        workspace_id="workspace-1",
        role="editor",
        inviter_id="inviter-1",
        rbac_role_id="role-1",
    )
    find.assert_called_once_with("token-1")


def test_billing_eligibility_skips_gateway_when_disabled() -> None:
    with patch("services.account_activation_adapters.BillingService.is_email_in_freeze") as is_frozen:
        result = BillingAccountActivationEligibility(enabled=False).is_frozen("invitee@example.com")

    assert result is False
    is_frozen.assert_not_called()


def test_workspace_policy_delegates_to_existing_policy_owner() -> None:
    with patch("services.account_activation_adapters.check_workspace_member_invite_permission") as ensure_allowed:
        DeploymentWorkspaceInvitePolicy().ensure_allowed("workspace-1")

    ensure_allowed.assert_called_once_with("workspace-1")


def test_membership_scope_preserves_capacity_failure() -> None:
    source_error = WorkspaceMembersLimitExceededError("workspace is full")
    session = MagicMock()
    with (
        patch(
            "services.account_activation_adapters.account_workspace_membership_mutation_lock",
            return_value=nullcontext(),
        ),
        patch("services.account_activation_adapters.RegisterService.is_current_invitation", return_value=True),
        patch("services.account_activation_adapters.session_factory.create_session", return_value=nullcontext(session)),
        patch("services.account_activation_adapters.TenantService.account_belongs_to_tenant", return_value=False),
        patch(
            "services.account_activation_adapters.TenantService.get_membership_eligible_account",
            return_value=MagicMock(),
        ),
        patch("services.account_activation_adapters.TenantService.check_member_permission"),
        patch(
            "services.account_activation_adapters.TenantService.ensure_member_capacity",
            side_effect=source_error,
        ),
        pytest.raises(WorkspaceMembersLimitExceededError) as raised,
    ):
        with assign_legacy_invitation_membership(_invitation(), "editor"):
            pass

    assert raised.value is source_error


def test_membership_scope_rejects_superseded_token_before_database_access() -> None:
    with (
        patch(
            "services.account_activation_adapters.account_workspace_membership_mutation_lock",
            return_value=nullcontext(),
        ),
        patch("services.account_activation_adapters.RegisterService.is_current_invitation", return_value=False),
        patch("services.account_activation_adapters.session_factory.create_session") as create_session,
        pytest.raises(InvalidInvitationError),
    ):
        with assign_legacy_invitation_membership(_invitation(), "editor"):
            pass

    create_session.assert_not_called()


def test_membership_scope_skips_capacity_for_existing_member() -> None:
    session = MagicMock()
    with (
        patch(
            "services.account_activation_adapters.account_workspace_membership_mutation_lock",
            return_value=nullcontext(),
        ),
        patch("services.account_activation_adapters.RegisterService.is_current_invitation", return_value=True),
        patch("services.account_activation_adapters.session_factory.create_session", return_value=nullcontext(session)),
        patch("services.account_activation_adapters.TenantService.account_belongs_to_tenant", return_value=True),
        patch(
            "services.account_activation_adapters.TenantService.get_membership_eligible_account",
            return_value=MagicMock(),
        ),
        patch("services.account_activation_adapters.TenantService.ensure_member_capacity") as ensure_capacity,
    ):
        with assign_legacy_invitation_membership(_invitation(), "editor") as membership_role:
            assert membership_role == "editor"

    ensure_capacity.assert_not_called()


def test_membership_scope_invalidates_cloud_billing_cache_after_successful_new_membership() -> None:
    session = MagicMock()
    with (
        patch("services.account_activation_adapters.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
        patch(
            "services.account_activation_adapters.account_workspace_membership_mutation_lock",
            return_value=nullcontext(),
        ),
        patch("services.account_activation_adapters.RegisterService.is_current_invitation", return_value=True),
        patch("services.account_activation_adapters.session_factory.create_session", return_value=nullcontext(session)),
        patch("services.account_activation_adapters.TenantService.account_belongs_to_tenant", return_value=False),
        patch(
            "services.account_activation_adapters.TenantService.get_membership_eligible_account",
            return_value=MagicMock(),
        ),
        patch("services.account_activation_adapters.TenantService.check_member_permission"),
        patch("services.account_activation_adapters.TenantService.ensure_member_capacity"),
        patch("services.account_activation_adapters.BillingService.clean_billing_info_cache") as clear_cache,
    ):
        with assign_legacy_invitation_membership(_invitation(), "editor"):
            clear_cache.assert_not_called()

    clear_cache.assert_called_once_with("workspace-1")


def test_rbac_membership_assigner_delegates_to_existing_owner() -> None:
    invitation = _invitation()
    with patch(
        "services.account_activation_adapters.RBACService.MemberRoles.invited_member_assignment_scope",
        return_value=nullcontext(False),
    ) as assignment_scope:
        with assign_rbac_invitation_membership(invitation, "ignored-legacy-role") as membership_role:
            assert membership_role == "normal"

    assignment_scope.assert_called_once_with("workspace-1", "inviter-1", "account-1", "role-1", "token-1")


def test_rbac_membership_assigner_requires_rbac_role() -> None:
    with patch(
        "services.account_activation_adapters.RBACService.MemberRoles.invited_member_assignment_scope"
    ) as assign:
        with pytest.raises(InvalidInvitationError):
            with assign_rbac_invitation_membership(
                _invitation(rbac_role_id=None),
                "editor",
            ):
                pass

    assign.assert_not_called()


@pytest.mark.parametrize(
    "source_error",
    [
        MemberNotInTenantError("missing inviter"),
        NoPermissionError("stale role"),
        ValueError("missing role"),
    ],
)
def test_rbac_membership_assigner_translates_expected_failures(
    source_error: Exception,
) -> None:
    with (
        patch(
            "services.account_activation_adapters.RBACService.MemberRoles.invited_member_assignment_scope",
            side_effect=source_error,
        ),
        pytest.raises(InvalidInvitationError) as raised,
    ):
        with assign_rbac_invitation_membership(_invitation(), "editor"):
            pass

    assert raised.value.__cause__ is source_error


@pytest.mark.parametrize(
    "source_error",
    [
        EnterpriseAPIError("unavailable", status_code=503),
        WorkspaceMembersLimitExceededError("workspace is full"),
    ],
)
def test_rbac_membership_assigner_preserves_upstream_failure(source_error: Exception) -> None:
    with (
        patch(
            "services.account_activation_adapters.RBACService.MemberRoles.invited_member_assignment_scope",
            side_effect=source_error,
        ),
        pytest.raises(type(source_error)) as raised,
    ):
        with assign_rbac_invitation_membership(_invitation(), "editor"):
            pass

    assert raised.value is source_error
