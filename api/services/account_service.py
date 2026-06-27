"""Account, workspace, and invitation services.

Database access in this module is caller-scoped: methods that read or mutate ORM state accept an explicit
``session`` so controllers, tasks, and tests can control transaction lifetime and avoid hidden Flask-scoped session
usage inside service logic.
"""

import base64
import json
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any, NotRequired, TypedDict, cast

from pydantic import BaseModel, TypeAdapter, ValidationError
from sqlalchemy import Row, delete, func, select, update
from sqlalchemy.orm import Session, scoped_session
from werkzeug.exceptions import Unauthorized

from configs import dify_config
from constants.languages import get_valid_language, language_timezone_mapping
from events.tenant_event import tenant_was_created
from extensions.ext_database import db
from extensions.ext_redis import redis_client, redis_fallback
from libs.datetime_utils import naive_utc_now
from libs.helper import RateLimiter, TokenManager
from libs.helper import timezone as validate_timezone
from libs.passport import PassportService
from libs.password import compare_password, hash_password, valid_password
from libs.rsa import generate_key_pair
from libs.token import generate_csrf_token
from models.account import (
    Account,
    AccountIntegrate,
    AccountStatus,
    Tenant,
    TenantAccountJoin,
    TenantAccountRole,
    TenantPluginAutoUpgradeStrategy,
    TenantStatus,
)
from models.dataset import Dataset
from models.model import App, DifySetup
from services.billing_service import BillingService
from services.enterprise.rbac_service import ListOption, RBACService
from services.entities.auth_entities import (
    ChangeEmailNewEmailToken,
    ChangeEmailOldEmailToken,
    ChangeEmailPhase,
    ChangeEmailTokenData,
)
from services.errors.account import (
    AccountAlreadyInTenantError,
    AccountLoginError,
    AccountNotLinkTenantError,
    AccountPasswordError,
    AccountRegisterError,
    CannotOperateSelfError,
    CurrentPasswordIncorrectError,
    InvalidActionError,
    LinkAccountIntegrateError,
    MemberNotInTenantError,
    NoPermissionError,
    RoleAlreadyAssignedError,
    TenantNotFoundError,
)
from services.errors.workspace import WorkSpaceNotAllowedCreateError, WorkspacesLimitExceededError
from services.feature_service import FeatureService
from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService
from tasks.delete_account_task import delete_account_task
from tasks.mail_account_deletion_task import send_account_deletion_verification_code
from tasks.mail_change_mail_task import (
    send_change_mail_completed_notification_task,
    send_change_mail_task,
)
from tasks.mail_email_code_login import send_email_code_login_mail_task
from tasks.mail_invite_member_task import send_invite_member_mail_task
from tasks.mail_owner_transfer_task import (
    send_new_owner_transfer_notify_email_task,
    send_old_owner_transfer_notify_email_task,
    send_owner_transfer_confirm_task,
)
from tasks.mail_register_task import send_email_register_mail_task, send_email_register_mail_task_when_account_exist
from tasks.mail_reset_password_task import (
    send_reset_password_mail_task,
    send_reset_password_mail_task_when_account_not_exist,
)


class InvitationData(TypedDict):
    account_id: str
    email: str
    workspace_id: str
    role: NotRequired[str]
    requires_setup: NotRequired[bool]


_invitation_adapter: TypeAdapter[InvitationData] = TypeAdapter(InvitationData)

logger = logging.getLogger(__name__)

_change_email_token_adapter: TypeAdapter[ChangeEmailTokenData] = TypeAdapter(ChangeEmailTokenData)


class InvitationDetailDict(TypedDict):
    account: Account
    data: InvitationData
    tenant: Tenant


def _try_join_enterprise_default_workspace(account_id: str) -> None:
    """Best-effort join to enterprise default workspace."""
    if not dify_config.ENTERPRISE_ENABLED:
        return

    from services.enterprise.enterprise_service import try_join_default_workspace

    try_join_default_workspace(account_id)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    csrf_token: str


REFRESH_TOKEN_PREFIX = "refresh_token:"
ACCOUNT_REFRESH_TOKEN_PREFIX = "account_refresh_token:"
REFRESH_TOKEN_EXPIRY = timedelta(days=dify_config.REFRESH_TOKEN_EXPIRE_DAYS)
ACCOUNT_LAST_ACTIVE_REFRESH_PREFIX = "account_last_active_refresh:"
ACCOUNT_LAST_ACTIVE_REFRESH_INTERVAL = timedelta(minutes=10)


