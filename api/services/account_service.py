import base64
import json
import logging
import random
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any, Optional, cast

from pydantic import BaseModel
from sqlalchemy import func
from werkzeug.exceptions import Unauthorized

from configs import dify_config
from constants.languages import language_timezone_mapping, languages
from events.tenant_event import tenant_was_created
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.helper import RateLimiter, TokenManager
from libs.passport import PassportService
from libs.password import compare_password, hash_password, valid_password
from libs.rsa import generate_key_pair
from models.account import (
    Account,
    AccountIntegrate,
    AccountStatus,
    Tenant,
    TenantAccountJoin,
    TenantAccountJoinRole,
    TenantAccountRole,
    TenantStatus,
)
from models.model import DifySetup
from services.billing_service import BillingService
from services.errors.account import (
    AccountAlreadyInTenantError,
    AccountLoginError,
    AccountNotFoundError,
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
from services.errors.workspace import WorkSpaceNotAllowedCreateError
from services.feature_service import FeatureService
from tasks.delete_account_task import delete_account_task
from tasks.mail_account_deletion_task import send_account_deletion_verification_code
from tasks.mail_email_code_login import send_email_code_login_mail_task
from tasks.mail_invite_member_task import send_invite_member_mail_task
from tasks.mail_reset_password_task import send_reset_password_mail_task


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str


REFRESH_TOKEN_PREFIX = "refresh_token:"
ACCOUNT_REFRESH_TOKEN_PREFIX = "account_refresh_token:"
REFRESH_TOKEN_EXPIRY = timedelta(days=dify_config.REFRESH_TOKEN_EXPIRE_DAYS)


class AccountService:
    reset_password_rate_limiter = RateLimiter(prefix="reset_password_rate_limit", max_attempts=1, time_window=60 * 1)
    email_code_login_rate_limiter = RateLimiter(
        prefix="email_code_login_rate_limit", max_attempts=1, time_window=60 * 1
    )
    email_code_account_deletion_rate_limiter = RateLimiter(
        prefix="email_code_account_deletion_rate_limit", max_attempts=1, time_window=60 * 1
    )
    LOGIN_MAX_ERROR_LIMITS = 5

    @staticmethod
    def _get_refresh_token_key(refresh_token: str) -> str:
        return f"{REFRESH_TOKEN_PREFIX}{refresh_token}"

    @staticmethod
    def _get_account_refresh_token_key(account_id: str) -> str:
        return f"{ACCOUNT_REFRESH_TOKEN_PREFIX}{account_id}"

    @staticmethod
    def _store_refresh_token(refresh_token: str, account_id: str) -> None:
        redis_client.setex(AccountService._get_refresh_token_key(refresh_token), REFRESH_TOKEN_EXPIRY, account_id)
        redis_client.setex(
            AccountService._get_account_refresh_token_key(account_id), REFRESH_TOKEN_EXPIRY, refresh_token
        )

    @staticmethod
    def _delete_refresh_token(refresh_token: str, account_id: str) -> None:
        redis_client.delete(AccountService._get_refresh_token_key(refresh_token))
        redis_client.delete(AccountService._get_account_refresh_token_key(account_id))

    @staticmethod
    def load_user(user_id: str) -> None | Account:
        account = Account.query.filter_by(id=user_id).first()
        if not account:
            return None

        if account.status == AccountStatus.BANNED.value:
            raise Unauthorized("Account is banned.")

        current_tenant = TenantAccountJoin.query.filter_by(account_id=account.id, current=True).first()
        if current_tenant:
            account.current_tenant_id = current_tenant.tenant_id
        else:
            available_ta = (
                TenantAccountJoin.query.filter_by(account_id=account.id).order_by(TenantAccountJoin.id.asc()).first()
            )
            if not available_ta:
                return None

            account.current_tenant_id = available_ta.tenant_id
            available_ta.current = True
            db.session.commit()

        if datetime.now(UTC).replace(tzinfo=None) - account.last_active_at > timedelta(minutes=10):
            account.last_active_at = datetime.now(UTC).replace(tzinfo=None)
            db.session.commit()

        return cast(Account, account)

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
    def authenticate(email: str, password: str, invite_token: Optional[str] = None) -> Account:
        """authenticate account with email and password"""

        account = Account.query.filter_by(email=email).first()
        if not account:
            raise AccountNotFoundError()

        if account.status == AccountStatus.BANNED.value:
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

        if account.status == AccountStatus.PENDING.value:
            account.status = AccountStatus.ACTIVE.value
            account.initialized_at = datetime.now(UTC).replace(tzinfo=None)

        db.session.commit()

        return cast(Account, account)

    @staticmethod
    def update_account_password(account, password, new_password):
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
        db.session.commit()
        return account

    @staticmethod
    def create_account(
        email: str,
        name: str,
        interface_language: str,
        password: Optional[str] = None,
        interface_theme: str = "light",
        is_setup: Optional[bool] = False,
    ) -> Account:
        """create account"""
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

        account = Account()
        account.email = email
        account.name = name

        if password:
            # generate password salt
            salt = secrets.token_bytes(16)
            base64_salt = base64.b64encode(salt).decode()

            # encrypt password with salt
            password_hashed = hash_password(password, salt)
            base64_password_hashed = base64.b64encode(password_hashed).decode()

            account.password = base64_password_hashed
            account.password_salt = base64_salt

        account.interface_language = interface_language
        account.interface_theme = interface_theme

        # Set timezone based on language
        account.timezone = language_timezone_mapping.get(interface_language, "UTC")

        db.session.add(account)
        db.session.commit()
        return account

    @staticmethod
    def create_account_and_tenant(
        email: str, name: str, interface_language: str, password: Optional[str] = None
    ) -> Account:
        """create account"""
        account = AccountService.create_account(
            email=email, name=name, interface_language=interface_language, password=password
        )

        TenantService.create_owner_tenant_if_not_exist(account=account)

        return account

    @staticmethod
    def generate_account_deletion_verification_code(account: Account) -> tuple[str, str]:
        code = "".join([str(random.randint(0, 9)) for _ in range(6)])
        token = TokenManager.generate_token(
            account=account, token_type="account_deletion", additional_data={"code": code}
        )
        return token, code

    @classmethod
    def send_account_deletion_verification_email(cls, account: Account, code: str):
        email = account.email
        if cls.email_code_account_deletion_rate_limiter.is_rate_limited(email):
            from controllers.console.auth.error import EmailCodeAccountDeletionRateLimitExceededError

            raise EmailCodeAccountDeletionRateLimitExceededError()

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
    def delete_account(account: Account) -> None:
        """Delete account. This method only adds a task to the queue for deletion."""
        delete_account_task.delay(account.id)

    @staticmethod
    def link_account_integrate(provider: str, open_id: str, account: Account) -> None:
        """Link account integrate"""
        try:
            # Query whether there is an existing binding record for the same provider
            account_integrate: Optional[AccountIntegrate] = AccountIntegrate.query.filter_by(
                account_id=account.id, provider=provider
            ).first()

            if account_integrate:
                # If it exists, update the record
                account_integrate.open_id = open_id
                account_integrate.encrypted_token = ""  # todo
                account_integrate.updated_at = datetime.now(UTC).replace(tzinfo=None)
            else:
                # If it does not exist, create a new record
                account_integrate = AccountIntegrate(
                    account_id=account.id, provider=provider, open_id=open_id, encrypted_token=""
                )
                db.session.add(account_integrate)

            db.session.commit()
            logging.info(f"Account {account.id} linked {provider} account {open_id}.")
        except Exception as e:
            logging.exception(f"Failed to link {provider} account {open_id} to Account {account.id}")
            raise LinkAccountIntegrateError("Failed to link account.") from e

    @staticmethod
    def close_account(account: Account) -> None:
        """Close account"""
        account.status = AccountStatus.CLOSED.value
        db.session.commit()

    @staticmethod
    def update_account(account, **kwargs):
        """Update account fields"""
        for field, value in kwargs.items():
            if hasattr(account, field):
                setattr(account, field, value)
            else:
                raise AttributeError(f"Invalid field: {field}")

        db.session.commit()
        return account

    @staticmethod
    def update_login_info(account: Account, *, ip_address: str) -> None:
        """Update last login time and ip"""
        account.last_login_at = datetime.now(UTC).replace(tzinfo=None)
        account.last_login_ip = ip_address
        db.session.add(account)
        db.session.commit()

    @staticmethod
    def login(account: Account, *, ip_address: Optional[str] = None) -> TokenPair:
        if ip_address:
            AccountService.update_login_info(account=account, ip_address=ip_address)

        if account.status == AccountStatus.PENDING.value:
            account.status = AccountStatus.ACTIVE.value
            db.session.commit()

        access_token = AccountService.get_account_jwt_token(account=account)
        refresh_token = _generate_refresh_token()

        AccountService._store_refresh_token(refresh_token, account.id)

        return TokenPair(access_token=access_token, refresh_token=refresh_token)

    @staticmethod
    def logout(*, account: Account) -> None:
        refresh_token = redis_client.get(AccountService._get_account_refresh_token_key(account.id))
        if refresh_token:
            AccountService._delete_refresh_token(refresh_token.decode("utf-8"), account.id)

    @staticmethod
    def refresh_token(refresh_token: str) -> TokenPair:
        # Verify the refresh token
        account_id = redis_client.get(AccountService._get_refresh_token_key(refresh_token))
        if not account_id:
            raise ValueError("Invalid refresh token")

        account = AccountService.load_user(account_id.decode("utf-8"))
        if not account:
            raise ValueError("Invalid account")

        # Generate new access token and refresh token
        new_access_token = AccountService.get_account_jwt_token(account)
        new_refresh_token = _generate_refresh_token()

        AccountService._delete_refresh_token(refresh_token, account.id)
        AccountService._store_refresh_token(new_refresh_token, account.id)

        return TokenPair(access_token=new_access_token, refresh_token=new_refresh_token)

    @staticmethod
    def load_logged_in_account(*, account_id: str):
        return AccountService.load_user(account_id)

    @classmethod
    def send_reset_password_email(
        cls,
        account: Optional[Account] = None,
        email: Optional[str] = None,
        language: Optional[str] = "en-US",
    ):
        account_email = account.email if account else email
        if account_email is None:
            raise ValueError("Email must be provided.")

        if cls.reset_password_rate_limiter.is_rate_limited(account_email):
            from controllers.console.auth.error import PasswordResetRateLimitExceededError

            raise PasswordResetRateLimitExceededError()

        code = "".join([str(random.randint(0, 9)) for _ in range(6)])
        token = TokenManager.generate_token(
            account=account, email=email, token_type="reset_password", additional_data={"code": code}
        )
        send_reset_password_mail_task.delay(
            language=language,
            to=account_email,
            code=code,
        )
        cls.reset_password_rate_limiter.increment_rate_limit(account_email)
        return token

    @classmethod
    def revoke_reset_password_token(cls, token: str):
        TokenManager.revoke_token(token, "reset_password")

    @classmethod
    def get_reset_password_data(cls, token: str) -> Optional[dict[str, Any]]:
        return TokenManager.get_token_data(token, "reset_password")

    @classmethod
    def send_email_code_login_email(
        cls, account: Optional[Account] = None, email: Optional[str] = None, language: Optional[str] = "en-US"
    ):
        email = account.email if account else email
        if email is None:
            raise ValueError("Email must be provided.")
        if cls.email_code_login_rate_limiter.is_rate_limited(email):
            from controllers.console.auth.error import EmailCodeLoginRateLimitExceededError

            raise EmailCodeLoginRateLimitExceededError()

        code = "".join([str(random.randint(0, 9)) for _ in range(6)])
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

    @classmethod
    def get_email_code_login_data(cls, token: str) -> Optional[dict[str, Any]]:
        return TokenManager.get_token_data(token, "email_code_login")

    @classmethod
    def revoke_email_code_login_token(cls, token: str):
        TokenManager.revoke_token(token, "email_code_login")

    @classmethod
    def get_user_through_email(cls, email: str):
        if dify_config.BILLING_ENABLED and BillingService.is_email_in_freeze(email):
            raise AccountRegisterError(
                description=(
                    "This email account has been deleted within the past "
                    "30 days and is temporarily unavailable for new account registration"
                )
            )

        account = db.session.query(Account).filter(Account.email == email).first()
        if not account:
            return None

        if account.status == AccountStatus.BANNED.value:
            raise Unauthorized("Account is banned.")

        return account

    @staticmethod
    def add_login_error_rate_limit(email: str) -> None:
        key = f"login_error_rate_limit:{email}"
        count = redis_client.get(key)
        if count is None:
            count = 0
        count = int(count) + 1
        redis_client.setex(key, dify_config.LOGIN_LOCKOUT_DURATION, count)

    @staticmethod
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
    def reset_login_error_rate_limit(email: str):
        key = f"login_error_rate_limit:{email}"
        redis_client.delete(key)

    @staticmethod
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


def _get_login_cache_key(*, account_id: str, token: str):
    return f"account_login:{account_id}:{token}"


class TenantService:
    @staticmethod
    def create_tenant(name: str, is_setup: Optional[bool] = False, is_from_dashboard: Optional[bool] = False) -> Tenant:
        """Create tenant"""
        if (
            not FeatureService.get_system_features().is_allow_create_workspace
            and not is_setup
            and not is_from_dashboard
        ):
            from controllers.console.error import NotAllowedCreateWorkspace

            raise NotAllowedCreateWorkspace()
        tenant = Tenant(name=name)

        db.session.add(tenant)
        db.session.commit()

        tenant.encrypt_public_key = generate_key_pair(tenant.id)
        db.session.commit()
        return tenant

    @staticmethod
    def create_owner_tenant_if_not_exist(
        account: Account, name: Optional[str] = None, is_setup: Optional[bool] = False
    ):
        """Check if user have a workspace or not"""
        available_ta = (
            TenantAccountJoin.query.filter_by(account_id=account.id).order_by(TenantAccountJoin.id.asc()).first()
        )

        if available_ta:
            return

        """Create owner tenant if not exist"""
        if not FeatureService.get_system_features().is_allow_create_workspace and not is_setup:
            raise WorkSpaceNotAllowedCreateError()

        if name:
            tenant = TenantService.create_tenant(name=name, is_setup=is_setup)
        else:
            tenant = TenantService.create_tenant(name=f"{account.name}'s Workspace", is_setup=is_setup)
        TenantService.create_tenant_member(tenant, account, role="owner")
        account.current_tenant = tenant
        db.session.commit()
        tenant_was_created.send(tenant)

    @staticmethod
    def create_tenant_member(tenant: Tenant, account: Account, role: str = "normal") -> TenantAccountJoin:
        """Create tenant member"""
        if role == TenantAccountJoinRole.OWNER.value:
            if TenantService.has_roles(tenant, [TenantAccountJoinRole.OWNER]):
                logging.error(f"Tenant {tenant.id} has already an owner.")
                raise Exception("Tenant already has an owner.")

        ta = db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id, account_id=account.id).first()
        if ta:
            ta.role = role
        else:
            ta = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=role)
            db.session.add(ta)

        db.session.commit()
        return ta

    @staticmethod
    def get_join_tenants(account: Account) -> list[Tenant]:
        """Get account join tenants"""
        return (
            db.session.query(Tenant)
            .join(TenantAccountJoin, Tenant.id == TenantAccountJoin.tenant_id)
            .filter(TenantAccountJoin.account_id == account.id, Tenant.status == TenantStatus.NORMAL)
            .all()
        )

    @staticmethod
    def get_current_tenant_by_account(account: Account):
        """Get tenant by account and add the role"""
        tenant = account.current_tenant
        if not tenant:
            raise TenantNotFoundError("Tenant not found.")

        ta = TenantAccountJoin.query.filter_by(tenant_id=tenant.id, account_id=account.id).first()
        if ta:
            tenant.role = ta.role
        else:
            raise TenantNotFoundError("Tenant not found for the account.")
        return tenant

    @staticmethod
    def switch_tenant(account: Account, tenant_id: Optional[str] = None) -> None:
        """Switch the current workspace for the account"""

        # Ensure tenant_id is provided
        if tenant_id is None:
            raise ValueError("Tenant ID must be provided.")

        tenant_account_join = (
            db.session.query(TenantAccountJoin)
            .join(Tenant, TenantAccountJoin.tenant_id == Tenant.id)
            .filter(
                TenantAccountJoin.account_id == account.id,
                TenantAccountJoin.tenant_id == tenant_id,
                Tenant.status == TenantStatus.NORMAL,
            )
            .first()
        )

        if not tenant_account_join:
            raise AccountNotLinkTenantError("Tenant not found or account is not a member of the tenant.")
        else:
            TenantAccountJoin.query.filter(
                TenantAccountJoin.account_id == account.id, TenantAccountJoin.tenant_id != tenant_id
            ).update({"current": False})
            tenant_account_join.current = True
            # Set the current tenant for the account
            account.current_tenant_id = tenant_account_join.tenant_id
            db.session.commit()

    @staticmethod
    def get_tenant_members(tenant: Tenant) -> list[Account]:
        """Get tenant members"""
        query = (
            db.session.query(Account, TenantAccountJoin.role)
            .select_from(Account)
            .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
            .filter(TenantAccountJoin.tenant_id == tenant.id)
        )

        # Initialize an empty list to store the updated accounts
        updated_accounts = []

        for account, role in query:
            account.role = role
            updated_accounts.append(account)

        return updated_accounts

    @staticmethod
    def get_dataset_operator_members(tenant: Tenant) -> list[Account]:
        """Get dataset admin members"""
        query = (
            db.session.query(Account, TenantAccountJoin.role)
            .select_from(Account)
            .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
            .filter(TenantAccountJoin.tenant_id == tenant.id)
            .filter(TenantAccountJoin.role == "dataset_operator")
        )

        # Initialize an empty list to store the updated accounts
        updated_accounts = []

        for account, role in query:
            account.role = role
            updated_accounts.append(account)

        return updated_accounts

    @staticmethod
    def has_roles(tenant: Tenant, roles: list[TenantAccountJoinRole]) -> bool:
        """Check if user has any of the given roles for a tenant"""
        if not all(isinstance(role, TenantAccountJoinRole) for role in roles):
            raise ValueError("all roles must be TenantAccountJoinRole")

        return (
            db.session.query(TenantAccountJoin)
            .filter(
                TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.role.in_([role.value for role in roles])
            )
            .first()
            is not None
        )

    @staticmethod
    def get_user_role(account: Account, tenant: Tenant) -> Optional[TenantAccountJoinRole]:
        """Get the role of the current account for a given tenant"""
        join = (
            db.session.query(TenantAccountJoin)
            .filter(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == account.id)
            .first()
        )
        return join.role if join else None

    @staticmethod
    def get_tenant_count() -> int:
        """Get tenant count"""
        return cast(int, db.session.query(func.count(Tenant.id)).scalar())

    @staticmethod
    def check_member_permission(tenant: Tenant, operator: Account, member: Account | None, action: str) -> None:
        """Check member permission"""
        perms = {
            "add": [TenantAccountRole.OWNER, TenantAccountRole.ADMIN],
            "remove": [TenantAccountRole.OWNER],
            "update": [TenantAccountRole.OWNER],
        }
        if action not in {"add", "remove", "update"}:
            raise InvalidActionError("Invalid action.")

        if member:
            if operator.id == member.id:
                raise CannotOperateSelfError("Cannot operate self.")

        ta_operator = TenantAccountJoin.query.filter_by(tenant_id=tenant.id, account_id=operator.id).first()

        if not ta_operator or ta_operator.role not in perms[action]:
            raise NoPermissionError(f"No permission to {action} member.")

    @staticmethod
    def remove_member_from_tenant(tenant: Tenant, account: Account, operator: Account) -> None:
        """Remove member from tenant"""
        if operator.id == account.id and TenantService.check_member_permission(tenant, operator, account, "remove"):
            raise CannotOperateSelfError("Cannot operate self.")

        ta = TenantAccountJoin.query.filter_by(tenant_id=tenant.id, account_id=account.id).first()
        if not ta:
            raise MemberNotInTenantError("Member not in tenant.")

        db.session.delete(ta)
        db.session.commit()

    @staticmethod
    def update_member_role(tenant: Tenant, member: Account, new_role: str, operator: Account) -> None:
        """Update member role"""
        TenantService.check_member_permission(tenant, operator, member, "update")

        target_member_join = TenantAccountJoin.query.filter_by(tenant_id=tenant.id, account_id=member.id).first()

        if target_member_join.role == new_role:
            raise RoleAlreadyAssignedError("The provided role is already assigned to the member.")

        if new_role == "owner":
            # Find the current owner and change their role to 'admin'
            current_owner_join = TenantAccountJoin.query.filter_by(tenant_id=tenant.id, role="owner").first()
            current_owner_join.role = "admin"

        # Update the role of the target member
        target_member_join.role = new_role
        db.session.commit()

    @staticmethod
    def dissolve_tenant(tenant: Tenant, operator: Account) -> None:
        """Dissolve tenant"""
        if not TenantService.check_member_permission(tenant, operator, operator, "remove"):
            raise NoPermissionError("No permission to dissolve tenant.")
        db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id).delete()
        db.session.delete(tenant)
        db.session.commit()

    @staticmethod
    def get_custom_config(tenant_id: str) -> dict:
        tenant = Tenant.query.filter(Tenant.id == tenant_id).one_or_404()

        return cast(dict, tenant.custom_config_dict)


