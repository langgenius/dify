from collections.abc import Generator
from contextlib import contextmanager, nullcontext
from unittest.mock import MagicMock, Mock

import pytest
from werkzeug.exceptions import Forbidden

from services.account_activation_service import (
    AccountActivationEligibility,
    AccountActivationRepository,
    AccountActivationService,
    FrozenAccountError,
    InvalidInvitationError,
    InvitationAccountMismatchError,
    InvitationTokenStore,
    WorkspaceInvitePolicy,
)
from services.entities.account_activation_entities import (
    AccountInvitation,
    AccountSetup,
    ActivationCommand,
    InvitationLookup,
    InvitationToken,
)


def _lookup(email: str | None = "invitee@example.com") -> InvitationLookup:
    return InvitationLookup(workspace_id="workspace-1", email=email, token="token-1")


def _token() -> InvitationToken:
    return InvitationToken(
        token="token-1",
        account_id="account-1",
        email="invitee@example.com",
        workspace_id="workspace-1",
        role="admin",
        inviter_id="inviter-1",
    )


def _invitation(
    *,
    account_status: str = "pending",
    role: str = "admin",
    rbac_role_id: str | None = None,
    inviter_id: str = "inviter-1",
) -> AccountInvitation:
    return AccountInvitation(
        token="token-1",
        account_id="account-1",
        account_email="invitee@example.com",
        account_status=account_status,
        workspace_id="workspace-1",
        workspace_name="Workspace",
        role=role,
        inviter_id=inviter_id,
        rbac_role_id=rbac_role_id,
    )


def _service(*, membership_assigner: Mock | None = None) -> tuple[AccountActivationService, Mock, Mock, Mock, Mock]:
    tokens = Mock(spec=InvitationTokenStore)
    accounts = Mock(spec=AccountActivationRepository)
    policy = Mock(spec=WorkspaceInvitePolicy)
    eligibility = Mock(spec=AccountActivationEligibility)
    eligibility.is_frozen.return_value = False
    membership_assigner = membership_assigner or Mock(return_value=nullcontext("normal"))
    service = AccountActivationService(
        tokens=tokens,
        accounts=accounts,
        workspace_policy=policy,
        eligibility=eligibility,
        membership_assigner=membership_assigner,
    )
    return service, tokens, accounts, policy, eligibility


class TestCheckInvitation:
    def test_returns_invalid_without_touching_database_when_token_is_missing(self) -> None:
        service, tokens, accounts, policy, _ = _service()
        tokens.find.return_value = None

        result = service.check(_lookup())

        assert result.is_valid is False
        assert result.data is None
        accounts.resolve.assert_not_called()
        policy.ensure_allowed.assert_not_called()

    def test_does_not_repeat_database_lookup_for_normalized_email(self) -> None:
        service, tokens, accounts, policy, _ = _service()
        token = _token()
        tokens.find.return_value = token
        accounts.resolve.return_value = None

        result = service.check(_lookup())

        assert result.is_valid is False
        accounts.resolve.assert_called_once_with(token)
        policy.ensure_allowed.assert_not_called()

    def test_resolves_mixed_case_email_with_one_token_lookup(self) -> None:
        service, tokens, accounts, policy, _ = _service()
        token = _token()
        invitation = _invitation()
        tokens.find.return_value = token
        accounts.resolve.return_value = invitation

        result = service.check(_lookup("Invitee@Example.com"))

        assert result.is_valid is True
        assert result.data is not None
        assert result.data.requires_setup is True
        assert result.data.account_status == "pending"
        tokens.find.assert_called_once_with(_lookup("Invitee@Example.com"))
        accounts.resolve.assert_called_once_with(token)
        policy.ensure_allowed.assert_called_once_with("workspace-1")

    @pytest.mark.parametrize("account_status", ["banned", "closed", "uninitialized"])
    def test_rejects_non_activatable_account_snapshot(self, account_status: str) -> None:
        service, tokens, accounts, policy, eligibility = _service()
        tokens.find.return_value = _token()
        accounts.resolve.return_value = _invitation(account_status=account_status)

        result = service.check(_lookup())

        assert result.is_valid is False
        with pytest.raises(InvalidInvitationError):
            service.activate(ActivationCommand(invitation=_lookup()), authenticated_account_id=None)
        policy.ensure_allowed.assert_not_called()
        eligibility.is_frozen.assert_not_called()
        accounts.activate.assert_not_called()
        tokens.revoke.assert_not_called()