class AccountService:
    CHANGE_EMAIL_PHASE_OLD = ChangeEmailPhase.OLD_EMAIL
    CHANGE_EMAIL_PHASE_OLD_VERIFIED = ChangeEmailPhase.OLD_EMAIL_VERIFIED
    CHANGE_EMAIL_PHASE_NEW = ChangeEmailPhase.NEW_EMAIL
    CHANGE_EMAIL_PHASE_NEW_VERIFIED = ChangeEmailPhase.NEW_EMAIL_VERIFIED

    reset_password_rate_limiter = RateLimiter(prefix="reset_password_rate_limit", max_attempts=1, time_window=60 * 1)
    email_register_rate_limiter = RateLimiter(prefix="email_register_rate_limit", max_attempts=1, time_window=60 * 1)
    email_code_login_rate_limiter = RateLimiter(
        prefix="email_code_login_rate_limit", max_attempts=3, time_window=300 * 1
    )
    email_code_account_deletion_rate_limiter = RateLimiter(
        prefix="email_code_account_deletion_rate_limit", max_attempts=1, time_window=60 * 1
    )
    change_email_rate_limiter = RateLimiter(prefix="change_email_rate_limit", max_attempts=1, time_window=60 * 1)
    owner_transfer_rate_limiter = RateLimiter(prefix="owner_transfer_rate_limit", max_attempts=1, time_window=60 * 1)

    LOGIN_MAX_ERROR_LIMITS = 5
    FORGOT_PASSWORD_MAX_ERROR_LIMITS = 5
    CHANGE_EMAIL_MAX_ERROR_LIMITS = 5
    OWNER_TRANSFER_MAX_ERROR_LIMITS = 5
    EMAIL_REGISTER_MAX_ERROR_LIMITS = 5

    @staticmethod
    def _resolve_legacy_role_id(tenant_id: str, account_id: str, role: TenantAccountRole) -> str:
        """Resolve a legacy workspace role to the corresponding RBAC role id.

        Looks up the builtin RBAC role whose tag matches the legacy role name
        (e.g. ``TenantAccountRole.ADMIN`` → builtin role with tag ``"admin"``).
        """
        options = ListOption(page_number=1, results_per_page=100)
        roles = RBACService.Roles.list(tenant_id, account_id, options=options).data

        expected_tag = {
            TenantAccountRole.OWNER: "owner",
            TenantAccountRole.ADMIN: "admin",
            TenantAccountRole.EDITOR: "editor",
            TenantAccountRole.NORMAL: "normal",
            TenantAccountRole.DATASET_OPERATOR: "dataset_operator",
        }[role]
        for rbac_role in roles:
            if (
                rbac_role.is_builtin
                and rbac_role.category == "global_system_default"
                and rbac_role.role_tag == expected_tag
            ):
                return str(rbac_role.id)

        raise ValueError(f"Builtin RBAC role not found for {role.value} in tenant {tenant_id}")

    @staticmethod
    def get_workspace_permission_keys(tenant_id: str, account_id: str) -> set[str]:
        permissions = RBACService.MyPermissions.get(tenant_id, account_id)
        return set(getattr(getattr(permissions, "workspace", None), "permission_keys", []) or [])

    @staticmethod
    def get_rbac_workspace_owner_account_id(tenant_id: str, actor_account_id: str) -> str:
        """Return the account id bound to the workspace owner RBAC role."""
        owner_role_id = AccountService._resolve_legacy_role_id(
            tenant_id=tenant_id,
            account_id=actor_account_id,
            role=TenantAccountRole.OWNER,
        )
        owner_members = RBACService.Roles.members(
            tenant_id=tenant_id,
            account_id=actor_account_id,
            role_id=owner_role_id,
            options=ListOption(page_number=1, results_per_page=1),
        ).data
        if not owner_members:
            raise ValueError(f"Workspace RBAC owner not found for tenant {tenant_id}.")
        return owner_members[0].account_id

    @staticmethod
    def is_rbac_workspace_owner(tenant_id: str, actor_account_id: str, member_account_id: str) -> bool:
        roles = RBACService.MemberRoles.get(
            tenant_id=tenant_id,
            account_id=actor_account_id,
            member_account_id=member_account_id,
        ).roles
        return any(
            role.is_builtin and role.category == "global_system_default" and role.role_tag == "owner" for role in roles
        )

    @staticmethod
    def _get_refresh_token_key(refresh_token: str) -> str:
        return f"{REFRESH_TOKEN_PREFIX}{refresh_token}"

    @staticmethod
    def _get_account_refresh_token_key(account_id: str) -> str:
        return f"{ACCOUNT_REFRESH_TOKEN_PREFIX}{account_id}"

    @staticmethod
    def _get_account_last_active_refresh_key(account_id: str) -> str:
        return f"{ACCOUNT_LAST_ACTIVE_REFRESH_PREFIX}{account_id}"

    @staticmethod
    @redis_fallback(default_return=True)
    def _should_refresh_account_last_active(account_id: str) -> bool:
        return bool(
            redis_client.set(
                AccountService._get_account_last_active_refresh_key(account_id),
                1,
                ex=int(ACCOUNT_LAST_ACTIVE_REFRESH_INTERVAL.total_seconds()),
                nx=True,
            )
        )

    @staticmethod
    def _refresh_account_last_active(account: Account, session: scoped_session | Session) -> None:
        now = naive_utc_now()
        refresh_before = now - ACCOUNT_LAST_ACTIVE_REFRESH_INTERVAL

        if account.last_active_at >= refresh_before:
            return

        if not AccountService._should_refresh_account_last_active(account.id):
            return

        session.execute(
            update(Account)
            .where(Account.id == account.id, Account.last_active_at < refresh_before)
            .values(last_active_at=now, updated_at=func.current_timestamp())
        )
        session.commit()

    @staticmethod
    def _store_refresh_token(refresh_token: str, account_id: str):
        redis_client.setex(AccountService._get_refresh_token_key(refresh_token), REFRESH_TOKEN_EXPIRY, account_id)
        redis_client.setex(
            AccountService._get_account_refresh_token_key(account_id), REFRESH_TOKEN_EXPIRY, refresh_token
        )

    @staticmethod
    def _delete_refresh_token(refresh_token: str, account_id: str):
        redis_client.delete(AccountService._get_refresh_token_key(refresh_token))
        redis_client.delete(AccountService._get_account_refresh_token_key(account_id))

    @staticmethod
    def get_account_by_email(session: Session | scoped_session, email: str) -> Account | None:
        """Plain ``Account`` getter keyed by email. Case-sensitive — use
        :meth:`has_active_account_with_email` for the case-insensitive
        existence check that backs the SSO collision rule.
        """
        return session.execute(select(Account).where(Account.email == email)).scalar_one_or_none()

    @staticmethod
    def has_active_account_with_email(session: Session | scoped_session, email: str) -> bool:
        if not email:
            return False
        normalized = email.strip().lower()
        if not normalized:
            return False
        row = session.execute(
            select(Account.id).where(
                func.lower(Account.email) == normalized,
                Account.status == AccountStatus.ACTIVE,
            )
        ).scalar_one_or_none()
        return row is not None

    @staticmethod
    def get_account_by_id(session: Session | scoped_session, account_id: str) -> Account | None:
        """Plain ``Account`` getter — no banned check, no tenant rotation,
        no ``last_active_at`` write. Use this from read-only identity
        endpoints (``/openapi/v1/account``) where ``load_user``'s
        side-effects (current-tenant assignment, commit) are unwanted.

        ``session`` is injected by the caller so this service stays free
        of a Flask-scoped session import.
        """
        return session.get(Account, account_id)

    @staticmethod
    def load_user(user_id: str, session: scoped_session | Session) -> None | Account:
        account = session.get(Account, user_id)
        if not account:
            return None

        if account.status == AccountStatus.BANNED:
            raise Unauthorized("Account is banned.")

        current_tenant = session.scalar(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.account_id == account.id, TenantAccountJoin.current == True)
            .limit(1)
        )
        if current_tenant:
            account.set_tenant_id(current_tenant.tenant_id)
        else:
            available_ta = session.scalar(
                select(TenantAccountJoin)
                .where(TenantAccountJoin.account_id == account.id)
                .order_by(TenantAccountJoin.id.asc())
                .limit(1)
            )
            if not available_ta:
                return None

            account.set_tenant_id(available_ta.tenant_id)
            available_ta.current = True
            available_ta.last_opened_at = naive_utc_now()
            session.commit()

        AccountService._refresh_account_last_active(account, session)
        # NOTE: make sure account is accessible outside of a db session
        # This ensures that it will work correctly after upgrading to Flask version 3.1.2
        session.refresh(account)
        session.close()
        return account

    @staticmethod
    def get_account_jwt_token(account: Account) -> str:
        exp_dt = datetime.now(UTC) + timedelta(minutes=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES)
        exp = int(exp_dt.timestamp())
        payload = {
            "user_id": account.id,
            "exp": exp,
            "iss": dify_config.EDITION,
            "sub": "Console API Passport",
        }

        token: str = PassportService().issue(payload)
        return token

    @staticmethod
    def authenticate(
        email: str, password: str, invite_token: str | None = None, *, session: scoped_session | Session
    ) -> Account:
        """authenticate account with email and password"""

        account = session.scalar(select(Account).where(Account.email == email).limit(1))
        if not account:
            raise AccountPasswordError("Invalid email or password.")

        if account.status == AccountStatus.BANNED:
            raise AccountLoginError("Account is banned.")

        if password and invite_token and account.password is None:
            # if invite_token is valid, set password and password_salt
            salt = secrets.token_bytes(16)
            base64_salt = base64.b64encode(salt).decode()
            password_hashed = hash_password(password, salt)
            base64_password_hashed = base64.b64encode(password_hashed).decode()
            account.password = base64_password_hashed
            account.password_salt = base64_salt

        if account.password is None or not compare_password(password, account.password, account.password_salt):
            raise AccountPasswordError("Invalid email or password.")

        if account.status == AccountStatus.PENDING:
            account.status = AccountStatus.ACTIVE
            account.initialized_at = naive_utc_now()

        session.commit()

        return account

    @staticmethod
    def update_account_password(
        account: Account, password: str, new_password: str, *, session: scoped_session | Session
    ):
        """update account password"""
        if account.password and not compare_password(password, account.password, account.password_salt):
            raise CurrentPasswordIncorrectError("Current password is incorrect.")

        # may be raised
        valid_password(new_password)

        # generate password salt
        salt = secrets.token_bytes(16)
        base64_salt = base64.b64encode(salt).decode()

        # encrypt password with salt
        password_hashed = hash_password(new_password, salt)
        base64_password_hashed = base64.b64encode(password_hashed).decode()
        account.password = base64_password_hashed
        account.password_salt = base64_salt
        session.add(account)
        session.commit()
        return account

    @staticmethod
    def create_account(
        email: str,
        name: str,
        interface_language: str,
        password: str | None = None,
        interface_theme: str = "light",
        is_setup: bool | None = False,
        timezone: str | None = None,
        *,
        session: scoped_session | Session,
    ) -> Account:
        """Create an account, preferring explicit user timezone over language-derived defaults."""
        if not FeatureService.get_system_features().is_allow_register and not is_setup:
            from controllers.console.error import AccountNotFound

            raise AccountNotFound()

        if dify_config.BILLING_ENABLED and BillingService.is_email_in_freeze(email):
            raise AccountRegisterError(
                description=(
                    "This email account has been deleted within the past "
                    "30 days and is temporarily unavailable for new account registration"
                )
            )

        password_to_set = None
        salt_to_set = None
        if password:
            valid_password(password)

            # generate password salt
            salt = secrets.token_bytes(16)
            base64_salt = base64.b64encode(salt).decode()

            # encrypt password with salt
            password_hashed = hash_password(password, salt)
            base64_password_hashed = base64.b64encode(password_hashed).decode()

            password_to_set = base64_password_hashed
            salt_to_set = base64_salt

        resolved_timezone = language_timezone_mapping.get(interface_language, "UTC")
        if timezone is not None:
            resolved_timezone = validate_timezone(timezone)

        account = Account(
            name=name,
            email=email,
            password=password_to_set,
            password_salt=salt_to_set,
            interface_language=interface_language,
            interface_theme=interface_theme,
            timezone=resolved_timezone,
        )

        session.add(account)
        session.commit()
        return account

    @staticmethod
    def create_account_and_tenant(
        email: str,
        name: str,
        interface_language: str,
        password: str | None = None,
        timezone: str | None = None,
        *,
        session: scoped_session | Session,
    ) -> Account:
        """Create an account and owner workspace."""
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language=interface_language,
            password=password,
            timezone=timezone,
            session=session,
        )

        try:
            TenantService.create_owner_tenant_if_not_exist(account=account, session=session)
        except Exception:
            # Enterprise-only side-effect should run independently from personal workspace creation.
            _try_join_enterprise_default_workspace(str(account.id))
            raise

        _try_join_enterprise_default_workspace(str(account.id))

        return account

    @staticmethod
    def generate_account_deletion_verification_code(account: Account) -> tuple[str, str]:
        code = "".join([str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6)])
        token = TokenManager.generate_token(
            account=account, token_type="account_deletion", additional_data={"code": code}
        )
        return token, code

    @classmethod
    def send_account_deletion_verification_email(cls, account: Account, code: str):
        email = account.email
        if cls.email_code_account_deletion_rate_limiter.is_rate_limited(email):
            from controllers.console.auth.error import EmailCodeAccountDeletionRateLimitExceededError

            raise EmailCodeAccountDeletionRateLimitExceededError(
                int(cls.email_code_account_deletion_rate_limiter.time_window / 60)
            )

        send_account_deletion_verification_code.delay(to=email, code=code)

        cls.email_code_account_deletion_rate_limiter.increment_rate_limit(email)

    @staticmethod
    def verify_account_deletion_code(token: str, code: str) -> bool:
        token_data = TokenManager.get_token_data(token, "account_deletion")
        if token_data is None:
            return False

        if token_data["code"] != code:
            return False

        return True

    @staticmethod
    def delete_account(account: Account):
        """Delete account. This method only adds a task to the queue for deletion."""
        # Queue account deletion sync tasks for all workspaces BEFORE account deletion (enterprise only)
        from services.enterprise.account_deletion_sync import sync_account_deletion

        sync_success = sync_account_deletion(account_id=account.id, source="account_deleted")
        if not sync_success:
            logger.warning(
                "Enterprise account deletion sync failed for account %s; proceeding with local deletion.",
                account.id,
            )

        # Now proceed with async account deletion
        delete_account_task.delay(account.id)

    @staticmethod
    def link_account_integrate(provider: str, open_id: str, account: Account, *, session: scoped_session | Session):
        """Link account integrate"""
        try:
            # Query whether there is an existing binding record for the same provider
            account_integrate: AccountIntegrate | None = session.scalar(
                select(AccountIntegrate)
                .where(AccountIntegrate.account_id == account.id, AccountIntegrate.provider == provider)
                .limit(1)
            )

            if account_integrate:
                # If it exists, update the record
                account_integrate.open_id = open_id
                account_integrate.encrypted_token = ""  # todo
                account_integrate.updated_at = naive_utc_now()
            else:
                # If it does not exist, create a new record
                account_integrate = AccountIntegrate(
                    account_id=account.id, provider=provider, open_id=open_id, encrypted_token=""
                )
                session.add(account_integrate)

            session.commit()
            logger.info("Account %s linked %s account %s.", account.id, provider, open_id)
        except Exception as e:
            logger.exception("Failed to link %s account %s to Account %s", provider, open_id, account.id)
            raise LinkAccountIntegrateError("Failed to link account.") from e

    @staticmethod
    def close_account(account: Account, *, session: scoped_session | Session):
        """Close account"""
        account.status = AccountStatus.CLOSED
        session.commit()

    @staticmethod
    def update_account(account: Account, *, session: scoped_session | Session, **kwargs):
        """Update account fields"""
        account = session.merge(account)
        for field, value in kwargs.items():
            if hasattr(account, field):
                setattr(account, field, value)
            else:
                raise AttributeError(f"Invalid field: {field}")

        session.commit()
        return account

    @staticmethod
    def update_account_email(account: Account, email: str, session: scoped_session | Session) -> Account:
        """Update account email"""
        account.email = email
        account_integrate = session.scalar(
            select(AccountIntegrate).where(AccountIntegrate.account_id == account.id).limit(1)
        )
        if account_integrate:
            session.delete(account_integrate)
        session.add(account)
        session.commit()
        return account

    @staticmethod
    def update_login_info(account: Account, session: scoped_session | Session, *, ip_address: str):
        """Update last login time and ip"""
        account.last_login_at = naive_utc_now()
        account.last_login_ip = ip_address
        session.add(account)
        session.commit()

    @staticmethod
    def login(account: Account, *, session: scoped_session | Session, ip_address: str | None = None) -> TokenPair:
        if ip_address:
            AccountService.update_login_info(account=account, session=session, ip_address=ip_address)

        if account.status == AccountStatus.PENDING:
            account.status = AccountStatus.ACTIVE
            session.commit()

        access_token = AccountService.get_account_jwt_token(account=account)
        refresh_token = _generate_refresh_token()
        csrf_token = generate_csrf_token(account.id)

        AccountService._store_refresh_token(refresh_token, account.id)

        return TokenPair(access_token=access_token, refresh_token=refresh_token, csrf_token=csrf_token)

    @staticmethod
    def logout(*, account: Account):
        refresh_token = redis_client.get(AccountService._get_account_refresh_token_key(account.id))
        if refresh_token:
            AccountService._delete_refresh_token(refresh_token.decode("utf-8"), account.id)

    @staticmethod
    def refresh_token(refresh_token: str, *, session: scoped_session | Session) -> TokenPair:
        # Verify the refresh token
        account_id = redis_client.get(AccountService._get_refresh_token_key(refresh_token))
        if not account_id:
            raise ValueError("Invalid refresh token")

        account = AccountService.load_user(account_id.decode("utf-8"), session)
        if not account:
            raise ValueError("Invalid account")

        # Generate new access token and refresh token
        new_access_token = AccountService.get_account_jwt_token(account)
        new_refresh_token = _generate_refresh_token()

        AccountService._delete_refresh_token(refresh_token, account.id)
        AccountService._store_refresh_token(new_refresh_token, account.id)
        csrf_token = generate_csrf_token(account.id)

        return TokenPair(access_token=new_access_token, refresh_token=new_refresh_token, csrf_token=csrf_token)

    @staticmethod
    def load_logged_in_account(*, account_id: str, session: scoped_session | Session):
        return AccountService.load_user(account_id, session)

    @classmethod
    def send_reset_password_email(
        cls,
        account: Account | None = None,
        email: str | None = None,
        language: str = "en-US",
        is_allow_register: bool = False,
    ):
        account_email = account.email if account else email
        if account_email is None:
            raise ValueError("Email must be provided.")

        if cls.reset_password_rate_limiter.is_rate_limited(account_email):
            from controllers.console.auth.error import PasswordResetRateLimitExceededError

            raise PasswordResetRateLimitExceededError(int(cls.reset_password_rate_limiter.time_window / 60))

        code, token = cls.generate_reset_password_token(account_email, account)

        if account:
            send_reset_password_mail_task.delay(
                language=language,
                to=account_email,
                code=code,
            )
        else:
            send_reset_password_mail_task_when_account_not_exist.delay(
                language=language,
                to=account_email,
                is_allow_register=is_allow_register,
            )
        cls.reset_password_rate_limiter.increment_rate_limit(account_email)
        return token

    @classmethod
    def send_email_register_email(
        cls,
        account: Account | None = None,
        email: str | None = None,
        language: str = "en-US",
    ):
        account_email = account.email if account else email
        if account_email is None:
            raise ValueError("Email must be provided.")

        if cls.email_register_rate_limiter.is_rate_limited(account_email):
            from controllers.console.auth.error import EmailRegisterRateLimitExceededError

            raise EmailRegisterRateLimitExceededError(int(cls.email_register_rate_limiter.time_window / 60))

        code, token = cls.generate_email_register_token(account_email)

        if account:
            send_email_register_mail_task_when_account_exist.delay(
                language=language,
                to=account_email,
                account_name=account.name,
            )

        else:
            send_email_register_mail_task.delay(
                language=language,
                to=account_email,
                code=code,
            )
        cls.email_register_rate_limiter.increment_rate_limit(account_email)
        return token

    @classmethod
    def send_change_email_email(
        cls,
        account: Account,
        email: str | None = None,
        old_email: str | None = None,
        language: str = "en-US",
        phase: str | None = None,
    ):
        account_email = email if email is not None else account.email
        if not phase:
            raise ValueError("phase must be provided.")
        if phase not in (cls.CHANGE_EMAIL_PHASE_OLD, cls.CHANGE_EMAIL_PHASE_NEW):
            raise ValueError("phase must be one of old_email or new_email.")
        if old_email is None:
            raise ValueError("old_email must be provided.")

        if cls.change_email_rate_limiter.is_rate_limited(account_email):
            from controllers.console.auth.error import EmailChangeRateLimitExceededError

            raise EmailChangeRateLimitExceededError(int(cls.change_email_rate_limiter.time_window / 60))

        code = "".join([str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6)])
        token_data: ChangeEmailTokenData
        if phase == cls.CHANGE_EMAIL_PHASE_OLD:
            token_data = ChangeEmailOldEmailToken(
                account_id=account.id,
                email=account_email,
                old_email=old_email,
                code=code,
            )
        else:
            token_data = ChangeEmailNewEmailToken(
                account_id=account.id,
                email=account_email,
                old_email=old_email,
                code=code,
            )
        token = cls.generate_change_email_token(token_data, account)

        send_change_mail_task.delay(
            language=language,
            to=account_email,
            code=code,
            phase=phase,
        )
        cls.change_email_rate_limiter.increment_rate_limit(account_email)
        return token

    @classmethod
    def send_change_email_completed_notify_email(
        cls,
        account: Account | None = None,
        email: str | None = None,
        language: str = "en-US",
    ):
        account_email = account.email if account else email
        if account_email is None:
            raise ValueError("Email must be provided.")

        send_change_mail_completed_notification_task.delay(
            language=language,
            to=account_email,
        )

    @classmethod
    def send_owner_transfer_email(
        cls,
        account: Account | None = None,
        email: str | None = None,
        language: str = "en-US",
        workspace_name: str | None = "",
    ):
        account_email = account.email if account else email
        if account_email is None:
            raise ValueError("Email must be provided.")

        if cls.owner_transfer_rate_limiter.is_rate_limited(account_email):
            from controllers.console.auth.error import OwnerTransferRateLimitExceededError

            raise OwnerTransferRateLimitExceededError(int(cls.owner_transfer_rate_limiter.time_window / 60))

        code, token = cls.generate_owner_transfer_token(account_email, account)
        workspace_name = workspace_name or ""

        send_owner_transfer_confirm_task.delay(
            language=language,
            to=account_email,
            code=code,
            workspace=workspace_name,
        )
        cls.owner_transfer_rate_limiter.increment_rate_limit(account_email)
        return token

    @classmethod
    def send_old_owner_transfer_notify_email(
        cls,
        account: Account | None = None,
        email: str | None = None,
        language: str = "en-US",
        workspace_name: str | None = "",
        new_owner_email: str = "",
    ):
        account_email = account.email if account else email
        if account_email is None:
            raise ValueError("Email must be provided.")
        workspace_name = workspace_name or ""

        send_old_owner_transfer_notify_email_task.delay(
            language=language,
            to=account_email,
            workspace=workspace_name,
            new_owner_email=new_owner_email,
        )

    @classmethod
    def send_new_owner_transfer_notify_email(
        cls,
        account: Account | None = None,
        email: str | None = None,
        language: str = "en-US",
        workspace_name: str | None = "",
    ):
        account_email = account.email if account else email
        if account_email is None:
            raise ValueError("Email must be provided.")
        workspace_name = workspace_name or ""

        send_new_owner_transfer_notify_email_task.delay(
            language=language,
            to=account_email,
            workspace=workspace_name,
        )

    @classmethod
    def generate_reset_password_token(
        cls,
        email: str,
        account: Account | None = None,
        code: str | None = None,
        additional_data: dict[str, Any] = {},
    ):
        if not code:
            code = "".join([str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6)])
        additional_data["code"] = code
        token = TokenManager.generate_token(
            account=account, email=email, token_type="reset_password", additional_data=additional_data
        )
        return code, token

    @classmethod
    def generate_email_register_token(
        cls,
        email: str,
        code: str | None = None,
        additional_data: dict[str, Any] = {},
    ):
        if not code:
            code = "".join([str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6)])
        additional_data["code"] = code
        token = TokenManager.generate_token(email=email, token_type="email_register", additional_data=additional_data)
        return code, token

    @classmethod
    def generate_change_email_token(
        cls,
        token_data: ChangeEmailTokenData,
        account: Account,
    ) -> str:
        token = TokenManager.generate_token(
            account=account,
            email=token_data.email,
            token_type="change_email",
            additional_data=token_data.to_token_manager_payload(),
        )
        return token

    @classmethod
    def generate_owner_transfer_token(
        cls,
        email: str,
        account: Account | None = None,
        code: str | None = None,
        additional_data: dict[str, Any] = {},
    ):
        if not code:
            code = "".join([str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6)])
        additional_data["code"] = code
        token = TokenManager.generate_token(
            account=account, email=email, token_type="owner_transfer", additional_data=additional_data
        )
        return code, token

    @classmethod
    def revoke_reset_password_token(cls, token: str):
        TokenManager.revoke_token(token, "reset_password")

    @classmethod
    def revoke_email_register_token(cls, token: str):
        TokenManager.revoke_token(token, "email_register")

    @classmethod
    def revoke_change_email_token(cls, token: str):
        TokenManager.revoke_token(token, "change_email")

    @classmethod
    def revoke_owner_transfer_token(cls, token: str):
        TokenManager.revoke_token(token, "owner_transfer")

    @classmethod
    def get_reset_password_data(cls, token: str) -> dict[str, Any] | None:
        return TokenManager.get_token_data(token, "reset_password")

    @classmethod
    def get_email_register_data(cls, token: str) -> dict[str, Any] | None:
        return TokenManager.get_token_data(token, "email_register")

    @classmethod
    def get_change_email_data(cls, token: str) -> ChangeEmailTokenData | None:
        token_data = TokenManager.get_token_data(token, "change_email")
        if token_data is None:
            return None
        try:
            return _change_email_token_adapter.validate_python(token_data)
        except ValidationError:
            logger.warning("change_email token %s has invalid payload", token, exc_info=True)
            return None

    @classmethod
    def get_owner_transfer_data(cls, token: str) -> dict[str, Any] | None:
        return TokenManager.get_token_data(token, "owner_transfer")

    @classmethod
    def send_email_code_login_email(
        cls,
        account: Account | None = None,
        email: str | None = None,
        language: str = "en-US",
    ):
        email = account.email if account else email
        if email is None:
            raise ValueError("Email must be provided.")
        if cls.email_code_login_rate_limiter.is_rate_limited(email):
            from controllers.console.auth.error import EmailCodeLoginRateLimitExceededError

            raise EmailCodeLoginRateLimitExceededError(int(cls.email_code_login_rate_limiter.time_window / 60))

        code = "".join([str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6)])
        token = TokenManager.generate_token(
            account=account, email=email, token_type="email_code_login", additional_data={"code": code}
        )
        send_email_code_login_mail_task.delay(
            language=language,
            to=account.email if account else email,
            code=code,
        )
        cls.email_code_login_rate_limiter.increment_rate_limit(email)
        return token

    @staticmethod
    def get_account_by_email_with_case_fallback(session: Session | scoped_session, email: str) -> Account | None:
        """
        Retrieve an account by email and fall back to the lowercase email if the original lookup fails.

        This keeps backward compatibility for older records that stored uppercase emails while the
        rest of the system gradually normalizes new inputs.
        """
        account = session.execute(select(Account).where(Account.email == email)).scalar_one_or_none()
        if account or email == email.lower():
            return account

        return session.execute(select(Account).where(Account.email == email.lower())).scalar_one_or_none()

    @classmethod
    def get_email_code_login_data(cls, token: str) -> dict[str, Any] | None:
        return TokenManager.get_token_data(token, "email_code_login")

    @classmethod
    def revoke_email_code_login_token(cls, token: str):
        TokenManager.revoke_token(token, "email_code_login")

    @classmethod
    def get_user_through_email(cls, email: str, *, session: scoped_session | Session):
        if dify_config.BILLING_ENABLED and BillingService.is_email_in_freeze(email):
            raise AccountRegisterError(
                description=(
                    "This email account has been deleted within the past "
                    "30 days and is temporarily unavailable for new account registration"
                )
            )

        account = session.scalar(select(Account).where(Account.email == email).limit(1))
        if not account:
            return None

        if account.status == AccountStatus.BANNED:
            raise Unauthorized("Account is banned.")

        return account

    @classmethod
    def is_account_in_freeze(cls, email: str) -> bool:
        if dify_config.BILLING_ENABLED and BillingService.is_email_in_freeze(email):
            return True
        return False

    @staticmethod
    @redis_fallback(default_return=None)
    def add_login_error_rate_limit(email: str):
        key = f"login_error_rate_limit:{email}"
        count = redis_client.get(key)
        if count is None:
            count = 0
        count = int(count) + 1
        redis_client.setex(key, dify_config.LOGIN_LOCKOUT_DURATION, count)

    @staticmethod
    @redis_fallback(default_return=False)
    def is_login_error_rate_limit(email: str) -> bool:
        key = f"login_error_rate_limit:{email}"
        count = redis_client.get(key)
        if count is None:
            return False

        count = int(count)
        if count > AccountService.LOGIN_MAX_ERROR_LIMITS:
            return True
        return False

    @staticmethod
    @redis_fallback(default_return=None)
    def reset_login_error_rate_limit(email: str):
        key = f"login_error_rate_limit:{email}"
        redis_client.delete(key)

    @staticmethod
    @redis_fallback(default_return=None)
    def add_forgot_password_error_rate_limit(email: str):
        key = f"forgot_password_error_rate_limit:{email}"
        count = redis_client.get(key)
        if count is None:
            count = 0
        count = int(count) + 1
        redis_client.setex(key, dify_config.FORGOT_PASSWORD_LOCKOUT_DURATION, count)

    @staticmethod
    @redis_fallback(default_return=None)
    def add_email_register_error_rate_limit(email: str) -> None:
        key = f"email_register_error_rate_limit:{email}"
        count = redis_client.get(key)
        if count is None:
            count = 0
        count = int(count) + 1
        redis_client.setex(key, dify_config.EMAIL_REGISTER_LOCKOUT_DURATION, count)

    @staticmethod
    @redis_fallback(default_return=False)
    def is_forgot_password_error_rate_limit(email: str) -> bool:
        key = f"forgot_password_error_rate_limit:{email}"
        count = redis_client.get(key)
        if count is None:
            return False

        count = int(count)
        if count > AccountService.FORGOT_PASSWORD_MAX_ERROR_LIMITS:
            return True
        return False

    @staticmethod
    @redis_fallback(default_return=None)
    def reset_forgot_password_error_rate_limit(email: str):
        key = f"forgot_password_error_rate_limit:{email}"
        redis_client.delete(key)

    @staticmethod
    @redis_fallback(default_return=False)
    def is_email_register_error_rate_limit(email: str) -> bool:
        key = f"email_register_error_rate_limit:{email}"
        count = redis_client.get(key)
        if count is None:
            return False
        count = int(count)
        if count > AccountService.EMAIL_REGISTER_MAX_ERROR_LIMITS:
            return True
        return False

    @staticmethod
    @redis_fallback(default_return=None)
    def reset_email_register_error_rate_limit(email: str):
        key = f"email_register_error_rate_limit:{email}"
        redis_client.delete(key)

    @staticmethod
    @redis_fallback(default_return=None)
    def add_change_email_error_rate_limit(email: str):
        key = f"change_email_error_rate_limit:{email}"
        count = redis_client.get(key)
        if count is None:
            count = 0
        count = int(count) + 1
        redis_client.setex(key, dify_config.CHANGE_EMAIL_LOCKOUT_DURATION, count)

    @staticmethod
    @redis_fallback(default_return=False)
    def is_change_email_error_rate_limit(email: str) -> bool:
        key = f"change_email_error_rate_limit:{email}"
        count = redis_client.get(key)
        if count is None:
            return False
        count = int(count)
        if count > AccountService.CHANGE_EMAIL_MAX_ERROR_LIMITS:
            return True
        return False

    @staticmethod
    @redis_fallback(default_return=None)
    def reset_change_email_error_rate_limit(email: str):
        key = f"change_email_error_rate_limit:{email}"
        redis_client.delete(key)

    @staticmethod
    @redis_fallback(default_return=None)
    def add_owner_transfer_error_rate_limit(email: str):
        key = f"owner_transfer_error_rate_limit:{email}"
        count = redis_client.get(key)
        if count is None:
            count = 0
        count = int(count) + 1
        redis_client.setex(key, dify_config.OWNER_TRANSFER_LOCKOUT_DURATION, count)

    @staticmethod
    @redis_fallback(default_return=False)
    def is_owner_transfer_error_rate_limit(email: str) -> bool:
        key = f"owner_transfer_error_rate_limit:{email}"
        count = redis_client.get(key)
        if count is None:
            return False
        count = int(count)
        if count > AccountService.OWNER_TRANSFER_MAX_ERROR_LIMITS:
            return True
        return False

    @staticmethod
    @redis_fallback(default_return=None)
    def reset_owner_transfer_error_rate_limit(email: str):
        key = f"owner_transfer_error_rate_limit:{email}"
        redis_client.delete(key)

    @staticmethod
    @redis_fallback(default_return=False)
    def is_email_send_ip_limit(ip_address: str):
        minute_key = f"email_send_ip_limit_minute:{ip_address}"
        freeze_key = f"email_send_ip_limit_freeze:{ip_address}"
        hour_limit_key = f"email_send_ip_limit_hour:{ip_address}"

        # check ip is frozen
        if redis_client.get(freeze_key):
            return True

        # check current minute count
        current_minute_count = redis_client.get(minute_key)
        if current_minute_count is None:
            current_minute_count = 0
        current_minute_count = int(current_minute_count)

        # check current hour count
        if current_minute_count > dify_config.EMAIL_SEND_IP_LIMIT_PER_MINUTE:
            hour_limit_count = redis_client.get(hour_limit_key)
            if hour_limit_count is None:
                hour_limit_count = 0
            hour_limit_count = int(hour_limit_count)

            if hour_limit_count >= 1:
                redis_client.setex(freeze_key, 60 * 60, 1)
                return True
            else:
                redis_client.setex(hour_limit_key, 60 * 10, hour_limit_count + 1)  # first time limit 10 minutes

            # add hour limit count
            redis_client.incr(hour_limit_key)
            redis_client.expire(hour_limit_key, 60 * 60)

            return True

        redis_client.setex(minute_key, 60, current_minute_count + 1)
        redis_client.expire(minute_key, 60)

        return False

    @staticmethod
    def check_email_unique(email: str, *, session: scoped_session | Session) -> bool:
        return session.scalar(select(Account).where(Account.email == email).limit(1)) is None


