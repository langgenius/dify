from unittest.mock import Mock, call

import pytest

from services.account_activation_service import (
    AccountActivationEligibility,
    AccountActivationRepository,
    AccountActivationService,
    EmailDomainSuspendedError,
    FrozenAccountError,
    InvalidInvitationError,
    InvitationAccountMismatchError,
    InvitationTokenStore,
    WorkspaceInvitePolicy,
    WorkspaceMembershipCache,
)
from services.entities.account_activation_entities import (
    AccountInvitation,
    AccountSetup,
    ActivationCommand,
    ActivationPersistenceResult,
    InvitationLookup,
    InvitationToken,
)


def _lookup(email: str | None = "invitee@example.com") -> InvitationLookup:
    return InvitationLookup(workspace_id="workspace-1", email=email, token="token-1")


def _token() -> InvitationToken:
    return InvitationToken(
        account_id="account-1",
        email="invitee@example.com",
        workspace_id="workspace-1",
        role="admin",
        requires_setup=True,
    )


def _invitation(
    *,
    account_status: str = "pending",
    role: str | None = "admin",
    requires_setup: bool | None = True,
) -> AccountInvitation:
    return AccountInvitation(
        account_id="account-1",
        account_email="invitee@example.com",
        account_status=account_status,
        workspace_id="workspace-1",
        workspace_name="Workspace",
        role=role,
        requires_setup=requires_setup,
    )


def _service() -> tuple[AccountActivationService, Mock, Mock, Mock, Mock, Mock]:
    tokens = Mock(spec=InvitationTokenStore)
    accounts = Mock(spec=AccountActivationRepository)
    policy = Mock(spec=WorkspaceInvitePolicy)
    eligibility = Mock(spec=AccountActivationEligibility)
    membership_cache = Mock(spec=WorkspaceMembershipCache)
    eligibility.get_freeze_type.return_value = None
    service = AccountActivationService(
        tokens=tokens,
        accounts=accounts,
        workspace_policy=policy,
        eligibility=eligibility,
        membership_cache=membership_cache,
    )
    return service, tokens, accounts, policy, eligibility, membership_cache


class TestCheckInvitation:
    def test_returns_invalid_without_touching_database_when_token_is_missing(self) -> None:
        service, tokens, accounts, policy, _, _ = _service()
        tokens.find.return_value = None

        result = service.check(_lookup())

        assert result.is_valid is False
        assert result.data is None
        accounts.resolve.assert_not_called()
        policy.ensure_allowed.assert_not_called()

    def test_does_not_repeat_database_lookup_for_normalized_email(self) -> None:
        service, tokens, accounts, policy, _, _ = _service()
        token = _token()
        tokens.find.return_value = token
        accounts.resolve.return_value = None

        result = service.check(_lookup())

        assert result.is_valid is False
        accounts.resolve.assert_called_once_with(token)
        policy.ensure_allowed.assert_not_called()

    def test_falls_back_to_normalized_email_and_applies_workspace_policy(self) -> None:
        service, tokens, accounts, policy, _, _ = _service()
        upper_case_token = InvitationToken(
            account_id="account-1",
            email="Invitee@Example.com",
            workspace_id="workspace-1",
        )
        normalized_token = _token()
        invitation = _invitation(requires_setup=None)
        tokens.find.side_effect = [upper_case_token, normalized_token]
        accounts.resolve.side_effect = [None, invitation]

        result = service.check(_lookup("Invitee@Example.com"))

        assert result.is_valid is True
        assert result.data is not None
        assert result.data.requires_setup is True
        assert result.data.account_status == "pending"
        assert tokens.find.call_args_list == [
            call(_lookup("Invitee@Example.com")),
            call(_lookup("invitee@example.com")),
        ]
        assert accounts.resolve.call_args_list == [call(upper_case_token), call(normalized_token)]
        policy.ensure_allowed.assert_called_once_with("workspace-1")


