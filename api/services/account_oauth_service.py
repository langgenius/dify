"""Application service for Console account OAuth sign-in."""

from collections.abc import Callable, Mapping, Sequence
from contextlib import AbstractContextManager
from datetime import datetime
from typing import Protocol

from services.account_errors import (
    AccountEmailDomainSuspendedError,
    AccountEmailFrozenError,
    InvalidOAuthInvitationError,
    InvalidOAuthProviderError,
    OAuthAccountBannedError,
    OAuthAccountNotFoundError,
    OAuthInvitationAccountMismatchError,
    OAuthRegistrationError,
    OAuthWorkspaceCreationNotAllowedError,
)
from services.account_ports import AccountIntegrationRepository, AccountRepository, AccountWorkspaceMembershipQuery
from services.entities.account_entities import AccountSnapshot
from services.entities.account_oauth_entities import (
    AccountSessionTokens,
    OAuthAccountRegistration,
    OAuthAuthorizationRequest,
    OAuthCallbackCommand,
    OAuthCallbackResult,
    OAuthIdentity,
    OAuthInvitation,
    OAuthInvitationResult,
    OAuthSignInResult,
)

_BANNED_ACCOUNT_STATUS = "banned"
_PENDING_ACCOUNT_STATUS = "pending"


class OAuthProviderGateway(Protocol):
    def get_authorization_url(self, request: OAuthAuthorizationRequest) -> str: ...

    def get_identity(self, code: str) -> OAuthIdentity: ...


class OAuthInvitationGateway(Protocol):
    def resolve(self, invite_token: str) -> OAuthInvitation | None: ...


class OAuthAccountClaimLease(Protocol):
    def ensure_owned(self) -> None: ...


class OAuthAccountClaimLock(Protocol):
    def acquire(self, *, provider: str, open_id: str, email: str) -> AbstractContextManager[OAuthAccountClaimLease]: ...

    def acquire_account(self, account_id: str) -> AbstractContextManager[OAuthAccountClaimLease]: ...


class OAuthAccountRegistrationGateway(Protocol):
    def register(self, registration: OAuthAccountRegistration) -> str: ...


class OAuthWorkspaceGateway(Protocol):
    def create_owner_workspace(self, account_id: str) -> None: ...

    def try_join_default_workspace(self, account_id: str) -> None: ...


class OAuthSessionGateway(Protocol):
    def login(self, account_id: str, *, ip_address: str) -> AccountSessionTokens: ...


class OAuthRegistrationPolicyGateway(Protocol):
    def is_registration_allowed(self) -> bool: ...

    def get_freeze_type(self, email: str) -> str | None: ...


class OAuthWorkspacePolicyGateway(Protocol):
    def is_creation_allowed(self) -> bool: ...