class TenantService:
    @staticmethod
    def create_tenant(
        name: str,
        is_setup: bool | None = False,
        is_from_dashboard: bool | None = False,
        *,
        session: scoped_session | Session,
    ) -> Tenant:
        """Create tenant"""
        if (
            not FeatureService.get_system_features().is_allow_create_workspace
            and not is_setup
            and not is_from_dashboard
        ):
            from controllers.console.error import NotAllowedCreateWorkspace

            raise NotAllowedCreateWorkspace()
        tenant = Tenant(name=name)

        session.add(tenant)
        session.commit()

        for category in TenantPluginAutoUpgradeStrategy.PluginCategory:
            plugin_upgrade_strategy = TenantPluginAutoUpgradeStrategy(
                tenant_id=tenant.id,
                category=category,
                strategy_setting=PluginAutoUpgradeService.default_strategy_setting_for_category(category),
                upgrade_time_of_day=PluginAutoUpgradeService.default_upgrade_time_of_day(tenant.id),
                upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE,
                exclude_plugins=[],
                include_plugins=[],
            )
            session.add(plugin_upgrade_strategy)
        session.commit()

        tenant.encrypt_public_key = generate_key_pair(tenant.id)
        session.commit()

        from services.credit_pool_service import CreditPoolService

        CreditPoolService.create_default_pool(tenant.id)

        return tenant

    @staticmethod
    def create_owner_tenant_if_not_exist(
        account: Account, name: str | None = None, is_setup: bool | None = False, *, session: scoped_session | Session
    ):
        """Check if user have a workspace or not"""
        available_ta = session.scalar(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.account_id == account.id)
            .order_by(TenantAccountJoin.id.asc())
            .limit(1)
        )

        if available_ta:
            return

        """Create owner tenant if not exist"""
        if not FeatureService.get_system_features().is_allow_create_workspace and not is_setup:
            raise WorkSpaceNotAllowedCreateError()

        workspaces = FeatureService.get_system_features().license.workspaces
        if not workspaces.is_available():
            raise WorkspacesLimitExceededError()

        if name:
            tenant = TenantService.create_tenant(name=name, is_setup=is_setup, session=session)
        else:
            tenant = TenantService.create_tenant(name=f"{account.name}'s Workspace", is_setup=is_setup, session=session)
        TenantService.create_tenant_member(tenant, account, session, role="owner")
        if dify_config.RBAC_ENABLED:
            owner_role_id = AccountService._resolve_legacy_role_id(str(tenant.id), account.id, TenantAccountRole.OWNER)
            RBACService.MemberRoles.replace(
                tenant_id=str(tenant.id),
                account_id=account.id,
                member_account_id=account.id,
                role_ids=[owner_role_id],
            )
        account.current_tenant = tenant
        session.commit()
        tenant_was_created.send(tenant)

    @staticmethod
    def create_tenant_member(
        tenant: Tenant, account: Account, session: scoped_session | Session, role: str = "normal"
    ) -> TenantAccountJoin:
        """Create tenant member"""
        if role == TenantAccountRole.OWNER:
            if TenantService.has_roles(tenant, [TenantAccountRole.OWNER], session=session):
                logger.error("Tenant %s has already an owner.", tenant.id)
                raise Exception("Tenant already has an owner.")

        ta = session.scalar(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == account.id)
            .limit(1)
        )
        if ta:
            ta.role = TenantAccountRole(role)
        else:
            ta = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole(role))
            session.add(ta)

        session.commit()
        if dify_config.BILLING_ENABLED:
            BillingService.clean_billing_info_cache(tenant.id)
        return ta

    @staticmethod
    def get_join_tenants(account: Account, *, session: scoped_session | Session) -> list[Tenant]:
        """Get account join tenants"""
        return list(
            session.scalars(
                select(Tenant)
                .join(TenantAccountJoin, Tenant.id == TenantAccountJoin.tenant_id)
                .where(TenantAccountJoin.account_id == account.id, Tenant.status == TenantStatus.NORMAL)
            ).all()
        )

    @staticmethod
    def get_account_memberships(
        session: Session | scoped_session,
        account_id: str,
    ) -> list[Row[tuple[TenantAccountJoin, Tenant]]]:
        """Return ``(TenantAccountJoin, Tenant)`` rows for every workspace
        the account belongs to. Unlike :meth:`get_join_tenants` this keeps
        the join row so callers can read ``role``/``current`` alongside the
        tenant — used by ``/openapi/v1/account`` to render workspace
        membership + pick the default workspace.

        ``session`` is injected by the caller so this service stays free
        of a Flask-scoped session import.

        No tenant-status filter: parity with the legacy controller query
        (the openapi identity endpoint listed all joined tenants).
        """
        return (
            session.query(TenantAccountJoin, Tenant)
            .join(Tenant, Tenant.id == TenantAccountJoin.tenant_id)
            .filter(TenantAccountJoin.account_id == account_id)
            .all()
        )

    @staticmethod
    def get_workspaces_for_account(
        session: Session | scoped_session,
        account_id: str,
    ) -> list[Row[tuple[Tenant, TenantAccountJoin]]]:
        """``(Tenant, TenantAccountJoin)`` rows for every workspace the
        account belongs to, ordered by ``Tenant.created_at`` ASC — the
        canonical ordering for ``/openapi/v1/workspaces``.

        Distinct from :meth:`get_account_memberships`: tuple order is
        flipped (tenant first) and rows are sorted, so the workspace
        listing is stable across requests.
        """
        return list(
            session.execute(
                select(Tenant, TenantAccountJoin)
                .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
                .where(TenantAccountJoin.account_id == account_id)
                .order_by(Tenant.created_at.asc())
            ).all()
        )

    @staticmethod
    def account_belongs_to_tenant(
        session: Session | scoped_session,
        account_id: uuid.UUID | str | None,
        tenant_id: str,
    ) -> bool:
        """Existence check for ``TenantAccountJoin(account_id, tenant_id)``.
        Backs the CE-deployment membership fallback in
        ``controllers.openapi.auth.strategies.MembershipStrategy``.

        ``None``/empty ``account_id`` short-circuits to ``False`` so SSO
        bearers (no account) and missing identity collapse cleanly.
        """
        if not account_id:
            return False
        row = session.execute(
            select(TenantAccountJoin.id).where(
                TenantAccountJoin.tenant_id == tenant_id,
                TenantAccountJoin.account_id == account_id,
            )
        ).scalar_one_or_none()
        return row is not None

    @staticmethod
    def get_account_role_in_tenant(
        session: Session | scoped_session,
        account_id: uuid.UUID | str | None,
        tenant_id: str,
    ) -> TenantAccountRole | None:
        """Return the caller's role in ``tenant_id``, or ``None`` if not a member.

        Backs the openapi auth pipeline's ``load_workspace_role`` prepare step:
        ``None`` is treated as non-member (the pipeline maps it to 404 — no
        cross-tenant ID leak) and an out-of-set role to 403.

        ``None``/empty ``account_id`` short-circuits to ``None`` so SSO
        bearers (no account) collapse to the non-member path. Mirrors the
        session-injection style of :meth:`account_belongs_to_tenant` rather
        than :meth:`get_user_role`, which loads full ``Account``/``Tenant``
        objects against the Flask-scoped session.
        """
        if not account_id:
            return None

        role = session.execute(
            select(TenantAccountJoin.role).where(
                TenantAccountJoin.tenant_id == tenant_id,
                TenantAccountJoin.account_id == account_id,
            )
        ).scalar_one_or_none()
        return TenantAccountRole(role) if role is not None else None

    @staticmethod
    def get_tenant_by_id(session: Session | scoped_session, tenant_id: str) -> Tenant | None:
        """Plain ``session.get(Tenant, tenant_id)`` — no status filter.
        Callers map ``status == ARCHIVE`` to their own error code (the
        openapi auth pipeline raises 403 ``workspace unavailable``).
        """
        return session.get(Tenant, tenant_id)

    @staticmethod
    def get_tenants_by_ids(
        session: Session | scoped_session,
        tenant_ids: list[str],
    ) -> list[Tenant]:
        """Bulk ``Tenant`` fetch by primary-key list. Order is unspecified
        — callers index by ``tenant.id`` (e.g. for cross-tenant denorm
        in ``/openapi/v1/permitted-external-apps``).

        Empty input short-circuits to ``[]`` to avoid emitting an
        ``IN ()`` SQL fragment.
        """
        if not tenant_ids:
            return []
        return list(session.execute(select(Tenant).where(Tenant.id.in_(tenant_ids))).scalars().all())

    @staticmethod
    def get_tenant_name(session: Session | scoped_session, tenant_id: str) -> str | None:
        """Single-column tenant name read. Used by openapi list endpoints
        to denormalize ``workspace_name`` onto each row without dragging
        the full ``Tenant`` ORM entity through.
        """
        return session.execute(select(Tenant.name).where(Tenant.id == tenant_id)).scalar_one_or_none()

    @staticmethod
    def find_workspace_for_account(
        session: Session | scoped_session,
        account_id: str,
        workspace_id: str,
    ) -> Row[tuple[Tenant, TenantAccountJoin]] | None:
        """Single ``(Tenant, TenantAccountJoin)`` row scoped to the
        account's membership in ``workspace_id``. ``None`` on non-member
        — the caller maps that to 404 (not 403) so workspace IDs don't
        leak across tenants via response codes.
        """
        return session.execute(
            select(Tenant, TenantAccountJoin)
            .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
            .where(
                Tenant.id == workspace_id,
                TenantAccountJoin.account_id == account_id,
            )
        ).first()

    @staticmethod
    def get_current_tenant_by_account(account: Account, *, session: scoped_session | Session):
        """Get tenant by account and add the role"""
        tenant = account.current_tenant
        if not tenant:
            raise TenantNotFoundError("Tenant not found.")

        ta = session.scalar(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == account.id)
            .limit(1)
        )
        if ta:
            object.__setattr__(tenant, "role", ta.role)
        else:
            raise TenantNotFoundError("Tenant not found for the account.")
        return tenant

    @staticmethod
    def switch_tenant(account: Account, tenant_id: str | None = None, *, session: scoped_session | Session):
        """Switch the current workspace for the account"""

        # Ensure tenant_id is provided
        if tenant_id is None:
            raise ValueError("Tenant ID must be provided.")

        tenant_account_join = session.scalar(
            select(TenantAccountJoin)
            .join(Tenant, TenantAccountJoin.tenant_id == Tenant.id)
            .where(
                TenantAccountJoin.account_id == account.id,
                TenantAccountJoin.tenant_id == tenant_id,
                Tenant.status == TenantStatus.NORMAL,
            )
            .limit(1)
        )

        if not tenant_account_join:
            raise AccountNotLinkTenantError("Tenant not found or account is not a member of the tenant.")
        else:
            session.execute(
                update(TenantAccountJoin)
                .where(TenantAccountJoin.account_id == account.id, TenantAccountJoin.tenant_id != tenant_id)
                .values(current=False)
            )
            tenant_account_join.current = True
            tenant_account_join.last_opened_at = naive_utc_now()
            # Set the current tenant for the account
            account.set_tenant_id(tenant_account_join.tenant_id)
            session.commit()

    @staticmethod
    def get_tenant_members(tenant: Tenant, *, session: scoped_session | Session) -> list[Account]:
        """Get tenant members"""
        stmt = (
            select(Account, TenantAccountJoin.role)
            .select_from(Account)
            .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
            .where(TenantAccountJoin.tenant_id == tenant.id)
        )

        # Initialize an empty list to store the updated accounts
        updated_accounts = []

        for account, role in session.execute(stmt):
            account.role = role
            updated_accounts.append(account)

        return updated_accounts

    @staticmethod
    def get_dataset_operator_members(tenant: Tenant, *, session: scoped_session | Session) -> list[Account]:
        """Get dataset admin members"""
        stmt = (
            select(Account, TenantAccountJoin.role)
            .select_from(Account)
            .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
            .where(TenantAccountJoin.tenant_id == tenant.id)
            .where(TenantAccountJoin.role == "dataset_operator")
        )

        # Initialize an empty list to store the updated accounts
        updated_accounts = []

        for account, role in session.execute(stmt):
            account.role = role
            updated_accounts.append(account)

        return updated_accounts

    @staticmethod
    def has_roles(tenant: Tenant, roles: list[TenantAccountRole], *, session: scoped_session | Session) -> bool:
        """Check if user has any of the given roles for a tenant"""
        if not all(isinstance(role, TenantAccountRole) for role in roles):
            raise ValueError("all roles must be TenantAccountRole")

        return (
            session.scalar(
                select(TenantAccountJoin)
                .where(
                    TenantAccountJoin.tenant_id == tenant.id,
                    TenantAccountJoin.role.in_([role.value for role in roles]),
                )
                .limit(1)
            )
            is not None
        )

    @staticmethod
    def get_user_role(
        account: Account, tenant: Tenant, *, session: scoped_session | Session
    ) -> TenantAccountRole | None:
        """Get the role of the current account for a given tenant"""
        join = session.scalar(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == account.id)
            .limit(1)
        )
        return TenantAccountRole(join.role) if join else None

    @staticmethod
    def get_tenant_count(*, session: scoped_session | Session) -> int:
        """Get tenant count"""
        return cast(int, session.scalar(select(func.count(Tenant.id))))

    @staticmethod
    def check_member_permission(
        tenant: Tenant, operator: Account, member: Account | None, action: str, *, session: scoped_session | Session
    ):
        """Check member permission"""
        if action not in {"add", "remove", "update"}:
            raise InvalidActionError("Invalid action.")

        if member:
            if operator.id == member.id:
                raise CannotOperateSelfError("Cannot operate self.")

        if dify_config.RBAC_ENABLED:
            workspace_permission_keys = AccountService.get_workspace_permission_keys(
                str(tenant.id),
                str(operator.id),
            )
            required_permission_key = (
                "workspace.member.manage" if action in {"add", "remove"} else "workspace.role.manage"
            )
            if required_permission_key not in workspace_permission_keys:
                raise NoPermissionError(f"No permission to {action} member.")

            if (
                action == "remove"
                and member
                and AccountService.is_rbac_workspace_owner(str(tenant.id), str(operator.id), str(member.id))
            ):
                raise NoPermissionError(f"No permission to {action} member.")
            return

        perms = {
            "add": [TenantAccountRole.OWNER, TenantAccountRole.ADMIN],
            "remove": [TenantAccountRole.OWNER, TenantAccountRole.ADMIN],
            "update": [TenantAccountRole.OWNER, TenantAccountRole.ADMIN],
        }

        ta_operator = session.scalar(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == operator.id)
            .limit(1)
        )

        if not ta_operator or ta_operator.role not in perms[action]:
            raise NoPermissionError(f"No permission to {action} member.")

        if action == "remove" and ta_operator.role == TenantAccountRole.ADMIN and member:
            ta_member = session.scalar(
                select(TenantAccountJoin)
                .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == member.id)
                .limit(1)
            )
            if ta_member and ta_member.role == TenantAccountRole.OWNER:
                raise NoPermissionError(f"No permission to {action} member.")

    @staticmethod
    def remove_member_from_tenant(
        tenant: Tenant, account: Account, operator: Account, *, session: scoped_session | Session
    ):
        """Remove member from tenant.

        Apps and datasets maintained by the removed member are reassigned to
        the workspace owner without changing their immutable creator records.
        If the removed member has ``AccountStatus.PENDING`` (invited but never
        activated) and no remaining workspace memberships, the orphaned account
        record is deleted as well.
        """
        if operator.id == account.id:
            raise CannotOperateSelfError("Cannot operate self.")

        TenantService.check_member_permission(tenant, operator, account, "remove", session=session)

        ta = session.scalar(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == account.id)
            .limit(1)
        )
        if not ta:
            raise MemberNotInTenantError("Member not in tenant.")

        # Capture identifiers before any deletions; attribute access on the ORM
        # object may fail after commit() expires the instance.
        account_id = account.id
        account_email = account.email

        owner_id: str | None
        if dify_config.RBAC_ENABLED:
            owner_id = AccountService.get_rbac_workspace_owner_account_id(str(tenant.id), str(operator.id))
        else:
            owner_id = session.scalar(
                select(TenantAccountJoin.account_id)
                .where(
                    TenantAccountJoin.tenant_id == tenant.id,
                    TenantAccountJoin.role == TenantAccountRole.OWNER,
                )
                .limit(1)
            )
        if owner_id is None:
            raise ValueError(f"Workspace owner not found for tenant {tenant.id}.")

        session.execute(
            update(App)
            .where(
                App.tenant_id == tenant.id,
                App.maintainer == account_id,
            )
            .values(maintainer=owner_id)
        )
        session.execute(
            update(Dataset)
            .where(
                Dataset.tenant_id == tenant.id,
                Dataset.maintainer == account_id,
            )
            .values(maintainer=owner_id)
        )
        session.delete(ta)

        # Clean up orphaned pending accounts (invited but never activated)
        should_delete_account = False
        if account.status == AccountStatus.PENDING:
            # autoflush flushes ta deletion before this query, so 0 means no remaining joins
            remaining_joins = (
                session.scalar(
                    select(func.count(TenantAccountJoin.id)).where(TenantAccountJoin.account_id == account_id)
                )
                or 0
            )
            if remaining_joins == 0:
                session.delete(account)
                should_delete_account = True

        session.commit()

        if should_delete_account:
            logger.info(
                "Deleted orphaned pending account: account_id=%s, email=%s",
                account_id,
                account_email,
            )

        if dify_config.BILLING_ENABLED:
            BillingService.clean_billing_info_cache(tenant.id)

        # Queue account deletion sync task for enterprise backend to reassign resources (enterprise only)
        from services.enterprise.account_deletion_sync import sync_workspace_member_removal

        sync_success = sync_workspace_member_removal(
            workspace_id=tenant.id, member_id=account_id, source="workspace_member_removed"
        )
        if not sync_success:
            logger.warning(
                "Enterprise workspace member removal sync failed: workspace_id=%s, member_id=%s",
                tenant.id,
                account_id,
            )

        if dify_config.RBAC_ENABLED:
            RBACService.MemberRoles.delete_rbac_bindings(tenant_id=tenant.id, account_id=account_id)

    @staticmethod
    def update_member_role(
        tenant: Tenant, member: Account, new_role: str, operator: Account, *, session: scoped_session | Session
    ):
        """Update member role"""
        TenantService.check_member_permission(tenant, operator, member, "update", session=session)
        new_tenant_role = TenantAccountRole(new_role)

        target_member_join = session.scalar(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == member.id)
            .limit(1)
        )

        if not target_member_join:
            raise MemberNotInTenantError("Member not in tenant.")

        operator_role = TenantService.get_user_role(operator, tenant, session=session)
        target_role = TenantAccountRole(target_member_join.role)
        if operator_role == TenantAccountRole.ADMIN and (TenantAccountRole.OWNER in {target_role, new_tenant_role}):
            raise NoPermissionError("No permission to update member.")

        if target_member_join.role == new_role:
            raise RoleAlreadyAssignedError("The provided role is already assigned to the member.")

        if new_role == "owner":
            # Find the current owner and change their role to 'admin'
            current_owner_join = session.scalar(
                select(TenantAccountJoin)
                .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.role == "owner")
                .limit(1)
            )
            if not dify_config.RBAC_ENABLED:
                if current_owner_join:
                    current_owner_join.role = TenantAccountRole.ADMIN
            elif current_owner_join:
                admin_role_id = AccountService._resolve_legacy_role_id(
                    tenant_id=str(tenant.id),
                    account_id=operator.id,
                    role=TenantAccountRole.ADMIN,
                )
                RBACService.MemberRoles.replace(
                    tenant_id=str(tenant.id),
                    account_id=operator.id,
                    member_account_id=str(current_owner_join.account_id),
                    role_ids=[admin_role_id],
                )

        # Update the role of the target member
        if dify_config.RBAC_ENABLED:
            resolved_role_id = AccountService._resolve_legacy_role_id(
                tenant_id=str(tenant.id),
                account_id=operator.id,
                role=TenantAccountRole.OWNER,
            )
            RBACService.MemberRoles.replace(
                tenant_id=str(tenant.id),
                account_id=operator.id,
                member_account_id=member.id,
                role_ids=[resolved_role_id],
            )
        else:
            target_member_join.role = new_tenant_role
        session.commit()

    @staticmethod
    def get_custom_config(tenant_id: str):
        tenant = db.get_or_404(Tenant, tenant_id)

        return tenant.custom_config_dict

    @staticmethod
    def is_owner(account: Account, tenant: Tenant, *, session: scoped_session | Session) -> bool:
        return TenantService.get_user_role(account, tenant, session=session) == TenantAccountRole.OWNER

    @staticmethod
    def is_member(account: Account, tenant: Tenant, *, session: scoped_session | Session) -> bool:
        """Check if the account is a member of the tenant"""
        return TenantService.get_user_role(account, tenant, session=session) is not None


