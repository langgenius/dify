"""SQLAlchemy implementation of the account persistence port."""

from collections.abc import Sequence
from datetime import datetime
from typing import override
from uuid import UUID

from sqlalchemy import case, delete, func, select, update
from sqlalchemy.orm import Session, sessionmaker

from core.app.file_access import DatabaseFileAccessController
from core.human_input_v2.shared import AccountId
from models.account import (
    Account,
    AccountIntegrate,
    AccountStatus,
    InvitationCode,
    InvitationCodeStatus,
    Tenant,
    TenantAccountJoin,
    TenantStatus,
)
from models.model import UploadFile
from repositories.account.avatar import eligible_avatar_file_conditions, owned_avatar_file_conditions
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from services.account.contracts import AccountCreation
from services.account.login_service import ConsoleAuthAccountRepository
from services.account_email import normalize_email
from services.account_errors import AccountNormalizedEmailAlreadyInUseError, AvatarFileNotFoundError
from services.account_ports import AccountAvatarQuery, AccountRepository
from services.entities.account_entities import (
    AccountAuthenticationSnapshot,
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
from services.entities.account_login_entities import (
    AccountSessionPreparation,
    LoginAccountSnapshot,
    PasswordLoginCompletion,
)

_file_access = DatabaseFileAccessController()


def _normalized_uuid(value: str) -> str | None:
    """Return the canonical UUID spelling, or None for an invalid reference."""
    try:
        return str(UUID(value))
    except ValueError:
        return None


class SQLAlchemyAccountRepository(AccountRepository, ConsoleAuthAccountRepository, AccountAvatarQuery):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get(self, account_id: str) -> AccountSnapshot | None:
        account = self.get_model(account_id)
        return self._to_snapshot(account) if account is not None else None

    def get_model(self, account_id: str) -> Account | None:
        """Load a detached identity for framework adapters that require Account."""
        with self._session_factory() as session:
            return session.get(Account, account_id)

    def find_identity(self, email: str, *, case_fallback: bool = False) -> Account | None:
        """Prefer an exact email match, then the oldest normalized match when requested.

        SSO identities can retain mixed-case emails while callers supply lowercase
        addresses. Normalized emails are indexed but may have historical duplicates.
        """
        with self._session_factory() as session:
            account = session.execute(select(Account).where(Account.email == email)).scalar_one_or_none()
            if account is None and case_fallback:
                account = session.execute(
                    select(Account)
                    .where(Account.normalized_email == normalize_email(email))
                    .order_by(Account.created_at)
                    .limit(1)
                ).scalar_one_or_none()
            return account

    def load_identity(self, account_id: str, *, now: datetime) -> Account | None:
        """Resolve an active workspace and materialize the Flask identity before closing its Session."""
        with self._session_factory(expire_on_commit=False) as session:
            account = session.get(Account, account_id)
            if account is None or account.status == AccountStatus.BANNED:
                return account
            membership = session.scalar(
                select(TenantAccountJoin)
                .join(Tenant, Tenant.id == TenantAccountJoin.tenant_id)
                .where(
                    TenantAccountJoin.account_id == account_id,
                    TenantAccountJoin.current.is_(True),
                    Tenant.status == TenantStatus.NORMAL,
                )
                .limit(1)
            )
            if membership is None:
                session.execute(
                    update(TenantAccountJoin)
                    .where(TenantAccountJoin.account_id == account_id, TenantAccountJoin.current.is_(True))
                    .values(current=False)
                )
                membership = session.scalar(
                    select(TenantAccountJoin)
                    .join(Tenant, Tenant.id == TenantAccountJoin.tenant_id)
                    .where(
                        TenantAccountJoin.account_id == account_id,
                        Tenant.status == TenantStatus.NORMAL,
                    )
                    .order_by(TenantAccountJoin.id.asc())
                    .limit(1)
                )
                if membership is None:
                    session.commit()
                    return None
                membership.current = True
                membership.last_opened_at = now
                session.commit()
            account.set_tenant_id_with_session(membership.tenant_id, session=session)
            return account

    def touch_activity(self, account_id: str, *, now: datetime, before: datetime, touch_updated_at: bool) -> None:
        with self._session_factory.begin() as session:
            values: dict[str, object] = {"last_active_at": now}
            if touch_updated_at:
                values["updated_at"] = func.current_timestamp()
            session.execute(
                update(Account).where(Account.id == account_id, Account.last_active_at < before).values(**values)
            )

    @override
    def find_by_email(self, email: str) -> AccountSnapshot | None:
        account = self.find_identity(email, case_fallback=True)
        return self._to_snapshot(account) if account is not None else None

    def find_first_by_email(self, email: str) -> AccountSnapshot | None:
        """Preserve internal provisioning's exact, first-match email lookup.

        Accounts may still have duplicate email addresses during normalization;
        unlike authentication, this endpoint historically selects one match.
        """
        with self._session_factory() as session:
            account = session.scalar(select(Account).where(Account.email == email).limit(1))
            return self._to_snapshot(account) if account is not None else None

    def normalized_email_exists(self, email: str) -> bool:
        with self._session_factory() as session:
            return (
                session.scalar(select(Account.id).where(Account.normalized_email == normalize_email(email)).limit(1))
                is not None
            )

    def create(self, creation: AccountCreation) -> AccountSnapshot:
        with self._session_factory.begin() as session:
            return self._to_snapshot(self.add(creation, session=session))

    @staticmethod
    def add(creation: AccountCreation, *, session: Session) -> Account:
        """Share account insertion with aggregate repositories without owning their commit."""
        if (
            creation.check_normalized_email
            and session.scalar(
                select(Account.id).where(Account.normalized_email == normalize_email(creation.email)).limit(1)
            )
            is not None
        ):
            raise AccountNormalizedEmailAlreadyInUseError("An account with an equivalent email already exists.")
        account = Account(
            name=creation.name,
            email=creation.email,
            normalized_email=normalize_email(creation.email),
            password=creation.password.password_hash if creation.password else None,
            password_salt=creation.password.password_salt if creation.password else None,
            interface_language=creation.interface_language,
            interface_theme=creation.interface_theme,
            timezone=creation.timezone,
            last_login_ip=creation.ip_address,
            status=AccountStatus(creation.status),
            initialized_at=creation.initialized_at,
        )
        account.id = creation.id
        session.add(account)
        session.flush()
        # Keep the stable Contact identity in the caller's account transaction.
        SQLAlchemyContactRepository(session).provision_account_backed_contact(AccountId(account.id))
        return account

    @override
    def activate_pending(self, account_id: str, *, initialized_at: datetime) -> None:
        with self._session_factory.begin() as session:
            account = session.get(Account, account_id)
            if account is None or account.status != AccountStatus.PENDING:
                return
            account.status = AccountStatus.ACTIVE
            account.initialized_at = initialized_at

    @override
    def get_credentials(self, account_id: str) -> AccountCredentials | None:
        with self._session_factory() as session:
            account = session.get(Account, account_id)
            if account is None:
                return None
            return AccountCredentials(password_hash=account.password, password_salt=account.password_salt)

    @override
    def find_for_authentication(self, email: str) -> AccountAuthenticationSnapshot | None:
        """Find an exact email match, falling back to the oldest normalized match."""
        with self._session_factory() as session:
            account = session.execute(select(Account).where(Account.email == email)).scalar_one_or_none()
            if account is None:
                account = session.execute(
                    select(Account)
                    .where(Account.normalized_email == normalize_email(email))
                    .order_by(Account.created_at)
                    .limit(1)
                ).scalar_one_or_none()
            if account is None:
                return None
            return AccountAuthenticationSnapshot(
                id=account.id,
                email=account.email,
                status=account.status.value,
                password_hash=account.password,
                password_salt=account.password_salt,
            )

    @override
    def list_for_login(self, email: str) -> tuple[LoginAccountSnapshot, ...]:
        normalized_email = email.lower()
        candidate_emails = (email,) if email == normalized_email else (email, normalized_email)
        email_priority = case((Account.email == email, 0), else_=1)
        with self._session_factory() as session:
            accounts = session.scalars(
                select(Account)
                .where(Account.email.in_(candidate_emails))
                .order_by(email_priority.asc(), Account.id.asc())
            ).all()
            return tuple(self._to_login_snapshot(account) for account in accounts)

    @override
    def complete_password_login(self, completion: PasswordLoginCompletion) -> bool:
        with self._session_factory.begin() as session:
            account = session.get(Account, completion.account_id)
            if account is None:
                return False
            if completion.password is not None:
                account.password = completion.password.password_hash
                account.password_salt = completion.password.password_salt
            if completion.activate_pending_account and account.status == AccountStatus.PENDING:
                account.status = AccountStatus.ACTIVE
                account.initialized_at = completion.initialized_at
            session.flush()
            return True

    @override
    def prepare_session(self, account_id: str, preparation: AccountSessionPreparation) -> bool:
        with self._session_factory.begin() as session:
            account = session.get(Account, account_id)
            if account is None:
                return False
            account.last_login_at = preparation.logged_in_at
            account.last_login_ip = preparation.ip_address
            if preparation.activate_pending_account and account.status == AccountStatus.PENDING:
                account.status = AccountStatus.ACTIVE
            session.flush()
            return True

    @override
    def update_profile(self, account_id: str, changes: AccountProfileChanges) -> AccountSnapshot | None:
        with self._session_factory.begin() as session:
            account = session.get(Account, account_id)
            if account is None:
                return None

            avatar = changes.avatar
            if avatar and not avatar.startswith(("http://", "https://")):
                try:
                    avatar = str(UUID(avatar))
                except ValueError as error:
                    raise AvatarFileNotFoundError from error
                owned_avatar_id = session.scalar(
                    select(UploadFile.id)
                    .where(*owned_avatar_file_conditions(account_id=account_id, file_id=avatar, allow_legacy=False))
                    .limit(1)
                )
                if owned_avatar_id is None:
                    raise AvatarFileNotFoundError

            if changes.name is not None:
                account.name = changes.name
            if changes.avatar is not None:
                account.avatar = avatar
            if changes.interface_language is not None:
                account.interface_language = changes.interface_language
            if changes.interface_theme is not None:
                account.interface_theme = changes.interface_theme
            if changes.timezone is not None:
                account.timezone = changes.timezone

            session.flush()
            return self._to_snapshot(account)

    @override
    def get_owned_avatar_file_id(self, *, account_id: str, upload_file_id: str) -> str | None:
        """Return the canonical ID of the account's raster upload, or None if ineligible."""
        owner_id = _normalized_uuid(account_id)
        file_id = _normalized_uuid(upload_file_id)
        if owner_id is None or file_id is None:
            return None

        with self._session_factory() as session:
            return session.scalar(
                select(UploadFile.id)
                .where(*owned_avatar_file_conditions(account_id=owner_id, file_id=file_id, allow_legacy=True))
                .limit(1)
            )

    @override
    def get_current_avatar_references(self, *, account_ids: Sequence[str]) -> dict[str, str]:
        """Return current external URLs or canonical owned raster IDs keyed by the original inputs.

        Omit invalid, missing, or out-of-scope references. Apply the active file scope in the
        upload query and use at most two queries for the whole batch.
        """
        canonical_by_input = {
            account_id: canonical_id
            for account_id in dict.fromkeys(account_ids)
            if (canonical_id := _normalized_uuid(account_id)) is not None
        }
        if not canonical_by_input:
            return {}

        references: dict[str, str] = {}
        upload_ids: dict[str, str] = {}
        with self._session_factory() as session:
            profiles = session.execute(
                select(Account.id, Account.avatar).where(Account.id.in_(set(canonical_by_input.values())))
            ).all()
            for account_id, avatar in profiles:
                if avatar:
                    if avatar.startswith(("http://", "https://")):
                        references[account_id] = avatar
                    elif (file_id := _normalized_uuid(avatar)) is not None:
                        upload_ids[account_id] = file_id

            if upload_ids:
                scoped_uploads = _file_access.apply_upload_file_filters(
                    select(UploadFile).where(
                        UploadFile.id.in_(set(upload_ids.values())),
                        UploadFile.created_by.in_(set(upload_ids)),
                        *eligible_avatar_file_conditions(allow_legacy=True),
                    )
                )
                owned_uploads = session.execute(
                    scoped_uploads.with_only_columns(UploadFile.id, UploadFile.created_by)
                ).all()
                for file_id, owner_id in owned_uploads:
                    if upload_ids.get(owner_id) == file_id:
                        references[owner_id] = file_id

        return {
            input_id: references[canonical_id]
            for input_id, canonical_id in canonical_by_input.items()
            if canonical_id in references
        }

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

    def set_email(self, account_id: str, email: str) -> None:
        with self._session_factory.begin() as session:
            account = session.get(Account, account_id)
            if account is None:
                from services.account_errors import AccountNotFoundError

                raise AccountNotFoundError()
            account.email = email
            account.normalized_email = normalize_email(email)

    @override
    def has_active_email(self, email: str) -> bool:
        normalized = email.strip().lower()
        if not normalized:
            return False
        stmt = (
            select(Account.id)
            .where(
                func.lower(Account.email) == normalized,
                Account.status == AccountStatus.ACTIVE,
            )
            .limit(1)
        )
        with self._session_factory() as session:
            return session.scalar(stmt) is not None

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
            account.normalized_email = normalize_email(new_email)
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

    @staticmethod
    def _to_login_snapshot(account: Account) -> LoginAccountSnapshot:
        return LoginAccountSnapshot(
            id=account.id,
            email=account.email,
            status=account.status.value,
            password_hash=account.password,
            password_salt=account.password_salt,
        )