class RegisterService:
    @classmethod
    def _get_invitation_token_key(cls, token: str) -> str:
        return f"member_invite:token:{token}"

    @classmethod
    def setup(cls, email: str, name: str, password: str, ip_address: str) -> None:
        """
        Setup dify

        :param email: email
        :param name: username
        :param password: password
        :param ip_address: ip address
        """
        try:
            # Register
            account = AccountService.create_account(
                email=email,
                name=name,
                interface_language=languages[0],
                password=password,
                is_setup=True,
            )

            account.last_login_ip = ip_address
            account.initialized_at = datetime.now(UTC).replace(tzinfo=None)

            TenantService.create_owner_tenant_if_not_exist(account=account, is_setup=True)

            dify_setup = DifySetup(version=dify_config.CURRENT_VERSION)
            db.session.add(dify_setup)
            db.session.commit()
        except Exception as e:
            db.session.query(DifySetup).delete()
            db.session.query(TenantAccountJoin).delete()
            db.session.query(Account).delete()
            db.session.query(Tenant).delete()
            db.session.commit()

            logging.exception(f"Setup account failed, email: {email}, name: {name}")
            raise ValueError(f"Setup failed: {e}")

    @classmethod
    def register(
        cls,
        email,
        name,
        password: Optional[str] = None,
        open_id: Optional[str] = None,
        provider: Optional[str] = None,
        language: Optional[str] = None,
        status: Optional[AccountStatus] = None,
        is_setup: Optional[bool] = False,
        create_workspace_required: Optional[bool] = True,
    ) -> Account:
        db.session.begin_nested()
        """Register account"""
        try:
            account = AccountService.create_account(
                email=email,
                name=name,
                interface_language=language or languages[0],
                password=password,
                is_setup=is_setup,
            )
            account.status = AccountStatus.ACTIVE.value if not status else status.value
            account.initialized_at = datetime.now(UTC).replace(tzinfo=None)

            if open_id is not None and provider is not None:
                AccountService.link_account_integrate(provider, open_id, account)

            if FeatureService.get_system_features().is_allow_create_workspace and create_workspace_required:
                tenant = TenantService.create_tenant(f"{account.name}'s Workspace")
                TenantService.create_tenant_member(tenant, account, role="owner")
                account.current_tenant = tenant
                tenant_was_created.send(tenant)

            db.session.commit()
        except WorkSpaceNotAllowedCreateError:
            db.session.rollback()
        except AccountRegisterError as are:
            db.session.rollback()
            logging.exception("Register failed")
            raise are
        except Exception as e:
            db.session.rollback()
            logging.exception("Register failed")
            raise AccountRegisterError(f"Registration failed: {e}") from e

        return account

    @classmethod
    def invite_new_member(
        cls, tenant: Tenant, email: str, language: str, role: str = "normal", inviter: Optional[Account] = None
    ) -> str:
        """Invite new member"""
        account = Account.query.filter_by(email=email).first()
        assert inviter is not None, "Inviter must be provided."

        if not account:
            TenantService.check_member_permission(tenant, inviter, None, "add")
            name = email.split("@")[0]

            account = cls.register(
                email=email, name=name, language=language, status=AccountStatus.PENDING, is_setup=True
            )
            # Create new tenant member for invited tenant
            TenantService.create_tenant_member(tenant, account, role)
            TenantService.switch_tenant(account, tenant.id)
        else:
            TenantService.check_member_permission(tenant, inviter, account, "add")
            ta = TenantAccountJoin.query.filter_by(tenant_id=tenant.id, account_id=account.id).first()

            if not ta:
                TenantService.create_tenant_member(tenant, account, role)

            # Support resend invitation email when the account is pending status
            if account.status != AccountStatus.PENDING.value:
                raise AccountAlreadyInTenantError("Account already in tenant.")

        token = cls.generate_invite_token(tenant, account)

        # send email
        send_invite_member_mail_task.delay(
            language=account.interface_language,
            to=email,
            token=token,
            inviter_name=inviter.name if inviter else "Dify",
            workspace_name=tenant.name,
        )

        return token

    @classmethod
    def generate_invite_token(cls, tenant: Tenant, account: Account) -> str:
        token = str(uuid.uuid4())
        invitation_data = {
            "account_id": account.id,
            "email": account.email,
            "workspace_id": tenant.id,
        }
        expiry_hours = dify_config.INVITE_EXPIRY_HOURS
        redis_client.setex(cls._get_invitation_token_key(token), expiry_hours * 60 * 60, json.dumps(invitation_data))
        return token

    @classmethod
    def is_valid_invite_token(cls, token: str) -> bool:
        data = redis_client.get(cls._get_invitation_token_key(token))
        return data is not None

    @classmethod
    def revoke_token(cls, workspace_id: str, email: str, token: str):
        if workspace_id and email:
            email_hash = sha256(email.encode()).hexdigest()
            cache_key = "member_invite_token:{}, {}:{}".format(workspace_id, email_hash, token)
            redis_client.delete(cache_key)
        else:
            redis_client.delete(cls._get_invitation_token_key(token))

    @classmethod
    def get_invitation_if_token_valid(
        cls, workspace_id: Optional[str], email: str, token: str
    ) -> Optional[dict[str, Any]]:
        invitation_data = cls._get_invitation_by_token(token, workspace_id, email)
        if not invitation_data:
            return None

        tenant = (
            db.session.query(Tenant)
            .filter(Tenant.id == invitation_data["workspace_id"], Tenant.status == "normal")
            .first()
        )

        if not tenant:
            return None

        tenant_account = (
            db.session.query(Account, TenantAccountJoin.role)
            .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
            .filter(Account.email == invitation_data["email"], TenantAccountJoin.tenant_id == tenant.id)
            .first()
        )

        if not tenant_account:
            return None

        account = tenant_account[0]
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
    def _get_invitation_by_token(
        cls, token: str, workspace_id: Optional[str] = None, email: Optional[str] = None
    ) -> Optional[dict[str, str]]:
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

            invitation: dict = json.loads(data)
            return invitation


def _generate_refresh_token(length: int = 64):
    token = secrets.token_hex(length)
    return token
