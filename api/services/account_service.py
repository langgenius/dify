"""Account, workspace, and invitation services.

Database access in this module has explicit ownership: ORM helpers accept a caller-owned ``session`` while ID-only
orchestration opens short sessions around database work and closes them before external I/O.
"""

import base64
import json
import logging
import secrets
import uuid
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, nullcontext
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import TYPE_CHECKING, Any, NotRequired, TypedDict, cast

from pydantic import BaseModel, TypeAdapter, ValidationError
from redis.exceptions import LockNotOwnedError, RedisError
from sqlalchemy import Row, delete, func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session
from werkzeug.exceptions import Conflict, Unauthorized

from configs import dify_config
from constants.languages import get_valid_language, language_timezone_mapping
from core.db.session_factory import session_factory
from enums import DeploymentEdition
from events.tenant_event import tenant_was_created
from extensions.ext_database import db
from extensions.ext_redis import redis_client, redis_fallback
from extensions.redis_names import serialize_redis_name
from libs.datetime_utils import naive_utc_now
from libs.helper import RateLimiter, TokenManager
from libs.helper import timezone as validate_timezone
from libs.key_providers import generate_key_pair
from libs.passport import PassportService
from libs.password import compare_password, hash_password, valid_password
from libs.token import generate_csrf_token
from models.account import (
    Account,
    AccountIntegrate,
    AccountStatus,
    Tenant,
    TenantAccountJoin,
    TenantAccountRole,
    TenantPluginAutoUpgradeCategory,
    TenantPluginAutoUpgradeMode,
    TenantPluginAutoUpgradeStrategy,
    TenantStatus,
)
from models.dataset import Dataset
from models.model import App, DifySetup
from services.billing_service import BillingService
from services.email_code_login_challenge import (
    EmailCodeLoginChallengeResult,
    EmailCodeLoginChallengeStore,
)
from services.enterprise.rbac_service import ListOption, RBACService, require_tenant_members
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
    RefreshTokenAccountNotFoundError,
    RefreshTokenNotFoundError,
    RoleAlreadyAssignedError,
    SeatsLimitExceededError,
    TenantNotFoundError,
    WorkspaceMembersLimitExceededError,
)
from services.errors.enterprise import EnterpriseAPIError
from services.errors.workspace import WorkSpaceNotAllowedCreateError, WorkspacesLimitExceededError
from services.feature_service import FeatureService
from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService
from services.telemetry_service import CommunityTelemetryService
from services.workspace_membership_lock import (
    account_membership_mutation_lock,
    account_workspace_membership_mutation_lock,
    account_workspace_membership_mutation_locks,
    workspace_membership_mutation_lock,
    workspace_membership_mutation_locks,
)
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

if TYPE_CHECKING:
    from services.workspace_member_query_service import WorkspaceInvitationRecord


class InvitationData(TypedDict):
    account_id: str
    email: str
    workspace_id: str
    role: str
    inviter_id: str
    rbac_role_id: NotRequired[str]


_invitation_adapter: TypeAdapter[InvitationData] = TypeAdapter(InvitationData)

logger = logging.getLogger(__name__)

_change_email_token_adapter: TypeAdapter[ChangeEmailTokenData] = TypeAdapter(ChangeEmailTokenData)


@contextmanager
def _invitation_lock(key: str, *, timeout: int) -> Generator[None]:
    lock = redis_client.lock(key, timeout=timeout)
    if not lock.acquire(blocking=True, blocking_timeout=dify_config.ENTERPRISE_REQUEST_TIMEOUT):
        raise Conflict("Another account invitation is in progress.")
    try:
        yield
    finally:
        try:
            lock.release()
        except (LockNotOwnedError, RedisError):
            logger.warning("Failed to release the account invitation lock %s", key)


class InvitationDetailDict(TypedDict):
    account: Account
    data: InvitationData
    tenant: Tenant


