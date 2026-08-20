from unittest.mock import patch

from services.account_activation_adapters import (
    BillingAccountActivationEligibility,
    BillingWorkspaceMembershipCache,
    DeploymentWorkspaceInvitePolicy,
    RegisterServiceInvitationTokenStore,
)
from services.entities.account_activation_entities import InvitationLookup, InvitationToken


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
        },
    ) as find:
        result = RegisterServiceInvitationTokenStore().find(lookup)

    assert result == InvitationToken(
        account_id="account-1",
        email="invitee@example.com",
        workspace_id="workspace-1",
        role="editor",
        requires_setup=False,
    )
    find.assert_called_once_with("token-1", "workspace-1", "invitee@example.com")


def test_invitation_token_store_revokes_with_legacy_key_inputs() -> None:
    lookup = InvitationLookup(workspace_id="workspace-1", email="invitee@example.com", token="token-1")
    with patch("services.account_activation_adapters.RegisterService.revoke_token") as revoke:
        RegisterServiceInvitationTokenStore().revoke(lookup)

    revoke.assert_called_once_with("workspace-1", "invitee@example.com", "token-1")


def test_billing_eligibility_skips_gateway_when_disabled() -> None:
    with patch("services.account_activation_adapters.BillingService.get_email_freeze_type") as get_freeze_type:
        result = BillingAccountActivationEligibility(enabled=False).get_freeze_type("invitee@example.com")

    assert result is None
    get_freeze_type.assert_not_called()


def test_billing_eligibility_returns_freeze_type_when_enabled() -> None:
    with patch(
        "services.account_activation_adapters.BillingService.get_email_freeze_type",
        return_value="email_domain_suspended",
    ) as get_freeze_type:
        result = BillingAccountActivationEligibility(enabled=True).get_freeze_type("invitee@example.com")

    assert result == "email_domain_suspended"
    get_freeze_type.assert_called_once_with("invitee@example.com")


def test_membership_cache_skips_gateway_when_disabled() -> None:
    with patch("services.account_activation_adapters.BillingService.clean_billing_info_cache") as invalidate:
        BillingWorkspaceMembershipCache(enabled=False).invalidate("workspace-1")

    invalidate.assert_not_called()


def test_workspace_policy_delegates_to_existing_policy_owner() -> None:
    with patch("services.account_activation_adapters.check_workspace_member_invite_permission") as ensure_allowed:
        DeploymentWorkspaceInvitePolicy().ensure_allowed("workspace-1")

    ensure_allowed.assert_called_once_with("workspace-1")