class TestActivateInvitation:
    def test_workspace_policy_failure_has_no_side_effects(self) -> None:
        membership_assigner = Mock()
        service, tokens, accounts, policy, eligibility = _service(membership_assigner=membership_assigner)
        tokens.find.return_value = _token()
        accounts.resolve.return_value = _invitation(
            account_status="active",
            rbac_role_id="role-1",
            inviter_id="inviter-1",
        )
        policy.ensure_allowed.side_effect = Forbidden()

        with pytest.raises(Forbidden):
            service.activate(ActivationCommand(invitation=_lookup()), authenticated_account_id=None)

        policy.ensure_allowed.assert_called_once_with("workspace-1")
        eligibility.is_frozen.assert_not_called()
        membership_assigner.assert_not_called()
        accounts.activate.assert_not_called()
        tokens.revoke.assert_not_called()

    def test_rejects_authenticated_account_mismatch_before_side_effects(self) -> None:
        service, tokens, accounts, _, eligibility = _service()
        tokens.find.return_value = _token()
        accounts.resolve.return_value = _invitation()

        with pytest.raises(InvitationAccountMismatchError):
            service.activate(
                ActivationCommand(invitation=_lookup()),
                authenticated_account_id="different-account",
            )

        eligibility.is_frozen.assert_not_called()
        tokens.revoke.assert_not_called()
        accounts.activate.assert_not_called()

    def test_rejects_frozen_account_without_consuming_token(self) -> None:
        service, tokens, accounts, _, eligibility = _service()
        tokens.find.return_value = _token()
        accounts.resolve.return_value = _invitation()
        eligibility.is_frozen.return_value = True

        with pytest.raises(FrozenAccountError):
            service.activate(ActivationCommand(invitation=_lookup()), authenticated_account_id=None)

        eligibility.is_frozen.assert_called_once_with("invitee@example.com")
        tokens.revoke.assert_not_called()
        accounts.activate.assert_not_called()

    def test_requires_all_setup_fields_before_consuming_token(self) -> None:
        service, tokens, accounts, _, _ = _service()
        tokens.find.return_value = _token()
        accounts.resolve.return_value = _invitation()

        with pytest.raises(InvalidInvitationError):
            service.activate(
                ActivationCommand(invitation=_lookup(), name="Name"),
                authenticated_account_id=None,
            )

        tokens.revoke.assert_not_called()
        accounts.activate.assert_not_called()

    def test_activates_anonymous_invitation_and_revokes_token_last(self) -> None:
        membership_assigner = Mock()
        service, tokens, accounts, _, eligibility = _service(membership_assigner=membership_assigner)
        tokens.find.return_value = _token()
        invitation = _invitation(role="owner")
        accounts.resolve.return_value = invitation
        operations: list[str] = []

        @contextmanager
        def assign_membership(*_args: object) -> Generator[str]:
            operations.append("remote-assigned")
            yield "normal"
            operations.append("scope-exit")

        membership_assigner.side_effect = assign_membership

        def persist(*_args: object, **_kwargs: object) -> bool:
            operations.append("persist")
            return True

        accounts.activate.side_effect = persist
        tokens.revoke.side_effect = lambda _token: operations.append("revoke")
        command = ActivationCommand(
            invitation=_lookup("Invitee@Example.com"),
            name="John Doe",
            interface_language="en-US",
            timezone="UTC",
        )

        service.activate(command, authenticated_account_id=None)

        eligibility.is_frozen.assert_called_once_with("invitee@example.com")
        membership_assigner.assert_called_once_with(invitation, "normal")
        tokens.revoke.assert_called_once_with("token-1")
        accounts.activate.assert_called_once_with(
            invitation,
            setup=AccountSetup(name="John Doe", interface_language="en-US", timezone="UTC"),
            membership_role="normal",
        )
        assert operations == ["remote-assigned", "persist", "scope-exit", "revoke"]

    def test_ignores_setup_fields_for_active_account(self) -> None:
        service, tokens, accounts, _, _ = _service()
        tokens.find.return_value = _token()
        invitation = _invitation(
            account_status="active",
            role="editor",
        )
        accounts.resolve.return_value = invitation
        accounts.activate.return_value = True

        service.activate(
            ActivationCommand(
                invitation=_lookup(),
                name="Ignored",
                interface_language="zh-Hans",
                timezone="Asia/Shanghai",
            ),
            authenticated_account_id="account-1",
        )

        accounts.activate.assert_called_once_with(invitation, setup=None, membership_role="normal")

    def test_membership_assignment_failure_preserves_invitation(self) -> None:
        error = RuntimeError("remote role assignment failed")
        assignment_scope = MagicMock()

        def fail_before_local_activation() -> None:
            raise error

        assignment_scope.__enter__.side_effect = fail_before_local_activation
        membership_assigner = Mock(return_value=assignment_scope)
        service, tokens, accounts, _, _ = _service(membership_assigner=membership_assigner)
        tokens.find.return_value = _token()
        accounts.resolve.return_value = _invitation(
            account_status="active",
            rbac_role_id="role-1",
            inviter_id="inviter-1",
        )

        with pytest.raises(RuntimeError) as raised:
            service.activate(ActivationCommand(invitation=_lookup()), authenticated_account_id=None)

        assert raised.value is error
        accounts.activate.assert_not_called()
        tokens.revoke.assert_not_called()

    def test_persistence_failure_preserves_invitation(self) -> None:
        membership_assigner = Mock(return_value=nullcontext("normal"))
        service, tokens, accounts, _, _ = _service(membership_assigner=membership_assigner)
        tokens.find.return_value = _token()
        accounts.resolve.return_value = _invitation(account_status="active")
        accounts.activate.return_value = False

        with pytest.raises(InvalidInvitationError):
            service.activate(ActivationCommand(invitation=_lookup()), authenticated_account_id=None)

        membership_assigner.assert_called_once()
        tokens.revoke.assert_not_called()