def _try_join_enterprise_default_workspace(account_id: str) -> None:
    """Best-effort join to enterprise default workspace."""
    if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
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
    def _resolve_legacy_role_id(tenant_id: str, account_id: str | None, role: TenantAccountRole) -> str:
        """Resolve a legacy workspace role to the corresponding RBAC role id.

        Looks up the builtin RBAC role whose tag matches the legacy role name
        (e.g. ``TenantAccountRole.ADMIN`` → builtin role with tag ``"admin"``).
        """
        options = ListOption(page_number=1, results_per_page=100)
        roles = RBACService.Roles.list(tenant_id, account_id, include_owner=1, options=options).data

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
        return set(RBACService.MyPermissions.get(tenant_id, account_id).workspace.permission_keys)

    @staticmethod
    def get_rbac_workspace_owner_account_id(tenant_id: str) -> str:
        """Return the account id bound to the workspace owner RBAC role."""
        with session_factory.create_session() as member_session:
            owner_account_ids = list(
                member_session.scalars(
                    select(TenantAccountJoin.account_id)
                    .where(
                        TenantAccountJoin.tenant_id == tenant_id,
                        TenantAccountJoin.role == TenantAccountRole.OWNER,
                    )
                    .limit(2)
                )
            )
        if len(owner_account_ids) != 1:
            raise EnterpriseAPIError(f"Workspace RBAC owner not found for tenant {tenant_id}.", status_code=503)

        owner_account_id = owner_account_ids[0]
        owner_role_id = AccountService._resolve_legacy_role_id(
            tenant_id=tenant_id,
            account_id=None,
            role=TenantAccountRole.OWNER,
        )
        remote_owners = RBACService.Roles.members(
            tenant_id=tenant_id,
            account_id=None,
            role_id=owner_role_id,
            options=ListOption(page_number=1, results_per_page=2),
        )
        remote_owner_ids = {member.account_id for member in remote_owners.data if member.account_id}
        remote_owner_count = remote_owners.pagination.total_count if remote_owners.pagination else len(remote_owner_ids)
        if remote_owner_count != 1 or remote_owner_ids != {owner_account_id}:
            raise EnterpriseAPIError(f"Workspace RBAC owner is inconsistent for tenant {tenant_id}.", status_code=503)
        return owner_account_id

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
    def _refresh_account_last_active(account: Account, session: Session) -> None:
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
    def get_account_by_email(email: str, *, session: Session) -> Account | None:
        """Plain ``Account`` getter keyed by email. Case-sensitive — use
        :meth:`has_active_account_with_email` for the case-insensitive
        existence check that backs the SSO collision rule.
        """
        return session.execute(select(Account).where(Account.email == email)).scalar_one_or_none()

    @staticmethod
    def has_active_account_with_email(email: str, *, session: Session) -> bool:
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
    def get_account_by_id(account_id: str, *, session: Session) -> Account | None:
        """Plain ``Account`` getter — no banned check, no tenant rotation,
        no ``last_active_at`` write. Use this from read-only identity
        endpoints (``/openapi/v1/account``) where ``load_user``'s
        side-effects (current-tenant assignment, commit) are unwanted.

        ``session`` is injected by the caller so this service stays free
        of a Flask-scoped session import.
        """
        return session.get(Account, account_id)

    @staticmethod
    def load_user(user_id: str, session: Session) -> None | Account:
        account = session.get(Account, user_id)
        if not account:
            return None

        if account.status == AccountStatus.BANNED:
            raise Unauthorized("Account is banned.")
        if account.status not in (AccountStatus.PENDING, AccountStatus.ACTIVE):
            raise Unauthorized("Account is not active.")

        current_tenant_join = session.scalar(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.account_id == account.id, TenantAccountJoin.current == True)
            .limit(1)
        )
        current_tenant = session.get(Tenant, current_tenant_join.tenant_id) if current_tenant_join is not None else None
        has_valid_current_tenant = (
            current_tenant_join is not None
            and current_tenant is not None
            and current_tenant.status == TenantStatus.NORMAL
        )
        if has_valid_current_tenant:
            account.set_tenant_id_with_session(current_tenant_join.tenant_id, session=session)
        else:
            if current_tenant_join is not None:
                current_tenant_join.current = False

            available_tenant_join = session.scalar(
                select(TenantAccountJoin)
                .join(Tenant, TenantAccountJoin.tenant_id == Tenant.id)
                .where(
                    TenantAccountJoin.account_id == account.id,
                    Tenant.status == TenantStatus.NORMAL,
                )
                .order_by(TenantAccountJoin.id.asc())
                .limit(1)
            )
            if available_tenant_join is not None:
                account.set_tenant_id_with_session(available_tenant_join.tenant_id, session=session)
                available_tenant_join.current = True
                available_tenant_join.last_opened_at = naive_utc_now()
            if current_tenant_join is not None or available_tenant_join is not None:
                session.commit()

        AccountService._refresh_account_last_active(account, session)
        # NOTE: make sure account is accessible outside of a db session
        # This ensures that it will work correctly after upgrading to Flask version 3.1.2
        session.refresh(account)
        if session.expire_on_commit and account.current_tenant is not None:
            session.refresh(account.current_tenant)
        session.close()
        return account

    @staticmethod
    def get_account_jwt_token(account: Account) -> str:
        exp_dt = datetime.now(UTC) + timedelta(minutes=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES)
        exp = int(exp_dt.timestamp())
        payload = {
            "user_id": account.id,
            "exp": exp,
            "iss": dify_config.DEPLOYMENT_EDITION.value,
            "sub": "Console API Passport",
        }

        token: str = PassportService().issue(payload)
        return token

    @staticmethod
    def authenticate(email: str, password: str, invite_token: str | None = None, *, session: Session) -> Account:
        """authenticate account with email and password"""

        account = session.scalar(select(Account).where(Account.email == email).limit(1))
        if not account:
            raise AccountPasswordError("Invalid email or password.")

        if account.status == AccountStatus.BANNED:
            raise AccountLoginError("Account is banned.")
        if account.status not in (AccountStatus.PENDING, AccountStatus.ACTIVE):
            raise AccountLoginError("Account is not active.")

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

        if not invite_token:
            account = AccountService.activate_pending_account(account.id, session=session)

        session.commit()

        return account

    @staticmethod
    def activate_pending_account(account_id: str, *, session: Session) -> Account:
        """Atomically activate a pending account without ever reviving a closed one."""
        with account_membership_mutation_lock(account_id):
            result = session.execute(
                update(Account)
                .where(Account.id == account_id, Account.status == AccountStatus.PENDING)
                .values(status=AccountStatus.ACTIVE, initialized_at=naive_utc_now())
            )
            if cast(CursorResult[Any], result).rowcount:
                session.commit()

            account = session.get(Account, account_id, populate_existing=True)
            if account is None or account.status != AccountStatus.ACTIVE:
                session.rollback()
                raise AccountLoginError("Account is not active.")
            return account

    @staticmethod
    def update_account_password(account: Account, password: str, new_password: str, *, session: Session):
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
        ip_address: str | None = None,
        *,
        session: Session,
    ) -> Account:
        """Create an account, preferring explicit user timezone over language-derived defaults."""
        if not FeatureService.get_system_features().is_allow_register and not is_setup:
            from controllers.console.error import AccountNotFound

            raise AccountNotFound()

        # A licensed seat is one Account row, deployment-wide; joining an existing
        # account into another workspace does not pass through here and costs no seat.
        # get_license() carries the full license payload that server-side enforcement needs;
        # the public system-features endpoint exposes only license status.
        if not FeatureService.get_license().seats.is_available():
            raise SeatsLimitExceededError("licensed seats limit exceeded")

        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and BillingService.is_email_in_freeze(email):
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
            last_login_ip=ip_address,
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
        ip_address: str | None = None,
        *,
        session: Session,
    ) -> Account:
        """Create an account and owner workspace."""
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language=interface_language,
            password=password,
            timezone=timezone,
            ip_address=ip_address,
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
    def delete_account(account: Account, *, session: Session):
        """Close an account after durably queueing cleanup for its locked membership snapshot."""
        from services.enterprise.account_deletion_sync import sync_account_deletion

        account_id = str(account.id)
        with account_membership_mutation_lock(account_id):
            persisted_account = session.get(Account, account_id, populate_existing=True)
            if persisted_account is None or persisted_account.status not in (
                AccountStatus.PENDING,
                AccountStatus.ACTIVE,
            ):
                raise AccountLoginError("Account is not active.")

            workspace_ids = sorted(
                set(
                    session.scalars(
                        select(TenantAccountJoin.tenant_id).where(TenantAccountJoin.account_id == account_id)
                    )
                )
            )

            with workspace_membership_mutation_locks(workspace_ids):
                persisted_account = session.get(Account, account_id, populate_existing=True)
                if persisted_account is None or persisted_account.status not in (
                    AccountStatus.PENDING,
                    AccountStatus.ACTIVE,
                ):
                    raise AccountLoginError("Account is not active.")
                memberships = list(
                    session.execute(
                        select(TenantAccountJoin.tenant_id, TenantAccountJoin.role).where(
                            TenantAccountJoin.account_id == account_id
                        )
                    )
                )
                if {tenant_id for tenant_id, _ in memberships} != set(workspace_ids):
                    raise Conflict("Account workspace memberships changed; retry deletion.")
                if dify_config.RBAC_ENABLED:
                    with ThreadPoolExecutor() as executor:
                        rbac_owner_ids = list(
                            executor.map(AccountService.get_rbac_workspace_owner_account_id, workspace_ids)
                        )
                    if account_id in rbac_owner_ids:
                        raise Conflict("Transfer workspace ownership before deleting the account.")
                if any(role == TenantAccountRole.OWNER for _, role in memberships):
                    raise Conflict("Transfer workspace ownership before deleting the account.")

                if not sync_account_deletion(
                    account_id=account_id,
                    workspace_ids=workspace_ids,
                    source="account_deleted",
                ):
                    raise RuntimeError("Failed to queue enterprise account cleanup.")

                delete_account_task.delay(account_id)
                persisted_account.status = AccountStatus.CLOSED
                try:
                    session.commit()
                except Exception:
                    session.rollback()
                    raise

    @staticmethod
    def link_account_integrate(provider: str, open_id: str, account: Account, *, session: Session):
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
    def close_account(account: Account, *, session: Session):
        """Close account"""
        account.status = AccountStatus.CLOSED
        session.commit()

    @staticmethod
    def update_account(account: Account, *, session: Session, **kwargs: str | None) -> Account:
        """Update mutable account profile fields without persisting detached state."""
        profile_fields = {"name", "avatar", "interface_language", "interface_theme", "timezone"}
        if invalid_fields := kwargs.keys() - profile_fields:
            raise AttributeError(f"Invalid field: {min(invalid_fields)}")

        with account_membership_mutation_lock(account.id):
            fresh_account = TenantService.get_membership_eligible_account(account.id, session=session)
            if fresh_account is None:
                raise AccountLoginError("Account is not active.")
            for field, value in kwargs.items():
                setattr(fresh_account, field, value)
            session.commit()
            return fresh_account

    @staticmethod
    def update_account_email(account: Account, email: str, session: Session) -> Account:
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
    def update_login_info(account: Account, session: Session, *, ip_address: str):
        """Update last login time and ip"""
        account.last_login_at = naive_utc_now()
        account.last_login_ip = ip_address
        session.add(account)
        session.commit()

    @staticmethod
    def login(
        account: Account,
        *,
        session: Session,
        ip_address: str | None = None,
        activate_pending: bool = True,
    ) -> TokenPair:
        if activate_pending:
            account = AccountService.activate_pending_account(account.id, session=session)

        if ip_address:
            AccountService.update_login_info(account=account, session=session, ip_address=ip_address)

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
    def refresh_token(refresh_token: str, *, session: Session) -> TokenPair:
        # Verify the refresh token
        account_id = redis_client.get(AccountService._get_refresh_token_key(refresh_token))
        if not account_id:
            raise RefreshTokenNotFoundError("Invalid refresh token")

        account = AccountService.load_user(account_id.decode("utf-8"), session)
        if not account:
            raise RefreshTokenAccountNotFoundError("Invalid account")

        # Generate new access token and refresh token
        new_access_token = AccountService.get_account_jwt_token(account)
        new_refresh_token = _generate_refresh_token()

        AccountService._delete_refresh_token(refresh_token, account.id)
        AccountService._store_refresh_token(new_refresh_token, account.id)
        csrf_token = generate_csrf_token(account.id)

        return TokenPair(access_token=new_access_token, refresh_token=new_refresh_token, csrf_token=csrf_token)

    @staticmethod
    def load_logged_in_account(*, account_id: str, session: Session):
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
        email = email.lower()
        if cls.email_code_login_rate_limiter.is_rate_limited(email):
            from controllers.console.auth.error import EmailCodeLoginRateLimitExceededError

            raise EmailCodeLoginRateLimitExceededError(int(cls.email_code_login_rate_limiter.time_window / 60))

        code = "".join([str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6)])
        token = EmailCodeLoginChallengeStore.create(
            account_id=str(account.id) if account else None,
            email=email,
            code=code,
        )
        send_email_code_login_mail_task.delay(
            language=language,
            to=account.email if account else email,
            code=code,
        )
        cls.email_code_login_rate_limiter.increment_rate_limit(email)
        return token

    @staticmethod
    def get_account_by_email_with_case_fallback(email: str, *, session: Session) -> Account | None:
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
    def verify_email_code_login_challenge(cls, *, email: str, code: str, token: str) -> EmailCodeLoginChallengeResult:
        return EmailCodeLoginChallengeStore.verify(email=email, code=code, token=token)

    @classmethod
    def revoke_email_code_login_token(cls, token: str):
        TokenManager.revoke_token(token, "email_code_login")

    @classmethod
    def get_user_through_email(cls, email: str, *, session: Session):
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and BillingService.is_email_in_freeze(email):
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
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and BillingService.is_email_in_freeze(email):
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

            # First strike claims a 10-minute window atomically; a concurrent
            # over-limit request that loses the claim is the second strike and
            # freezes the IP for an hour.
            if not redis_client.set(hour_limit_key, 1, ex=60 * 10, nx=True):
                redis_client.setex(freeze_key, 60 * 60, 1)

            return True

        redis_client.setex(minute_key, 60, current_minute_count + 1)
        redis_client.expire(minute_key, 60)

        return False

    @staticmethod
    def check_email_unique(email: str, *, session: Session) -> bool:
        return session.scalar(select(Account).where(Account.email == email).limit(1)) is None


