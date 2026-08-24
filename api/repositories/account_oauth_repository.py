"""Persistence-backed gateways for Console account OAuth sign-in."""

from typing import override

from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.account import Account, AccountStatus
from services.account_errors import (
    AccountEmailDomainSuspendedError,
    OAuthAccountNotFoundError,
    OAuthRegistrationError,
    OAuthSeatsLimitExceededError,
    OAuthWorkspaceCreationNotAllowedError,
)
from services.account_oauth_service import (
    OAuthAccountRegistrationGateway,
    OAuthInvitationGateway,
    OAuthSessionGateway,
    OAuthWorkspaceGateway,
)
from services.account_service import AccountService, RegisterService, TenantService
from services.enterprise.enterprise_service import try_join_default_workspace
from services.entities.account_oauth_entities import (
    AccountSessionTokens,
    OAuthAccountRegistration,
    OAuthInvitation,
)
from services.errors.account import AccountRegisterError, EmailDomainSuspendedError, SeatsLimitExceededError
from services.errors.workspace import WorkSpaceNotAllowedCreateError, WorkspacesLimitExceededError


class RegisterServiceOAuthInvitationGateway(OAuthInvitationGateway):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def resolve(self, invite_token: str) -> OAuthInvitation | None:
        with self._session_factory() as session:
            invitation = RegisterService.get_invitation_if_token_valid(
                None,
                None,
                invite_token,
                session=session,
            )
            if invitation is None:
                return None
            account = invitation["account"]
            return OAuthInvitation(
                account_id=account.id,
                account_email=account.email,
                account_status=account.status.value,
            )


class AccountServiceOAuthAccountRegistrationGateway(OAuthAccountRegistrationGateway):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def register(self, registration: OAuthAccountRegistration) -> str:
        with self._session_factory() as session:
            try:
                account = AccountService.create_account(
                    email=registration.email,
                    name=registration.name,
                    interface_language=registration.language,
                    password=None,
                    timezone=registration.timezone,
                    ip_address=registration.ip_address,
                    session=session,
                )
                account.status = AccountStatus.ACTIVE
                account.initialized_at = naive_utc_now()
                session.commit()
            except EmailDomainSuspendedError as exc:
                raise AccountEmailDomainSuspendedError from exc
            except SeatsLimitExceededError as exc:
                raise OAuthSeatsLimitExceededError from exc
            except AccountRegisterError as exc:
                raise OAuthRegistrationError(exc.description) from exc
            except Exception as exc:
                session.rollback()
                raise OAuthRegistrationError(f"Registration failed: {exc}") from exc
            return account.id


class AccountServiceOAuthWorkspaceGateway(OAuthWorkspaceGateway):
    """Adapt account workspace operations to the OAuth application port."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def create_owner_workspace(self, account_id: str) -> None:
        with self._session_factory() as session:
            account = session.get(Account, account_id)
            if account is None:
                raise OAuthAccountNotFoundError
            try:
                TenantService.create_owner_tenant(account, session=session)
            except (WorkSpaceNotAllowedCreateError, WorkspacesLimitExceededError) as exc:
                raise OAuthWorkspaceCreationNotAllowedError from exc

    @override
    def try_join_default_workspace(self, account_id: str) -> None:
        try_join_default_workspace(account_id)


class AccountServiceOAuthSessionGateway(OAuthSessionGateway):
    """Adapt Console session issuance to the OAuth application port."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def login(self, account_id: str, *, ip_address: str) -> AccountSessionTokens:
        with self._session_factory() as session:
            account = session.get(Account, account_id)
            if account is None:
                raise OAuthAccountNotFoundError
            token_pair = AccountService.login(account=account, session=session, ip_address=ip_address)
            return AccountSessionTokens(
                access_token=token_pair.access_token,
                refresh_token=token_pair.refresh_token,
                csrf_token=token_pair.csrf_token,
            )