class AccountOAuthService:
    def __init__(
        self,
        *,
        providers: Mapping[str, OAuthProviderGateway],
        accounts: AccountRepository,
        integrations: AccountIntegrationRepository,
        memberships: AccountWorkspaceMembershipQuery,
        invitations: OAuthInvitationGateway,
        account_claims: OAuthAccountClaimLock,
        registration: OAuthAccountRegistrationGateway,
        workspaces: OAuthWorkspaceGateway,
        sessions: OAuthSessionGateway,
        registration_policy: OAuthRegistrationPolicyGateway,
        workspace_policy: OAuthWorkspacePolicyGateway,
        supported_languages: Sequence[str],
        now: Callable[[], datetime],
    ) -> None:
        self._providers = dict(providers)
        self._accounts = accounts
        self._integrations = integrations
        self._memberships = memberships
        self._invitations = invitations
        self._account_claims = account_claims
        self._registration = registration
        self._workspaces = workspaces
        self._sessions = sessions
        self._registration_policy = registration_policy
        self._workspace_policy = workspace_policy
        self._supported_languages = tuple(supported_languages)
        self._now = now

    def start_authorization(self, provider: str, request: OAuthAuthorizationRequest) -> str:
        return self._provider(provider).get_authorization_url(request)

    def complete_authorization(self, command: OAuthCallbackCommand) -> OAuthCallbackResult:
        provider = self._provider(command.provider)
        identity = provider.get_identity(command.code)
        normalized_email = self._normalize_email(identity.email)

        with self._account_claims.acquire(
            provider=command.provider,
            open_id=identity.id,
            email=normalized_email,
        ) as identity_claim:
            return self._complete_claimed_authorization(command, identity, identity_claim)

    def _complete_claimed_authorization(
        self,
        command: OAuthCallbackCommand,
        identity: OAuthIdentity,
        identity_claim: OAuthAccountClaimLease,
    ) -> OAuthCallbackResult:
        if command.invite_token is not None:
            return self._complete_invitation(command, identity, identity_claim)

        account = self._resolve_account(command.provider, identity)
        oauth_new_user = account is None
        if account is None:
            identity_claim.ensure_owned()
            account = self._register_account(command, identity)
            identity_claim.ensure_owned()

        self._ensure_account_can_login(account)
        identity_claim.ensure_owned()
        self._integrations.link(account.id, provider=command.provider, open_id=identity.id)
        identity_claim.ensure_owned()
        with self._account_claims.acquire_account(account.id) as account_claim:
            if oauth_new_user:
                self._provision_new_account_workspaces(account.id, account_claim)
            else:
                self._provision_owner_workspace_if_required(account.id, account_claim)
            if account.status == _PENDING_ACCOUNT_STATUS:
                account_claim.ensure_owned()
                self._accounts.activate_pending(account.id, initialized_at=self._now())
                account_claim.ensure_owned()

        identity_claim.ensure_owned()
        tokens = self._sessions.login(account.id, ip_address=command.ip_address)
        return OAuthSignInResult(tokens=tokens, oauth_new_user=oauth_new_user)

    def _provision_new_account_workspaces(
        self,
        account_id: str,
        account_claim: OAuthAccountClaimLease,
    ) -> None:
        if self._memberships.has_active_membership(account_id):
            account_claim.ensure_owned()
            self._workspaces.try_join_default_workspace(account_id)
            account_claim.ensure_owned()
            return

        creation_error = OAuthWorkspaceCreationNotAllowedError()
        account_claim.ensure_owned()
        if self._workspace_policy.is_creation_allowed():
            account_claim.ensure_owned()
            try:
                self._workspaces.create_owner_workspace(account_id)
            except OAuthWorkspaceCreationNotAllowedError as exc:
                creation_error = exc
            else:
                account_claim.ensure_owned()
                self._workspaces.try_join_default_workspace(account_id)
                account_claim.ensure_owned()
                return

        account_claim.ensure_owned()
        self._workspaces.try_join_default_workspace(account_id)
        account_claim.ensure_owned()
        if self._memberships.has_active_membership(account_id):
            return
        raise creation_error

    def _provision_owner_workspace_if_required(
        self,
        account_id: str,
        account_claim: OAuthAccountClaimLease,
    ) -> None:
        if self._memberships.has_active_membership(account_id):
            return
        account_claim.ensure_owned()
        if not self._workspace_policy.is_creation_allowed():
            raise OAuthWorkspaceCreationNotAllowedError
        account_claim.ensure_owned()
        self._workspaces.create_owner_workspace(account_id)
        account_claim.ensure_owned()

    def _complete_invitation(
        self,
        command: OAuthCallbackCommand,
        identity: OAuthIdentity,
        identity_claim: OAuthAccountClaimLease,
    ) -> OAuthCallbackResult:
        invite_token = command.invite_token
        if invite_token is None:
            raise AssertionError("invitation completion requires a token")
        invitation = self._invitations.resolve(invite_token)
        if invitation is None:
            raise InvalidOAuthInvitationError
        if self._normalize_email(invitation.account_email) != self._normalize_email(identity.email):
            raise OAuthInvitationAccountMismatchError(invite_token)
        if invitation.account_status == _BANNED_ACCOUNT_STATUS:
            raise OAuthAccountBannedError

        identity_claim.ensure_owned()
        self._integrations.link(invitation.account_id, provider=command.provider, open_id=identity.id)
        identity_claim.ensure_owned()
        tokens = self._sessions.login(invitation.account_id, ip_address=command.ip_address)
        return OAuthInvitationResult(tokens=tokens, invite_token=invite_token)

    def _register_account(self, command: OAuthCallbackCommand, identity: OAuthIdentity) -> AccountSnapshot:
        normalized_email = self._normalize_email(identity.email)
        if not self._registration_policy.is_registration_allowed():
            freeze_type = self._registration_policy.get_freeze_type(normalized_email)
            if freeze_type == "email_domain_suspended":
                raise AccountEmailDomainSuspendedError
            if freeze_type:
                raise AccountEmailFrozenError
            raise OAuthRegistrationError("Invalid email or password")

        language = command.language or command.browser_language
        if language not in self._supported_languages:
            language = self._supported_languages[0]
        account_id = self._registration.register(
            OAuthAccountRegistration(
                email=normalized_email,
                name=identity.name or "Dify",
                language=language,
                timezone=command.timezone,
                ip_address=command.ip_address,
            )
        )
        account = self._accounts.get(account_id)
        if account is None:
            raise OAuthAccountNotFoundError
        return account

    def _resolve_account(self, provider: str, identity: OAuthIdentity) -> AccountSnapshot | None:
        account_id = self._integrations.find_account_id(provider=provider, open_id=identity.id)
        if account_id is not None:
            account = self._accounts.get(account_id)
            if account is not None:
                return account
        return self._accounts.find_by_email(identity.email)

    @staticmethod
    def _normalize_email(email: str) -> str:
        return email.strip().lower()

    @staticmethod
    def _ensure_account_can_login(account: AccountSnapshot) -> None:
        if account.status == _BANNED_ACCOUNT_STATUS:
            raise OAuthAccountBannedError

    def _provider(self, provider: str) -> OAuthProviderGateway:
        gateway = self._providers.get(provider)
        if gateway is None:
            raise InvalidOAuthProviderError
        return gateway