class TenantService:
    @staticmethod
    def get_membership_eligible_account(account_id: str, *, session: Session) -> Account | None:
        account = session.get(Account, account_id, populate_existing=True)
        if account is None or account.status not in (AccountStatus.PENDING, AccountStatus.ACTIVE):
            return None
        return account

    @staticmethod
    def create_tenant(
        name: str,
        is_setup: bool | None = False,
        is_from_dashboard: bool | None = False,
        *,
        session: Session,
    ) -> Tenant:
        """Create tenant"""
        if not FeatureService.is_workspace_creation_allowed() and not is_setup and not is_from_dashboard:
            from controllers.console.error import NotAllowedCreateWorkspace

            raise NotAllowedCreateWorkspace()
        tenant = TenantService._stage_tenant(name, TenantStatus.NORMAL, session=session)
        session.commit()
        return tenant

    @staticmethod
    def _stage_tenant(name: str, status: TenantStatus, *, session: Session) -> Tenant:
        """Add a complete tenant aggregate to the caller's transaction."""
        tenant = Tenant(name=name, status=status)
        # Key providers may perform storage or KMS I/O. Tenant ids are generated
        # in Python, so provision the key before adding or flushing the tenant.
        tenant.encrypt_public_key = generate_key_pair(tenant.id)
        session.add(tenant)
        session.flush()
        for category in TenantPluginAutoUpgradeCategory:
            session.add(
                TenantPluginAutoUpgradeStrategy(
                    tenant_id=tenant.id,
                    category=category,
                    strategy_setting=PluginAutoUpgradeService.default_strategy_setting_for_category(category),
                    upgrade_time_of_day=PluginAutoUpgradeService.default_upgrade_time_of_day(tenant.id),
                    upgrade_mode=TenantPluginAutoUpgradeMode.EXCLUDE,
                    exclude_plugins=[],
                    include_plugins=[],
                )
            )

        from services.credit_pool_service import CreditPoolService

        CreditPoolService.create_default_pool(tenant.id, session=session)
        return tenant

    @staticmethod
    def create_owner_tenant_if_not_exist(
        account: Account, name: str | None = None, is_setup: bool | None = False, *, session: Session
    ) -> Tenant:
        """Create an owner workspace or finish its interrupted RBAC bootstrap."""
        with account_membership_mutation_lock(account.id):
            return TenantService._create_or_resume_owner_tenant(
                account,
                name=name,
                is_setup=is_setup,
                only_if_no_membership=True,
                session=session,
            )

    @staticmethod
    def create_owner_tenant(
        account: Account,
        name: str | None = None,
        is_setup: bool | None = False,
        is_from_dashboard: bool | None = False,
        *,
        session: Session,
    ) -> Tenant:
        """Create an owner workspace and bind its owner RBAC role when enabled.

        This is the single write path for a newly created workspace with an
        owner. It persists the legacy membership before creating the matching
        RBAC role binding, then makes the workspace current for the account.
        """
        with account_membership_mutation_lock(account.id):
            return TenantService._create_or_resume_owner_tenant(
                account,
                name=name,
                is_setup=is_setup,
                is_from_dashboard=is_from_dashboard,
                only_if_no_membership=False,
                session=session,
            )

    @staticmethod
    def _create_or_resume_owner_tenant(
        account: Account,
        name: str | None = None,
        is_setup: bool | None = False,
        is_from_dashboard: bool | None = False,
        only_if_no_membership: bool = False,
        *,
        session: Session,
    ) -> Tenant:
        account_id = str(account.id)
        with session_factory.create_session() as read_session:
            fresh_account = TenantService.get_membership_eligible_account(account_id, session=read_session)
            if fresh_account is None:
                raise AccountRegisterError("Account is not eligible for workspace membership.")
            account_name = fresh_account.name
            provisioning_tenant_id = read_session.scalar(
                select(Tenant.id)
                .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
                .where(
                    TenantAccountJoin.account_id == account_id,
                    TenantAccountJoin.role == TenantAccountRole.OWNER,
                    Tenant.status == TenantStatus.PROVISIONING,
                )
                .order_by(Tenant.created_at, Tenant.id)
                .limit(1)
            )
            existing_membership = None
            if provisioning_tenant_id is None and only_if_no_membership:
                existing_membership = read_session.execute(
                    select(Tenant.id, TenantAccountJoin.role)
                    .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
                    .where(
                        TenantAccountJoin.account_id == account_id,
                        Tenant.status == TenantStatus.NORMAL,
                    )
                    .order_by(TenantAccountJoin.current.desc(), TenantAccountJoin.id)
                    .limit(1)
                ).one_or_none()

        if provisioning_tenant_id is not None:
            session.commit()
            return TenantService._finish_owner_tenant_provisioning(
                provisioning_tenant_id,
                account,
                account_id=account_id,
                session=session,
            )

        if existing_membership is not None:
            tenant_id, role = existing_membership
            if dify_config.RBAC_ENABLED and role == TenantAccountRole.OWNER:
                session.commit()
                with workspace_membership_mutation_lock(tenant_id):
                    RBACService.MemberRoles.bootstrap_owner(tenant_id, account_id)
            tenant = session.get(Tenant, tenant_id, populate_existing=True)
            if tenant is None:
                # A concurrent creator may have committed after the caller's
                # repeatable-read snapshot began. Refresh only when necessary.
                session.commit()
                tenant = session.get(Tenant, tenant_id, populate_existing=True)
            if tenant is None:
                raise TenantNotFoundError("Workspace not found.")
            return tenant

        # Owner creation historically commits its caller-owned session. End
        # that transaction before storage/KMS or RBAC I/O, and attach the
        # completed tenant using a fresh snapshot below.
        session.commit()
        if not FeatureService.is_workspace_creation_allowed() and not is_setup and not is_from_dashboard:
            raise WorkSpaceNotAllowedCreateError()

        workspaces = FeatureService.get_license().workspaces
        if not workspaces.is_available():
            raise WorkspacesLimitExceededError()

        with session_factory.create_session() as write_session:
            tenant = TenantService._stage_tenant(
                name or f"{account_name}'s Workspace",
                TenantStatus.PROVISIONING,
                session=write_session,
            )
            fresh_account = TenantService.get_membership_eligible_account(account_id, session=write_session)
            if fresh_account is None:
                raise AccountRegisterError("Account is not eligible for workspace membership.")
            write_session.add(
                TenantAccountJoin(
                    tenant_id=tenant.id,
                    account_id=account_id,
                    role=TenantAccountRole.OWNER,
                )
            )
            write_session.commit()
            tenant_id = tenant.id

        return TenantService._finish_owner_tenant_provisioning(
            tenant_id,
            account,
            account_id=account_id,
            session=session,
        )

    @staticmethod
    def _finish_owner_tenant_provisioning(
        tenant_id: str,
        account: Account,
        *,
        account_id: str,
        session: Session,
    ) -> Tenant:
        with workspace_membership_mutation_lock(tenant_id):
            if dify_config.RBAC_ENABLED:
                RBACService.MemberRoles.bootstrap_owner(tenant_id, account_id)

            with session_factory.create_session() as write_session:
                tenant = write_session.scalar(select(Tenant).where(Tenant.id == tenant_id).with_for_update())
                fresh_account = TenantService.get_membership_eligible_account(account_id, session=write_session)
                membership = write_session.scalar(
                    select(TenantAccountJoin).where(
                        TenantAccountJoin.tenant_id == tenant_id,
                        TenantAccountJoin.account_id == account_id,
                        TenantAccountJoin.role == TenantAccountRole.OWNER,
                    )
                )
                if tenant is None or fresh_account is None or membership is None:
                    raise AccountRegisterError("Owner workspace provisioning state is invalid.")
                if tenant.status != TenantStatus.PROVISIONING:
                    raise AccountRegisterError("Owner workspace is not awaiting provisioning.")

                write_session.execute(
                    update(TenantAccountJoin)
                    .where(
                        TenantAccountJoin.account_id == account_id,
                        TenantAccountJoin.tenant_id != tenant_id,
                    )
                    .values(current=False)
                )
                membership.current = True
                membership.last_opened_at = naive_utc_now()
                tenant.status = TenantStatus.NORMAL
                write_session.commit()

        try:
            tenant_was_created.send(tenant)
        except Exception:
            # The tenant is already durable and usable; post-commit notifications
            # must not turn a successful provisioning into an ambiguous retry.
            logger.exception("Failed to notify tenant creation for workspace %s", tenant_id)
        persisted_tenant = session.get(Tenant, tenant_id, populate_existing=True)
        if persisted_tenant is None:
            raise TenantNotFoundError("Workspace not found.")
        account.set_current_tenant_with_session(persisted_tenant, session=session)
        return persisted_tenant

    @staticmethod
    def ensure_member_capacity(tenant_id: str, candidate_accounts: dict[str, str]) -> None:
        """Ensure existing members and the proposed accounts fit the workspace."""
        features = FeatureService.get_features(tenant_id=tenant_id, exclude_vector_space=True)
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE:
            limit = features.workspace_members.limit if features.workspace_members.enabled else 0
        elif dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            limit = features.members.limit
        else:
            limit = 0
        if limit <= 0:
            return

        with session_factory.create_session() as session:
            member_ids = set(
                session.scalars(select(TenantAccountJoin.account_id).where(TenantAccountJoin.tenant_id == tenant_id))
            )
            eligible_candidate_ids = {
                account_id
                for account_id, email in session.execute(
                    select(Account.id, Account.email).where(
                        Account.id.in_(candidate_accounts),
                        Account.status.in_((AccountStatus.PENDING, AccountStatus.ACTIVE)),
                    )
                )
                if email.casefold() == candidate_accounts[account_id].casefold()
            }
        if len(member_ids | eligible_candidate_ids) > limit:
            raise WorkspaceMembersLimitExceededError("Workspace member limit reached.")

    @staticmethod
    def create_tenant_member(
        tenant: Tenant, account: Account, session: Session, role: str = "normal"
    ) -> TenantAccountJoin:
        """Create tenant member"""
        with account_workspace_membership_mutation_lock(account.id, tenant.id):
            eligible_account = TenantService.get_membership_eligible_account(account.id, session=session)
            if eligible_account is None:
                raise AccountRegisterError("Account is not eligible for workspace membership.")
            persisted_tenant = session.get(Tenant, tenant.id, populate_existing=True)
            if persisted_tenant is None:
                raise TenantNotFoundError("Workspace not found.")
            if role == TenantAccountRole.OWNER:
                if TenantService.has_roles(persisted_tenant, [TenantAccountRole.OWNER], session=session):
                    logger.error("Tenant %s has already an owner.", persisted_tenant.id)
                    raise Exception("Tenant already has an owner.")

            ta = session.scalar(
                select(TenantAccountJoin)
                .where(
                    TenantAccountJoin.tenant_id == persisted_tenant.id,
                    TenantAccountJoin.account_id == eligible_account.id,
                )
                .limit(1)
            )
            if ta:
                ta.role = TenantAccountRole(role)
            else:
                ta = TenantAccountJoin(
                    tenant_id=persisted_tenant.id,
                    account_id=eligible_account.id,
                    role=TenantAccountRole(role),
                )
                session.add(ta)

            session.commit()
            if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
                BillingService.clean_billing_info_cache(persisted_tenant.id)
            return ta

    @staticmethod
    def get_join_tenants(account: Account, *, session: Session) -> list[Tenant]:
        """Get account join tenants"""
        return list(
            session.scalars(
                select(Tenant)
                .join(TenantAccountJoin, Tenant.id == TenantAccountJoin.tenant_id)
                .where(TenantAccountJoin.account_id == account.id, Tenant.status == TenantStatus.NORMAL)
            ).all()
        )

    @staticmethod
    def account_belongs_to_tenant(account_id: uuid.UUID | str | None, tenant_id: str, *, session: Session) -> bool:
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
        account_id: uuid.UUID | str | None, tenant_id: str, *, session: Session
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
    def get_tenant_by_id(tenant_id: str, *, session: Session) -> Tenant | None:
        """Plain ``session.get(Tenant, tenant_id)`` with status left to the caller.

        Public admission paths reject every status other than ``NORMAL``.
        """
        return session.get(Tenant, tenant_id)

    @staticmethod
    def get_tenants_by_ids(tenant_ids: list[str], *, session: Session) -> list[Tenant]:
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
    def get_tenant_name(tenant_id: str, *, session: Session) -> str | None:
        """Single-column tenant name read. Used by openapi list endpoints
        to denormalize ``workspace_name`` onto each row without dragging
        the full ``Tenant`` ORM entity through.
        """
        return session.execute(select(Tenant.name).where(Tenant.id == tenant_id)).scalar_one_or_none()

    @staticmethod
    def find_workspace_for_account(
        account_id: str, workspace_id: str, *, session: Session
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
    def get_current_tenant_by_account(account: Account, *, session: Session):
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
    def switch_tenant(account: Account, tenant_id: str | None = None, *, session: Session):
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
            account.set_tenant_id_with_session(tenant_account_join.tenant_id, session=session)
            session.commit()

    @staticmethod
    def get_tenant_members(tenant: Tenant, *, session: Session) -> list[Account]:
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
    def get_dataset_operator_members(tenant: Tenant, *, session: Session) -> list[Account]:
        """Get dataset admin members"""
        stmt = (
            select(Account, TenantAccountJoin.role)
            .select_from(Account)
            .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
            .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.role == "dataset_operator")
        )

        # Initialize an empty list to store the updated accounts
        updated_accounts = []

        for account, role in session.execute(stmt):
            account.role = role
            updated_accounts.append(account)

        return updated_accounts

    @staticmethod
    def has_roles(tenant: Tenant, roles: list[TenantAccountRole], *, session: Session) -> bool:
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
    def get_user_role(account: Account, tenant: Tenant, *, session: Session) -> TenantAccountRole | None:
        """Get the role of the current account for a given tenant"""
        join = session.scalar(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == account.id)
            .limit(1)
        )
        return TenantAccountRole(join.role) if join else None

    @staticmethod
    def get_tenant_count(*, session: Session) -> int:
        """Get tenant count"""
        return cast(int, session.scalar(select(func.count(Tenant.id))))

    @staticmethod
    def check_member_permission(
        tenant: Tenant, operator: Account, member: Account | None, action: str, *, session: Session
    ):
        """Check member permission"""
        if action not in {"add", "remove", "update"}:
            raise InvalidActionError("Invalid action.")

        if member:
            if operator.id == member.id:
                raise CannotOperateSelfError("Cannot operate self.")

        ta_operator = session.scalar(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == operator.id)
            .limit(1)
        )

        if not ta_operator or ta_operator.role not in {TenantAccountRole.OWNER, TenantAccountRole.ADMIN}:
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
    def remove_member_from_tenant(tenant_id: str, account_id: str, operator_id: str) -> None:
        """Remove member from tenant.

        Apps and datasets maintained by the removed member are reassigned to
        the workspace owner without changing their immutable creator records.
        If the removed member has ``AccountStatus.PENDING`` (invited but never
        activated) and no remaining workspace memberships, the orphaned account
        record is deleted as well.
        """
        with account_workspace_membership_mutation_lock(account_id, tenant_id):
            with session_factory.create_session() as session:
                tenant = session.get(Tenant, tenant_id)
                account = session.get(Account, account_id)
                operator = session.get(Account, operator_id)
                membership = session.scalar(
                    select(TenantAccountJoin).where(
                        TenantAccountJoin.tenant_id == tenant_id,
                        TenantAccountJoin.account_id == account_id,
                    )
                )
            if not tenant or not operator:
                raise ValueError("Workspace member removal context not found.")
            if operator_id == account_id:
                raise CannotOperateSelfError("Cannot operate self.")

            if membership is None:
                token = RegisterService._current_invitation_token(tenant_id, account_id)
                invitation = RegisterService.get_invitation_by_token(token) if token else None
                if (
                    invitation is None
                    or invitation["workspace_id"] != tenant_id
                    or invitation["account_id"] != account_id
                ):
                    raise MemberNotInTenantError("Member not in tenant.")

                if dify_config.RBAC_ENABLED:
                    require_tenant_members(tenant_id, [operator_id])
                    if "workspace.member.manage" not in AccountService.get_workspace_permission_keys(
                        tenant_id, operator_id
                    ):
                        raise NoPermissionError("No permission to remove member.")
                    RBACService.MemberRoles.delete_rbac_bindings(tenant_id, operator_id, account_id)
                else:
                    with session_factory.create_session() as session:
                        TenantService.check_member_permission(tenant, operator, account, "remove", session=session)

                if (
                    account is not None
                    and account.status == AccountStatus.PENDING
                    and not RegisterService.has_other_current_invitation(account_id, tenant_id)
                ):
                    with session_factory.create_session() as session, session.begin():
                        pending_account = session.get(Account, account_id, populate_existing=True)
                        has_membership = session.scalar(
                            select(TenantAccountJoin.id).where(TenantAccountJoin.account_id == account_id).limit(1)
                        )
                        if pending_account is not None and pending_account.status == AccountStatus.PENDING:
                            if has_membership is None:
                                session.delete(pending_account)
                RegisterService.invalidate_member_invitation(tenant_id, account_id)
                return

            if account is None:
                raise MemberNotInTenantError("Member not in tenant.")

            if dify_config.RBAC_ENABLED:
                require_tenant_members(tenant_id, [operator_id, account_id])
                if "workspace.member.manage" not in AccountService.get_workspace_permission_keys(
                    tenant_id, operator_id
                ):
                    raise NoPermissionError("No permission to remove member.")
                owner_id = AccountService.get_rbac_workspace_owner_account_id(tenant_id)
                if owner_id == account_id:
                    raise NoPermissionError("No permission to remove member.")
            else:
                with session_factory.create_session() as session:
                    TenantService.check_member_permission(tenant, operator, account, "remove", session=session)
                    legacy_owner_id = session.scalar(
                        select(TenantAccountJoin.account_id)
                        .where(
                            TenantAccountJoin.tenant_id == tenant_id,
                            TenantAccountJoin.role == TenantAccountRole.OWNER,
                        )
                        .limit(1)
                    )
                    if legacy_owner_id is None:
                        raise ValueError(f"Workspace owner not found for tenant {tenant_id}.")
                    owner_id = legacy_owner_id

            from services.enterprise.account_deletion_sync import sync_workspace_member_removal

            if not sync_workspace_member_removal(
                workspace_id=tenant_id,
                member_id=account_id,
                source="workspace_member_removed",
            ):
                raise RuntimeError("Failed to queue enterprise workspace member cleanup.")

            has_other_invitation = account.status == AccountStatus.PENDING and (
                RegisterService.has_other_current_invitation(account_id, tenant_id)
            )
            RegisterService.invalidate_member_invitation(tenant_id, account_id)
            if dify_config.RBAC_ENABLED:
                RBACService.MemberRoles.delete_rbac_bindings(tenant_id, operator_id, account_id)

            with session_factory.create_session() as session, session.begin():
                member_row = session.execute(
                    select(Account, TenantAccountJoin)
                    .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
                    .where(Account.id == account_id, TenantAccountJoin.tenant_id == tenant_id)
                ).one_or_none()
                if not member_row:
                    raise MemberNotInTenantError("Member not in tenant.")
                account, ta = member_row
                account_email = account.email
                deleted_pending_account = TenantService._delete_member_records(
                    session,
                    tenant_id=tenant_id,
                    account=account,
                    membership=ta,
                    owner_id=owner_id,
                    has_other_invitation=has_other_invitation,
                )

        if deleted_pending_account:
            logger.info("Deleted orphaned pending account: account_id=%s, email=%s", account_id, account_email)

        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            BillingService.clean_billing_info_cache(tenant_id)

    @staticmethod
    def _delete_member_records(
        session: Session,
        *,
        tenant_id: str,
        account: Account,
        membership: TenantAccountJoin,
        owner_id: str,
        has_other_invitation: bool,
    ) -> bool:
        account_id = str(account.id)
        session.execute(
            update(App).where(App.tenant_id == tenant_id, App.maintainer == account_id).values(maintainer=owner_id)
        )
        session.execute(
            update(Dataset)
            .where(Dataset.tenant_id == tenant_id, Dataset.maintainer == account_id)
            .values(maintainer=owner_id)
        )
        session.delete(membership)
        if account.status == AccountStatus.PENDING and not has_other_invitation:
            remaining_joins = session.scalar(
                select(func.count(TenantAccountJoin.id)).where(TenantAccountJoin.account_id == account_id)
            )
            if not remaining_joins:
                session.delete(account)
                return True
        return False

    @staticmethod
    def update_member_role(
        tenant_id: str,
        member_id: str,
        new_role: str,
        operator_id: str,
        *,
        allow_owner_transfer: bool = False,
    ):
        """Update member role"""
        new_tenant_role = TenantAccountRole(new_role)

        if new_tenant_role == TenantAccountRole.OWNER and not allow_owner_transfer:
            raise NoPermissionError("Workspace owner can only be changed through owner transfer.")
        if allow_owner_transfer and new_tenant_role != TenantAccountRole.OWNER:
            raise ValueError("Owner transfer requires the owner role.")
        if allow_owner_transfer and operator_id == member_id:
            raise CannotOperateSelfError("Cannot transfer workspace ownership to self.")

        if dify_config.RBAC_ENABLED:
            if allow_owner_transfer:
                with account_workspace_membership_mutation_locks(
                    [operator_id, member_id],
                    [tenant_id],
                ):
                    with session_factory.create_session() as session:
                        tenant = session.get(Tenant, tenant_id)
                        operator = TenantService.get_membership_eligible_account(operator_id, session=session)
                        target = TenantService.get_membership_eligible_account(member_id, session=session)
                        memberships = list(
                            session.scalars(
                                select(TenantAccountJoin).where(
                                    TenantAccountJoin.tenant_id == tenant_id,
                                    TenantAccountJoin.account_id.in_([operator_id, member_id]),
                                )
                            )
                        )
                        by_account = {str(membership.account_id): membership for membership in memberships}
                        owners = list(
                            session.scalars(
                                select(TenantAccountJoin)
                                .where(
                                    TenantAccountJoin.tenant_id == tenant_id,
                                    TenantAccountJoin.role == TenantAccountRole.OWNER,
                                )
                                .limit(2)
                            )
                        )
                    if tenant is None or operator is None or target is None:
                        raise MemberNotInTenantError("Member not in tenant.")
                    if operator_id not in by_account or member_id not in by_account:
                        raise MemberNotInTenantError("Member not in tenant.")
                    if len(owners) != 1:
                        raise EnterpriseAPIError("Workspace owner is inconsistent.", status_code=503)
                    if str(owners[0].account_id) not in {operator_id, member_id}:
                        raise NoPermissionError("Only the workspace owner can transfer ownership.")

                    RBACService.MemberRoles.transfer_owner(tenant_id, operator_id, member_id)

                    with session_factory.create_session() as session, session.begin():
                        projected = list(
                            session.scalars(
                                select(TenantAccountJoin).where(
                                    TenantAccountJoin.tenant_id == tenant_id,
                                    TenantAccountJoin.account_id.in_([operator_id, member_id]),
                                )
                            )
                        )
                        projected_by_account = {str(membership.account_id): membership for membership in projected}
                        old_owner = projected_by_account.get(operator_id)
                        new_owner = projected_by_account.get(member_id)
                        if old_owner is None or new_owner is None:
                            raise MemberNotInTenantError("Member not in tenant.")
                        old_owner.role = TenantAccountRole.NORMAL
                        new_owner.role = TenantAccountRole.OWNER
                return

            resolved_role_id = AccountService._resolve_legacy_role_id(
                tenant_id=tenant_id,
                account_id=operator_id,
                role=new_tenant_role,
            )
            RBACService.MemberRoles.replace_user_roles(
                tenant_id=tenant_id,
                account_id=operator_id,
                member_account_id=member_id,
                role_ids=[resolved_role_id],
            )
            return

        with workspace_membership_mutation_lock(tenant_id):
            with session_factory.create_session() as session:
                tenant = session.get(Tenant, tenant_id)
                operator = session.get(Account, operator_id)
                member_with_join = session.execute(
                    select(Account, TenantAccountJoin)
                    .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
                    .where(Account.id == member_id, TenantAccountJoin.tenant_id == tenant_id)
                    .limit(1)
                ).one_or_none()
                if member_with_join is None:
                    raise MemberNotInTenantError("Member not in tenant.")
                if not tenant or not operator:
                    raise ValueError("Workspace member role context not found.")
                member, target_member_join = member_with_join

                TenantService.check_member_permission(tenant, operator, member, "update", session=session)
                operator_role = TenantService.get_user_role(operator, tenant, session=session)
                target_role = TenantAccountRole(target_member_join.role)
                if operator_role == TenantAccountRole.ADMIN and (
                    TenantAccountRole.OWNER in {target_role, new_tenant_role}
                ):
                    raise NoPermissionError("No permission to update member.")

                if target_member_join.role == new_tenant_role:
                    raise RoleAlreadyAssignedError("The provided role is already assigned to the member.")

                if new_tenant_role == TenantAccountRole.OWNER:
                    current_owner_join = session.scalar(
                        select(TenantAccountJoin)
                        .where(
                            TenantAccountJoin.tenant_id == tenant_id,
                            TenantAccountJoin.role == TenantAccountRole.OWNER,
                        )
                        .limit(1)
                    )
                    if current_owner_join:
                        current_owner_join.role = TenantAccountRole.ADMIN

                target_member_join.role = new_tenant_role
                session.commit()

    @staticmethod
    def get_custom_config(tenant_id: str):
        tenant = db.get_or_404(Tenant, tenant_id)

        return tenant.custom_config_dict

    @staticmethod
    def is_owner(account: Account, tenant: Tenant, *, session: Session) -> bool:
        if dify_config.RBAC_ENABLED:
            return AccountService.get_rbac_workspace_owner_account_id(str(tenant.id)) == str(account.id)
        return TenantService.get_user_role(account, tenant, session=session) == TenantAccountRole.OWNER