class RegisterService:
    @classmethod
    def _get_invitation_token_key(cls, token: str) -> str:
        return f"member_invite:token:{token}"

    @classmethod
    def setup(
        cls,
        email: str,
        name: str,
        password: str,
        ip_address: str,
        language: str | None,
        *,
        session: scoped_session | Session,
    ):
        """
        Setup dify

        :param email: email
        :param name: username
        :param password: password
        :param ip_address: ip address
        :param language: language
        """
        try:
            account = AccountService.create_account(
                email=email,
                name=name,
                interface_language=get_valid_language(language),
                password=password,
                is_setup=True,
                session=session,
            )

            account.last_login_ip = ip_address
            account.initialized_at = naive_utc_now()

            TenantService.create_owner_tenant_if_not_exist(account=account, is_setup=True, session=session)

            dify_setup = DifySetup(version=dify_config.project.version)
            session.add(dify_setup)
            session.commit()
        except Exception as e:
            session.execute(delete(DifySetup))
            session.execute(delete(TenantAccountJoin))
            session.execute(delete(Account))
            session.execute(delete(Tenant))
            session.commit()

            logger.exception("Setup account failed, email: %s, name: %s", email, name)
            raise ValueError(f"Setup failed: {e}")

    @classmethod
    def register(
        cls,
        email: str,
        name: str,
        password: str | None = None,
        open_id: str | None = None,
        provider: str | None = None,
        language: str | None = None,
        status: AccountStatus | None = None,
        is_setup: bool | None = False,
        create_workspace_required: bool | None = True,
        timezone: str | None = None,
        *,
        session: scoped_session | Session,
    ) -> Account:
        """Register account"""
        session.begin_nested()
        try:
            interface_language = get_valid_language(language)
            account = AccountService.create_account(
                email=email,
                name=name,
                interface_language=interface_language,
                password=password,
                is_setup=is_setup,
                timezone=timezone,
                session=session,
            )
            account.status = status or AccountStatus.ACTIVE
            account.initialized_at = naive_utc_now()

            if open_id is not None and provider is not None:
                AccountService.link_account_integrate(provider, open_id, account, session=session)

            if (
                FeatureService.get_system_features().is_allow_create_workspace
                and create_workspace_required
                and FeatureService.get_system_features().license.workspaces.is_available()
            ):
                try:
                    tenant = TenantService.create_tenant(f"{account.name}'s Workspace", session=session)
                    TenantService.create_tenant_member(tenant, account, session, role="owner")
                    account.current_tenant = tenant
                    tenant_was_created.send(tenant)
                except Exception:
                    _try_join_enterprise_default_workspace(str(account.id))
                    raise

            session.commit()

            _try_join_enterprise_default_workspace(str(account.id))
        except WorkSpaceNotAllowedCreateError:
            session.rollback()
            logger.exception("Register failed")
            raise AccountRegisterError("Workspace is not allowed to create.")
        except AccountRegisterError as are:
            session.rollback()
            logger.exception("Register failed")
            raise are
        except Exception as e:
            session.rollback()
            logger.exception("Register failed")
            raise AccountRegisterError(f"Registration failed: {e}") from e

        return account

    @classmethod
    def invite_new_member(
        cls,
        tenant: Tenant,
        email: str,
        language: str | None,
        role: str = "normal",
        inviter: Account | None = None,
        *,
        session: scoped_session | Session,
    ) -> str:
        if not inviter:
            raise ValueError("Inviter is required")

        normalized_email = email.lower()
        tenant_join_role = TenantAccountRole.NORMAL.value if dify_config.RBAC_ENABLED else role

        """Invite new member"""
        # Check workspace permission for member invitations
        from libs.workspace_permission import check_workspace_member_invite_permission

        check_workspace_member_invite_permission(tenant.id)

        account = AccountService.get_account_by_email_with_case_fallback(db.session, email)

        requires_setup = False
        if not account:
            TenantService.check_member_permission(tenant, inviter, None, "add", session=session)
            name = normalized_email.split("@")[0]

            account = cls.register(
                email=normalized_email,
                name=name,
                language=language,
                status=AccountStatus.PENDING,
                is_setup=True,
                session=session,
            )
            TenantService.create_tenant_member(tenant, account, session, tenant_join_role)
            TenantService.switch_tenant(account, tenant.id, session=session)
            requires_setup = True
        else:
            TenantService.check_member_permission(tenant, inviter, account, "add", session=session)
            ta = session.scalar(
                select(TenantAccountJoin)
                .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == account.id)
                .limit(1)
            )
            requires_setup = account.status == AccountStatus.PENDING

            if not ta:
                TenantService.create_tenant_member(tenant, account, session, tenant_join_role)

            # Support resend invitation email when the account is pending status
            if account.status != AccountStatus.PENDING:
                if ta:
                    raise AccountAlreadyInTenantError("Account already in tenant.")

        # Assign RBAC role if RBAC is enabled
        if dify_config.RBAC_ENABLED:
            RBACService.MemberRoles.replace(
                tenant_id=str(tenant.id),
                account_id=inviter.id,
                member_account_id=account.id,
                role_ids=[role],
            )

        token = cls.generate_invite_token(tenant, account, role, requires_setup=requires_setup)
        language = account.interface_language or "en-US"

        # send email
        send_invite_member_mail_task.delay(
            language=language,
            to=account.email,
            token=token,
            inviter_name=inviter.name if inviter else "Dify",
            workspace_name=tenant.name,
        )

        return token

    @classmethod
    def generate_invite_token(
        cls, tenant: Tenant, account: Account, role: str = "normal", *, requires_setup: bool = False
    ) -> str:
        token = str(uuid.uuid4())
        invitation_data = {
            "account_id": account.id,
            "email": account.email,
            "workspace_id": tenant.id,
            "role": str(role),
            "requires_setup": requires_setup,
        }
        expiry_hours = dify_config.INVITE_EXPIRY_HOURS
        redis_client.setex(cls._get_invitation_token_key(token), expiry_hours * 60 * 60, json.dumps(invitation_data))
        return token

    @classmethod
    def is_valid_invite_token(cls, token: str) -> bool:
        data = redis_client.get(cls._get_invitation_token_key(token))
        return data is not None

    @classmethod
    def revoke_token(cls, workspace_id: str | None, email: str | None, token: str):
        if workspace_id and email:
            email_hash = sha256(email.encode()).hexdigest()
            cache_key = f"member_invite_token:{workspace_id}, {email_hash}:{token}"
            redis_client.delete(cache_key)
        else:
            redis_client.delete(cls._get_invitation_token_key(token))

    @classmethod
    def get_invitation_if_token_valid(
        cls, workspace_id: str | None, email: str | None, token: str, *, session: scoped_session | Session
    ) -> InvitationDetailDict | None:
        invitation_data = cls.get_invitation_by_token(token, workspace_id, email)
        if not invitation_data:
            return None

        tenant = session.scalar(
            select(Tenant).where(Tenant.id == invitation_data["workspace_id"], Tenant.status == "normal").limit(1)
        )

        if not tenant:
            return None

        account = session.scalar(select(Account).where(Account.email == invitation_data["email"]).limit(1))
        if not account:
            return None

        if invitation_data["account_id"] != str(account.id):
            return None

        return {
            "account": account,
            "data": invitation_data,
            "tenant": tenant,
        }

    @classmethod
    def get_invitation_by_token(
        cls, token: str, workspace_id: str | None = None, email: str | None = None
    ) -> InvitationData | None:
        if workspace_id is not None and email is not None:
            email_hash = sha256(email.encode()).hexdigest()
            cache_key = f"member_invite_token:{workspace_id}, {email_hash}:{token}"
            account_id = redis_client.get(cache_key)

            if not account_id:
                return None

            return {
                "account_id": account_id.decode("utf-8"),
                "email": email,
                "workspace_id": workspace_id,
            }
        else:
            data = redis_client.get(cls._get_invitation_token_key(token))
            if not data:
                return None

            invitation = _invitation_adapter.validate_json(data)
            return invitation

    @classmethod
    def get_invitation_with_case_fallback(
        cls, workspace_id: str | None, email: str | None, token: str, *, session: scoped_session | Session
    ) -> InvitationDetailDict | None:
        invitation = cls.get_invitation_if_token_valid(workspace_id, email, token, session=session)
        if invitation or not email or email == email.lower():
            return invitation
        normalized_email = email.lower()
        return cls.get_invitation_if_token_valid(workspace_id, normalized_email, token, session=session)


def _generate_refresh_token(length: int = 64):
    token = secrets.token_hex(length)
    return token