class TestActivateInvitation:
    def test_rejects_authenticated_account_mismatch_before_side_effects(self) -> None:
        service, tokens, accounts, _, eligibility, _ = _service()
        tokens.find.return_value = _token()
        accounts.resolve.return_value = _invitation()

        with pytest.raises(InvitationAccountMismatchError):
            service.activate(
                ActivationCommand(invitation=_lookup()),
                authenticated_account_id="different-account",
            )

        eligibility.get_freeze_type.assert_not_called()
        tokens.revoke.assert_not_called()
        accounts.activate.assert_not_called()

    def test_rejects_frozen_account_without_consuming_token(self) -> None:
        service, tokens, accounts, _, eligibility, _ = _service()
        tokens.find.return_value = _token()
        accounts.resolve.return_value = _invitation()
        eligibility.get_freeze_type.return_value = "freeze"

        with pytest.raises(FrozenAccountError):
            service.activate(ActivationCommand(invitation=_lookup()), authenticated_account_id=None)

        eligibility.get_freeze_type.assert_called_once_with("invitee@example.com")
        tokens.revoke.assert_not_called()
        accounts.activate.assert_not_called()

    def test_requires_all_setup_fields_before_consuming_token(self) -> None:
        service, tokens, accounts, _, _, _ = _service()
        tokens.find.return_value = _token()
        accounts.resolve.return_value = _invitation()

        with pytest.raises(InvalidInvitationError):
            service.activate(
                ActivationCommand(invitation=_lookup(), name="Name"),
                authenticated_account_id=None,
            )

        tokens.revoke.assert_not_called()
        accounts.activate.assert_not_called()

    def test_rejects_suspended_email_domain_without_consuming_token(self) -> None:
        service, tokens, accounts, _, eligibility, _ = _service()
        tokens.find.return_value = _token()
        accounts.resolve.return_value = _invitation()
        eligibility.get_freeze_type.return_value = "email_domain_suspended"

        with pytest.raises(EmailDomainSuspendedError):
            service.activate(ActivationCommand(invitation=_lookup()), authenticated_account_id=None)

        eligibility.get_freeze_type.assert_called_once_with("invitee@example.com")
        tokens.revoke.assert_not_called()
        accounts.activate.assert_not_called()

    def test_activates_anonymous_invitation_and_invalidates_new_membership_cache(self) -> None:
        service, tokens, accounts, _, eligibility, membership_cache = _service()
        tokens.find.return_value = _token()
        invitation = _invitation(role="owner")
        accounts.resolve.return_value = invitation
        accounts.activate.return_value = ActivationPersistenceResult(membership_created=True)
        command = ActivationCommand(
            invitation=_lookup("Invitee@Example.com"),
            name="John Doe",
            interface_language="en-US",
            timezone="UTC",
        )

        service.activate(command, authenticated_account_id=None)

        eligibility.get_freeze_type.assert_called_once_with("invitee@example.com")
        tokens.revoke.assert_called_once_with(_lookup("invitee@example.com"))
        accounts.activate.assert_called_once_with(
            invitation,
            role="normal",
            setup=AccountSetup(name="John Doe", interface_language="en-US", timezone="UTC"),
        )
        membership_cache.invalidate.assert_called_once_with("workspace-1")

    def test_preserves_existing_membership_cache_and_ignores_setup_fields(self) -> None:
        service, tokens, accounts, _, _, membership_cache = _service()
        tokens.find.return_value = _token()
        invitation = _invitation(
            account_status="active",
            role="editor",
            requires_setup=False,
        )
        accounts.resolve.return_value = invitation
        accounts.activate.return_value = ActivationPersistenceResult(membership_created=False)

        service.activate(
            ActivationCommand(
                invitation=_lookup(),
                name="Ignored",
                interface_language="zh-Hans",
                timezone="Asia/Shanghai",
            ),
            authenticated_account_id="account-1",
        )

        accounts.activate.assert_called_once_with(invitation, role="editor", setup=None)
        membership_cache.invalidate.assert_not_called()