class RegisterService:
    @classmethod
    def _get_invitation_token_key(cls, token: str) -> str:
        return f"member_invite:{{invitation}}:token:{token}"

    @classmethod
    def _get_current_invitation_key(cls, workspace_id: str, account_id: str) -> str:
        return f"member_invite:{{invitation}}:current:{workspace_id}:{account_id}"

    @classmethod
    def _get_workspace_invitation_index_key(cls, workspace_id: str) -> str:
        return f"member_invite:{{invitation}}:workspace:{workspace_id}"

    @classmethod
    def _get_account_invitation_index_key(cls, account_id: str) -> str:
        return f"member_invite:{{invitation}}:account:{account_id}"

    @staticmethod
    def _redis_text(value: str | bytes) -> str:
        return value.decode() if isinstance(value, bytes) else value

    @classmethod
    def _current_invitation_token(cls, workspace_id: str, account_id: str) -> str | None:
        current = redis_client.get(cls._get_current_invitation_key(workspace_id, account_id))
        return cls._redis_text(current) if current else None

    @classmethod
    def is_current_invitation(cls, workspace_id: str, account_id: str, token: str) -> bool:
        return cls._current_invitation_token(workspace_id, account_id) == token

    @classmethod
    def invalidate_member_invitation(cls, workspace_id: str, account_id: str) -> None:
        token = cls._current_invitation_token(workspace_id, account_id)
        if token:
            cls._delete_current_invitation(workspace_id, account_id, token)

    @classmethod
    def _delete_current_invitation(cls, workspace_id: str, account_id: str, token: str) -> bool:
        deleted = redis_client.eval(
            """
            if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
            redis.call('DEL', KEYS[1], KEYS[2])
            redis.call('HDEL', KEYS[3], ARGV[2])
            redis.call('HDEL', KEYS[4], ARGV[3])
            return 1
            """,
            4,
            serialize_redis_name(cls._get_current_invitation_key(workspace_id, account_id)),
            serialize_redis_name(cls._get_invitation_token_key(token)),
            serialize_redis_name(cls._get_workspace_invitation_index_key(workspace_id)),
            serialize_redis_name(cls._get_account_invitation_index_key(account_id)),
            token,
            account_id,
            workspace_id,
        )
        return bool(deleted)

    @classmethod
    def _remove_index_entry_if_stale(cls, key: str, field: str, token: str) -> None:
        redis_client.eval(
            "if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] "
            "then return redis.call('HDEL', KEYS[1], ARGV[1]) end return 0",
            1,
            serialize_redis_name(key),
            field,
            token,
        )

    @classmethod
    def list_for_workspace(cls, workspace_id: str) -> tuple["WorkspaceInvitationRecord", ...]:
        from services.workspace_member_query_service import WorkspaceInvitationRecord

        index_key = cls._get_workspace_invitation_index_key(workspace_id)
        invitations = []
        for raw_account_id, raw_token in redis_client.hgetall(index_key).items():
            account_id = cls._redis_text(raw_account_id)
            token = cls._redis_text(raw_token)
            invitation = cls.get_invitation_by_token(token)
            if (
                invitation is None
                or invitation["workspace_id"] != workspace_id
                or invitation["account_id"] != account_id
            ):
                if not cls._delete_current_invitation(workspace_id, account_id, token):
                    cls._remove_index_entry_if_stale(index_key, account_id, token)
                continue
            invitations.append(
                WorkspaceInvitationRecord(
                    account_id=account_id,
                    email=invitation["email"],
                    legacy_role=invitation["role"],
                )
            )
        return tuple(invitations)

    @classmethod
    def has_other_current_invitation(cls, account_id: str, workspace_id: str) -> bool:
        index_key = cls._get_account_invitation_index_key(account_id)
        for raw_workspace_id, raw_token in redis_client.hgetall(index_key).items():
            indexed_workspace_id = cls._redis_text(raw_workspace_id)
            token = cls._redis_text(raw_token)
            if indexed_workspace_id == workspace_id:
                continue
            invitation = cls.get_invitation_by_token(token)
            if (
                invitation is not None
                and invitation["workspace_id"] == indexed_workspace_id
                and invitation["account_id"] == account_id
            ):
                return True
            if not cls._delete_current_invitation(indexed_workspace_id, account_id, token):
                cls._remove_index_entry_if_stale(index_key, indexed_workspace_id, token)
        return False

    @classmethod
    @contextmanager
    def current_invitation(
        cls,
        token: str,
        expected: InvitationData,
    ) -> Generator[bool]:
        """Serialize invitation-side effects and recheck the authoritative pointer."""
        with account_workspace_membership_mutation_lock(expected["account_id"], expected["workspace_id"]):
            with session_factory.create_session() as session:
                account = TenantService.get_membership_eligible_account(expected["account_id"], session=session)
                tenant = session.get(Tenant, expected["workspace_id"], populate_existing=True)
                context_is_current = (
                    account is not None
                    and account.email.casefold() == expected["email"].casefold()
                    and tenant is not None
                    and tenant.status == TenantStatus.NORMAL
                )
            yield context_is_current and cls.get_invitation_by_token(token) == expected

    @classmethod
    def setup(
        cls,
        email: str,
        name: str,
        password: str,
        ip_address: str,
        language: str | None,
        *,
        session: Session,
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
                ip_address=ip_address,
                session=session,
            )

            account.initialized_at = naive_utc_now()

            TenantService.create_owner_tenant_if_not_exist(account=account, is_setup=True, session=session)

            dify_setup = DifySetup(version=dify_config.project.version, instance_id=str(uuid.uuid4()))
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

        try:
            CommunityTelemetryService.report_install(session=session)
        except Exception:
            logger.debug("Failed to report install telemetry", exc_info=True)

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
        auto_join_default_workspace: bool = True,
        timezone: str | None = None,
        ip_address: str | None = None,
        *,
        session: Session,
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
                ip_address=ip_address,
                session=session,
            )
            account.status = status or AccountStatus.ACTIVE
            account.initialized_at = naive_utc_now()

            if open_id is not None and provider is not None:
                AccountService.link_account_integrate(provider, open_id, account, session=session)

            if (
                create_workspace_required
                and FeatureService.is_workspace_creation_allowed()
                and FeatureService.get_license().workspaces.is_available()
            ):
                try:
                    TenantService.create_owner_tenant(account, session=session)
                except Exception:
                    if auto_join_default_workspace:
                        _try_join_enterprise_default_workspace(str(account.id))
                    raise

            session.commit()

            if auto_join_default_workspace:
                _try_join_enterprise_default_workspace(str(account.id))
        except WorkSpaceNotAllowedCreateError:
            session.rollback()
            logger.exception("Register failed")
            raise AccountRegisterError("Workspace is not allowed to create.")
        except SeatsLimitExceededError:
            session.rollback()
            logger.exception("Register failed")
            raise
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
        tenant_id: str,
        email: str,
        language: str | None,
        role: str = "normal",
        inviter_id: str | None = None,
    ) -> str:
        if not inviter_id:
            raise ValueError("Inviter is required")

        from libs.workspace_permission import check_workspace_member_invite_permission

        check_workspace_member_invite_permission(tenant_id)
        assigned_role = role
        if dify_config.RBAC_ENABLED:
            require_tenant_members(tenant_id, [inviter_id])
            permission_keys = AccountService.get_workspace_permission_keys(tenant_id, inviter_id)
            if not {"workspace.member.manage", "workspace.role.manage"}.issubset(permission_keys):
                raise NoPermissionError("No permission to invite member with this role.")
            if TenantAccountRole.is_valid_role(role):
                assigned_role = AccountService._resolve_legacy_role_id(tenant_id, inviter_id, TenantAccountRole(role))
            RBACService.MemberRoles.ensure_role_assignable(tenant_id, inviter_id, assigned_role)

        normalized_email = email.lower()
        email_lock = _invitation_lock(
            f"account-invitation:{sha256(normalized_email.encode()).hexdigest()}",
            timeout=(2 * dify_config.ENTERPRISE_RBAC_REQUEST_TIMEOUT + dify_config.ENTERPRISE_REQUEST_TIMEOUT + 60),
        )
        with email_lock:
            created_account = False
            with session_factory.create_session() as session:
                tenant = session.get(Tenant, tenant_id)
                inviter = session.get(Account, inviter_id)
                if not tenant or not inviter:
                    raise ValueError("Workspace invitation context not found.")
                account = AccountService.get_account_by_email_with_case_fallback(email, session=session)
                if not dify_config.RBAC_ENABLED:
                    TenantService.check_member_permission(tenant, inviter, account, "add", session=session)
                account_id = str(account.id) if account else None

            if account_id is None:
                # ponytail: enterprise seat allocation is deployment-wide; keep only account creation under this lock.
                creation_lock = (
                    _invitation_lock(
                        "account-invitation:create",
                        timeout=max(60, 2 * dify_config.ENTERPRISE_REQUEST_TIMEOUT + 10),
                    )
                    if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE
                    else nullcontext()
                )
                with creation_lock:
                    with session_factory.create_session() as session:
                        account = AccountService.get_account_by_email_with_case_fallback(email, session=session)
                        account_id = str(account.id) if account else None
                    if account_id is None:
                        seats = FeatureService.get_license().seats
                        if seats.enabled and seats.limit > 0:
                            with session_factory.create_session() as session:
                                account_count = session.scalar(select(func.count(Account.id))) or 0
                            if account_count >= seats.limit:
                                raise SeatsLimitExceededError("licensed seats limit exceeded")
                        with session_factory.create_session() as session:
                            account = cls.register(
                                email=normalized_email,
                                name=normalized_email.split("@")[0],
                                language=language,
                                status=AccountStatus.PENDING,
                                is_setup=True,
                                create_workspace_required=False,
                                auto_join_default_workspace=False,
                                session=session,
                            )
                            account_id = str(account.id)
                            created_account = True

            assert account_id is not None
            token: str | None = None
            try:
                with session_factory.create_session() as session:
                    tenant = session.get(Tenant, tenant_id)
                    inviter = session.get(Account, inviter_id)
                    account = session.get(Account, account_id)
                    if not tenant or not inviter or not account:
                        raise ValueError("Workspace invitation context not found.")
                    if account.status not in (AccountStatus.PENDING, AccountStatus.ACTIVE):
                        raise AccountRegisterError("Account is not eligible for workspace invitation.")
                    if not dify_config.RBAC_ENABLED:
                        TenantService.check_member_permission(tenant, inviter, account, "add", session=session)

                    membership_exists = TenantService.account_belongs_to_tenant(
                        account.id,
                        tenant_id,
                        session=session,
                    )
                    if account.status == AccountStatus.ACTIVE and membership_exists:
                        raise AccountAlreadyInTenantError("Account already in tenant.")

                    account_language = account.interface_language or "en-US"
                    account_email = account.email
                    inviter_name = inviter.name
                    tenant_name = tenant.name

                token = cls.generate_invite_token(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    email=account_email,
                    role=role,
                    rbac_role_id=assigned_role if dify_config.RBAC_ENABLED else None,
                    inviter_id=inviter_id,
                )
                send_invite_member_mail_task.delay(
                    language=account_language,
                    to=account_email,
                    token=token,
                    inviter_name=inviter_name,
                    workspace_name=tenant_name,
                )
            except Exception:
                if token is not None:
                    cls.revoke_token(token)
                if created_account:
                    with account_membership_mutation_lock(account_id):
                        with session_factory.create_session() as session, session.begin():
                            account = session.get(Account, account_id, populate_existing=True)
                            membership_id = session.scalar(
                                select(TenantAccountJoin.id).where(TenantAccountJoin.account_id == account_id).limit(1)
                            )
                            if account and account.status == AccountStatus.PENDING and membership_id is None:
                                session.delete(account)
                raise

        assert token is not None
        return token

    @classmethod
    def generate_invite_token(
        cls,
        *,
        tenant_id: str,
        account_id: str,
        email: str,
        inviter_id: str,
        role: str = "normal",
        rbac_role_id: str | None = None,
    ) -> str:
        token = str(uuid.uuid4())
        invitation_data: InvitationData = {
            "account_id": account_id,
            "email": email,
            "workspace_id": tenant_id,
            "role": role,
            "inviter_id": inviter_id,
        }
        if rbac_role_id:
            invitation_data["rbac_role_id"] = rbac_role_id
        expiry_hours = dify_config.INVITE_EXPIRY_HOURS
        ttl = expiry_hours * 60 * 60
        with account_workspace_membership_mutation_lock(account_id, tenant_id):
            with session_factory.create_session() as session:
                account = TenantService.get_membership_eligible_account(account_id, session=session)
                tenant = session.get(Tenant, tenant_id)
                inviter = TenantService.get_membership_eligible_account(inviter_id, session=session)
                if (
                    account is None
                    or account.email.casefold() != email.casefold()
                    or tenant is None
                    or tenant.status != TenantStatus.NORMAL
                    or inviter is None
                ):
                    raise AccountRegisterError("Account is not eligible for workspace invitation.")
                if not dify_config.RBAC_ENABLED:
                    TenantService.check_member_permission(tenant, inviter, account, "add", session=session)
                membership_exists = TenantService.account_belongs_to_tenant(account_id, tenant_id, session=session)
                if account.status == AccountStatus.ACTIVE and membership_exists:
                    raise AccountAlreadyInTenantError("Account already in tenant.")
            if dify_config.RBAC_ENABLED:
                if not rbac_role_id:
                    raise AccountRegisterError("RBAC role is required for workspace invitation.")
                require_tenant_members(tenant_id, [inviter_id])
                if not {"workspace.member.manage", "workspace.role.manage"}.issubset(
                    AccountService.get_workspace_permission_keys(tenant_id, inviter_id)
                ):
                    raise NoPermissionError("No permission to invite member with this role.")
                RBACService.MemberRoles.ensure_role_assignable(tenant_id, inviter_id, rbac_role_id)
            pending_accounts = {
                invitation.account_id: invitation.email for invitation in cls.list_for_workspace(tenant_id)
            }
            pending_accounts[account_id] = email
            TenantService.ensure_member_capacity(tenant_id, pending_accounts)
            pipeline = redis_client.pipeline(transaction=True)
            old_token = cls._current_invitation_token(tenant_id, account_id)
            if old_token:
                pipeline.delete(serialize_redis_name(cls._get_invitation_token_key(old_token)))
            pipeline.setex(serialize_redis_name(cls._get_invitation_token_key(token)), ttl, json.dumps(invitation_data))
            pipeline.setex(serialize_redis_name(cls._get_current_invitation_key(tenant_id, account_id)), ttl, token)
            workspace_index_key = serialize_redis_name(cls._get_workspace_invitation_index_key(tenant_id))
            account_index_key = serialize_redis_name(cls._get_account_invitation_index_key(account_id))
            pipeline.hset(workspace_index_key, account_id, token)
            pipeline.expire(workspace_index_key, ttl)
            pipeline.hset(account_index_key, tenant_id, token)
            pipeline.expire(account_index_key, ttl)
            pipeline.execute()
        return token

    @classmethod
    def revoke_token(cls, token: str) -> None:
        data = redis_client.get(cls._get_invitation_token_key(token))
        if not data:
            return
        try:
            invitation = _invitation_adapter.validate_json(data)
        except ValidationError:
            redis_client.delete(cls._get_invitation_token_key(token))
            return
        if not cls._delete_current_invitation(invitation["workspace_id"], invitation["account_id"], token):
            redis_client.delete(cls._get_invitation_token_key(token))

    @classmethod
    def get_invitation_if_token_valid(
        cls, workspace_id: str | None, email: str | None, token: str, *, session: Session
    ) -> InvitationDetailDict | None:
        invitation_data = cls.get_invitation_by_token(token)
        if not invitation_data:
            return None
        if workspace_id is not None and invitation_data["workspace_id"] != workspace_id:
            return None
        if email is not None and invitation_data["email"].casefold() != email.casefold():
            return None

        tenant = session.scalar(
            select(Tenant).where(Tenant.id == invitation_data["workspace_id"], Tenant.status == "normal").limit(1)
        )

        if not tenant:
            return None

        account = session.scalar(select(Account).where(Account.email == invitation_data["email"]).limit(1))
        if not account or account.status not in (AccountStatus.PENDING, AccountStatus.ACTIVE):
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
        cls,
        token: str,
    ) -> InvitationData | None:
        data = redis_client.get(cls._get_invitation_token_key(token))
        if not data:
            return None

        try:
            invitation = _invitation_adapter.validate_json(data)
        except ValidationError:
            return None
        if not cls.is_current_invitation(invitation["workspace_id"], invitation["account_id"], token):
            return None
        return invitation


def _generate_refresh_token(length: int = 64):
    token = secrets.token_hex(length)
    return token
