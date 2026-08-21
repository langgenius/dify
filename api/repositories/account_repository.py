"""SQLAlchemy implementation of the account persistence port."""

from typing import override

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, AccountIntegrate, AccountStatus, InvitationCode, InvitationCodeStatus
from services.account_ports import AccountRepository
from services.entities.account_entities import (
    AccountCredentials,
    AccountEmailResetResult,
    AccountEmailResetStatus,
    AccountInitialization,
    AccountInitializationResult,
    AccountInitializationStatus,
    AccountPasswordDigest,
    AccountProfileChanges,
    AccountSnapshot,
)


class SQLAlchemyAccountRepository(AccountRepository):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get(self, account_id: str) -> AccountSnapshot | None:
        with self._session_factory() as session:
            account = session.get(Account, account_id)
            return self._to_snapshot(account) if account is not None else None

    @override
    def get_credentials(self, account_id: str) -> AccountCredentials | None:
        with self._session_factory() as session:
            account = session.get(Account, account_id)
            if account is None:
                return None
            return AccountCredentials(password_hash=account.password, password_salt=account.password_salt)

    @override
    def update_profile(self, account_id: str, changes: AccountProfileChanges) -> AccountSnapshot | None:
        with self._session_factory.begin() as session:
            account = session.get(Account, account_id)
            if account is None:
                return None

            if changes.name is not None:
                account.name = changes.name
            if changes.avatar is not None:
                account.avatar = changes.avatar
            if changes.interface_language is not None:
                account.interface_language = changes.interface_language
            if changes.interface_theme is not None:
                account.interface_theme = changes.interface_theme
            if changes.timezone is not None:
                account.timezone = changes.timezone

            session.flush()
            return self._to_snapshot(account)

    @override
    def update_password(self, account_id: str, password: AccountPasswordDigest) -> AccountSnapshot | None:
        with self._session_factory.begin() as session:
            account = session.get(Account, account_id)
            if account is None:
                return None

            account.password = password.password_hash
            account.password_salt = password.password_salt
            session.flush()
            return self._to_snapshot(account)

    @override
    def initialize(
        self,
        account_id: str,
        initialization: AccountInitialization,
        *,
        invitation_code: str | None,
        workspace_id: str | None,
    ) -> AccountInitializationResult:
        with self._session_factory.begin() as session:
            account = session.get(Account, account_id)
            if account is None:
                return AccountInitializationResult(status=AccountInitializationStatus.ACCOUNT_NOT_FOUND)
            if account.status == AccountStatus.ACTIVE:
                return AccountInitializationResult(status=AccountInitializationStatus.ALREADY_INITIALIZED)

            if invitation_code is not None:
                invitation = session.scalar(
                    select(InvitationCode)
                    .where(
                        InvitationCode.code == invitation_code,
                        InvitationCode.status == InvitationCodeStatus.UNUSED,
                    )
                    .limit(1)
                )
                if invitation is None or workspace_id is None:
                    return AccountInitializationResult(status=AccountInitializationStatus.INVALID_INVITATION)
                invitation.status = InvitationCodeStatus.USED
                invitation.used_at = initialization.initialized_at
                invitation.used_by_tenant_id = workspace_id
                invitation.used_by_account_id = account_id

            account.interface_language = initialization.interface_language
            account.interface_theme = initialization.interface_theme
            account.timezone = initialization.timezone
            account.status = AccountStatus.ACTIVE
            account.initialized_at = initialization.initialized_at
            session.flush()
            return AccountInitializationResult(
                status=AccountInitializationStatus.INITIALIZED,
                account=self._to_snapshot(account),
            )

    @override
    def email_exists(self, email: str) -> bool:
        with self._session_factory() as session:
            return session.scalar(select(Account.id).where(Account.email == email).limit(1)) is not None

    @override
    def reset_email(
        self,
        account_id: str,
        *,
        expected_old_email: str,
        new_email: str,
    ) -> AccountEmailResetResult:
        with self._session_factory.begin() as session:
            account = session.get(Account, account_id)
            if account is None:
                return AccountEmailResetResult(status=AccountEmailResetStatus.ACCOUNT_NOT_FOUND)
            if account.email.lower() != expected_old_email.lower():
                return AccountEmailResetResult(status=AccountEmailResetStatus.EMAIL_CHANGED)
            if session.scalar(select(Account.id).where(Account.email == new_email).limit(1)) is not None:
                return AccountEmailResetResult(status=AccountEmailResetStatus.EMAIL_IN_USE)

            account.email = new_email
            session.execute(delete(AccountIntegrate).where(AccountIntegrate.account_id == account_id))
            session.flush()
            return AccountEmailResetResult(
                status=AccountEmailResetStatus.UPDATED,
                account=self._to_snapshot(account),
            )

    @staticmethod
    def _to_snapshot(account: Account) -> AccountSnapshot:
        return AccountSnapshot(
            id=account.id,
            name=account.name,
            email=account.email,
            avatar=account.avatar,
            is_password_set=account.is_password_set,
            interface_language=account.interface_language,
            interface_theme=account.interface_theme,
            timezone=account.timezone,
            last_login_at=account.last_login_at,
            last_login_ip=account.last_login_ip,
            status=account.status.value,
            initialized_at=account.initialized_at,
            created_at=account.created_at,
        )
