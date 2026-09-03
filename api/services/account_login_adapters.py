"""Infrastructure adapters for the Console authentication application service."""

import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import override

from redis import RedisError
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from enums import DeploymentEdition
from events.tenant_event import tenant_was_created
from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from libs.helper import RateLimiter, TokenManager
from libs.key_providers import generate_key_pair
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models import TenantCreditPool
from models.account import (
    Account,
    AccountStatus,
    Tenant,
    TenantAccountJoin,
    TenantAccountRole,
    TenantPluginAutoUpgradeCategory,
    TenantPluginAutoUpgradeMode,
    TenantPluginAutoUpgradeStrategy,
    TenantStatus,
)
from models.enums import ProviderQuotaType
from services import account_errors
from services.account_activation_service import AccountActivationRepository, InvitationTokenStore
from services.account_email import normalize_email
from services.account_login_service import (
    AccountProvisioningGateway,
    AccountRefreshPreparationGateway,
    AccountSessionGateway,
    ConsoleAuthAuditGateway,
    ConsoleAuthInvitationGateway,
    ConsoleAuthPolicyGateway,
    ConsoleAuthSecurityGateway,
    EmailCodeGateway,
    HumanVerificationGateway,
    ResetPasswordEmailGateway,
    WorkspaceProvisioningGateway,
)
from services.billing_service import BillingService
from services.email_code_login_challenge import EmailCodeLoginChallengeStore, EmailCodeLoginChallengeUnavailableError
from services.enterprise.rbac_service import ListOption, RBACService
from services.entities.account_activation_entities import InvitationLookup
from services.entities.account_login_entities import (
    AuthTokenPair,
    EmailCodeChallengeStatus,
    LoginInvitation,
    RefreshAccountStatus,
)
from services.entities.auth_audit_entities import LoginFailureReason
from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService
from services.system_feature_service import SystemFeatureService
from services.turnstile_service import (
    EMAIL_CODE_SEND_ACTION,
    EMAIL_CODE_VERIFY_ACTION,
    TurnstileChallengeRejectedError,
    TurnstileService,
    TurnstileUpstreamError,
)
from tasks.mail_email_code_login import send_email_code_login_mail_task
from tasks.mail_reset_password_task import (
    send_reset_password_mail_task,
    send_reset_password_mail_task_when_account_not_exist,
)

logger = logging.getLogger(__name__)

_ACCOUNT_LAST_ACTIVE_REFRESH_INTERVAL = timedelta(minutes=10)
_ACCOUNT_REFRESH_TOKEN_PREFIX = "account_refresh_token:"
_EMAIL_CODE_LOGIN_RATE_LIMIT_ATTEMPTS = 3
_EMAIL_CODE_LOGIN_RATE_LIMIT_SECONDS = 5 * 60
_LOGIN_FAILURE_LIMIT = 5
_LOGIN_FAILURE_PREFIX = "login_error_rate_limit:"
_REFRESH_TOKEN_PREFIX = "refresh_token:"
_RESET_PASSWORD_RATE_LIMIT_ATTEMPTS = 1
_RESET_PASSWORD_RATE_LIMIT_SECONDS = 60


class AccountActivationConsoleAuthInvitationGateway(ConsoleAuthInvitationGateway):
    """Resolve login invitations through the shared activation contracts."""

    def __init__(self, *, tokens: InvitationTokenStore, accounts: AccountActivationRepository) -> None:
        self._tokens = tokens
        self._accounts = accounts

    @override
    def resolve(self, *, email: str, token: str) -> LoginInvitation | None:
        candidate_emails = (email,) if email == email.lower() else (email, email.lower())
        for candidate_email in candidate_emails:
            invitation_token = self._tokens.find(
                InvitationLookup(workspace_id=None, email=candidate_email, token=token)
            )
            if invitation_token is None:
                continue
            invitation = self._accounts.resolve(invitation_token)
            if invitation is not None:
                return LoginInvitation(email=invitation.account_email)
        return None


class DeploymentConsoleAuthPolicyGateway(ConsoleAuthPolicyGateway):
    def __init__(self, *, billing_enabled: bool) -> None:
        self._billing_enabled = billing_enabled

    @override
    def get_email_freeze_type(self, email: str) -> str | None:
        if not self._billing_enabled:
            return None
        return BillingService.get_email_freeze_type(email)

    @override
    def is_registration_allowed(self) -> bool:
        return SystemFeatureService.is_registration_allowed()

    @override
    def is_workspace_creation_allowed(self) -> bool:
        return SystemFeatureService.is_workspace_creation_allowed()

    @override
    def has_workspace_capacity(self) -> bool:
        return SystemFeatureService.get_license().workspaces.is_available()

    @override
    def has_account_capacity(self) -> bool:
        return SystemFeatureService.get_license().seats.is_available()


class RedisConsoleAuthSecurityGateway(ConsoleAuthSecurityGateway):
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis

    @override
    def is_login_limited(self, email: str) -> bool:
        try:
            count = self._redis.get(f"{_LOGIN_FAILURE_PREFIX}{email}")
            return count is not None and int(count) > _LOGIN_FAILURE_LIMIT
        except RedisError:
            return False

    @override
    def record_login_failure(self, email: str) -> None:
        try:
            key = f"{_LOGIN_FAILURE_PREFIX}{email}"
            count = int(self._redis.get(key) or 0) + 1
            self._redis.setex(key, dify_config.LOGIN_LOCKOUT_DURATION, count)
        except RedisError:
            return None

    @override
    def reset_login_failures(self, email: str) -> None:
        try:
            self._redis.delete(f"{_LOGIN_FAILURE_PREFIX}{email}")
        except RedisError:
            return None

    @override
    def is_email_send_ip_limited(self, ip_address: str) -> bool:
        minute_key = f"email_send_ip_limit_minute:{ip_address}"
        freeze_key = f"email_send_ip_limit_freeze:{ip_address}"
        hour_limit_key = f"email_send_ip_limit_hour:{ip_address}"
        try:
            if self._redis.get(freeze_key):
                return True

            current_minute_count = int(self._redis.get(minute_key) or 0)
            if current_minute_count > dify_config.EMAIL_SEND_IP_LIMIT_PER_MINUTE:
                hour_limit_count = int(self._redis.get(hour_limit_key) or 0)
                if hour_limit_count >= 1:
                    self._redis.setex(freeze_key, 60 * 60, 1)
                    return True
                if not self._redis.set(hour_limit_key, 1, ex=60 * 10, nx=True):
                    self._redis.setex(freeze_key, 60 * 60, 1)
                return True

            self._redis.setex(minute_key, 60, current_minute_count + 1)
            self._redis.expire(minute_key, 60)
            return False
        except RedisError:
            return False


class TurnstileHumanVerificationGateway(HumanVerificationGateway):
    @override
    def verify(self, *, token: str | None, remote_ip: str, action: str) -> None:
        is_email_code_verification = action == "signin_code_verify"
        expected_action = EMAIL_CODE_VERIFY_ACTION if is_email_code_verification else EMAIL_CODE_SEND_ACTION
        try:
            TurnstileService.verify(token=token, remote_ip=remote_ip, expected_action=expected_action)
        except TurnstileChallengeRejectedError as error:
            if is_email_code_verification:
                logger.info("Turnstile rejected an email-code verification challenge")
            else:
                logger.info("Turnstile rejected an email-code login challenge")
            raise account_errors.HumanVerificationRejectedError from error
        except TurnstileUpstreamError as error:
            logger.warning("Turnstile verification is unavailable", exc_info=True)
            raise account_errors.HumanVerificationUnavailableError from error


class RedisAccountSessionGateway(AccountSessionGateway):
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis

    @override
    def issue(self, account_id: str) -> AuthTokenPair:
        return self._issue(account_id)

    @override
    def revoke(self, account_id: str) -> None:
        refresh_token = self._redis.get(self._account_refresh_token_key(account_id))
        if refresh_token:
            self._delete_refresh_token(refresh_token.decode("utf-8"), account_id)

    @override
    def resolve_refresh_token(self, refresh_token: str) -> str | None:
        account_id = self._redis.get(self._refresh_token_key(refresh_token))
        return account_id.decode("utf-8") if account_id else None

    @override
    def rotate(self, *, refresh_token: str, account_id: str) -> AuthTokenPair:
        self._delete_refresh_token(refresh_token, account_id)
        return self._issue(account_id)

    def _issue(self, account_id: str) -> AuthTokenPair:
        expires_at = datetime.now(UTC) + timedelta(minutes=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = PassportService().issue(
            {
                "user_id": account_id,
                "exp": int(expires_at.timestamp()),
                "iss": dify_config.DEPLOYMENT_EDITION.value,
                "sub": "Console API Passport",
            }
        )
        refresh_token = secrets.token_hex(64)
        self._store_refresh_token(refresh_token, account_id)
        return AuthTokenPair(
            access_token=access_token,
            refresh_token=refresh_token,
            csrf_token=generate_csrf_token(account_id),
        )

    def _store_refresh_token(self, refresh_token: str, account_id: str) -> None:
        expires_in = timedelta(days=dify_config.REFRESH_TOKEN_EXPIRE_DAYS)
        self._redis.setex(self._refresh_token_key(refresh_token), expires_in, account_id)
        self._redis.setex(self._account_refresh_token_key(account_id), expires_in, refresh_token)

    def _delete_refresh_token(self, refresh_token: str, account_id: str) -> None:
        self._redis.delete(self._refresh_token_key(refresh_token))
        self._redis.delete(self._account_refresh_token_key(account_id))

    @staticmethod
    def _refresh_token_key(refresh_token: str) -> str:
        return f"{_REFRESH_TOKEN_PREFIX}{refresh_token}"

    @staticmethod
    def _account_refresh_token_key(account_id: str) -> str:
        return f"{_ACCOUNT_REFRESH_TOKEN_PREFIX}{account_id}"


class SQLAlchemyAccountRefreshPreparationGateway(AccountRefreshPreparationGateway):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def prepare(self, account_id: str) -> RefreshAccountStatus:
        now = naive_utc_now()
        with self._session_factory.begin() as session:
            account = session.get(Account, account_id)
            if account is None:
                return RefreshAccountStatus.NOT_FOUND
            if account.status == AccountStatus.BANNED:
                return RefreshAccountStatus.BANNED

            current_membership = session.scalar(
                select(TenantAccountJoin)
                .join(Tenant, Tenant.id == TenantAccountJoin.tenant_id)
                .where(
                    TenantAccountJoin.account_id == account_id,
                    TenantAccountJoin.current.is_(True),
                    Tenant.status == TenantStatus.NORMAL,
                )
                .limit(1)
            )
            if current_membership is None:
                session.execute(
                    update(TenantAccountJoin)
                    .where(TenantAccountJoin.account_id == account_id, TenantAccountJoin.current.is_(True))
                    .values(current=False)
                )
                current_membership = session.scalar(
                    select(TenantAccountJoin)
                    .join(Tenant, Tenant.id == TenantAccountJoin.tenant_id)
                    .where(
                        TenantAccountJoin.account_id == account_id,
                        Tenant.status == TenantStatus.NORMAL,
                    )
                    .order_by(TenantAccountJoin.id.asc())
                    .limit(1)
                )
                if current_membership is None:
                    return RefreshAccountStatus.NOT_FOUND
                current_membership.current = True
                current_membership.last_opened_at = now

            session.execute(
                update(Account)
                .where(
                    Account.id == account_id,
                    Account.last_active_at < now - _ACCOUNT_LAST_ACTIVE_REFRESH_INTERVAL,
                )
                .values(last_active_at=now)
            )
            return RefreshAccountStatus.READY


class SQLAlchemyConsoleAuthProvisioningGateway(AccountProvisioningGateway, WorkspaceProvisioningGateway):
    """Persist the account/workspace aggregate and own its transaction boundary."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def create_with_owner_workspace(
        self,
        *,
        email: str,
        name: str,
        interface_language: str,
        timezone: str,
        ip_address: str,
    ) -> str:
        normalized_email = normalize_email(email)
        account = Account(
            name=name,
            email=email,
            normalized_email=normalized_email,
            interface_language=interface_language,
            interface_theme="light",
            timezone=timezone,
            last_login_ip=ip_address,
        )
        with self._session_factory.begin() as session:
            normalized_email_in_use = session.scalar(
                select(Account.id).where(Account.normalized_email == normalized_email).limit(1)
            )
            if normalized_email_in_use is not None:
                raise account_errors.AccountNormalizedEmailAlreadyInUseError
            session.add(account)
            tenant = self._add_owner_workspace(session, account)
            self._bind_owner_rbac_role(tenant, account.id, session)

        self._after_workspace_created(tenant, account.id)
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE:
            from services.enterprise.enterprise_service import try_join_default_workspace

            try_join_default_workspace(account.id)
        return account.id

    @override
    def create_owner_workspace(self, account_id: str) -> None:
        with self._session_factory.begin() as session:
            account = session.scalar(select(Account).where(Account.id == account_id).with_for_update())
            if account is None:
                raise account_errors.AccountNotFoundError
            existing_workspace_id = session.scalar(
                select(Tenant.id)
                .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
                .where(
                    TenantAccountJoin.account_id == account_id,
                    Tenant.status == TenantStatus.NORMAL,
                )
                .limit(1)
            )
            if existing_workspace_id is not None:
                return
            tenant = self._add_owner_workspace(session, account)
            self._bind_owner_rbac_role(tenant, account.id, session)

        self._after_workspace_created(tenant, account.id)

    @staticmethod
    def _add_owner_workspace(session: Session, account: Account) -> Tenant:
        tenant = Tenant(name=f"{account.name}'s Workspace")
        tenant.encrypt_public_key = generate_key_pair(tenant.id)
        session.add(tenant)
        session.add(
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=account.id,
                role=TenantAccountRole.OWNER,
            )
        )
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
        session.add(
            TenantCreditPool(
                tenant_id=tenant.id,
                quota_limit=dify_config.HOSTED_POOL_CREDITS,
                quota_used=0,
                pool_type=ProviderQuotaType.TRIAL,
            )
        )
        return tenant

    def _bind_owner_rbac_role(self, tenant: Tenant, account_id: str, session: Session) -> None:
        if dify_config.RBAC_ENABLED:
            owner_role_id = self._resolve_owner_role_id(tenant.id, account_id)
            RBACService.MemberRoles.replace(
                tenant_id=tenant.id,
                account_id=account_id,
                member_account_id=account_id,
                role_ids=[owner_role_id],
                session=session,
            )

    def _after_workspace_created(self, tenant: Tenant, account_id: str) -> None:
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            BillingService.clean_billing_info_cache(tenant.id)
        tenant_was_created.send(tenant)

    @staticmethod
    def _resolve_owner_role_id(tenant_id: str, account_id: str) -> str:
        roles = RBACService.Roles.list(
            tenant_id,
            account_id,
            options=ListOption(page_number=1, results_per_page=100),
        ).data
        for role in roles:
            if role.is_builtin and role.category == "global_system_default" and role.role_tag == "owner":
                return str(role.id)
        raise ValueError(f"Builtin RBAC owner role not found in tenant {tenant_id}")


class RedisEmailCodeGateway(EmailCodeGateway):
    def __init__(
        self,
        *,
        redis: RedisClientWrapper | None = None,
        rate_limiter: RateLimiter | None = None,
    ) -> None:
        if rate_limiter is None:
            if redis is None:
                raise ValueError("redis is required when rate_limiter is not provided")
            rate_limiter = RateLimiter(
                prefix="email_code_login_rate_limit",
                max_attempts=_EMAIL_CODE_LOGIN_RATE_LIMIT_ATTEMPTS,
                time_window=_EMAIL_CODE_LOGIN_RATE_LIMIT_SECONDS,
                redis_client=redis,
            )
        self._rate_limiter = rate_limiter

    @override
    def send(
        self,
        *,
        account_id: str | None,
        normalized_email: str,
        recipient_email: str,
        language: str,
    ) -> str:
        normalized_email = normalized_email.lower()
        if self._rate_limiter.is_rate_limited(normalized_email):
            retry_after = int(self._rate_limiter.time_window / 60)
            raise account_errors.EmailCodeSendRateLimitError(retry_after)

        code = "".join(str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6))
        try:
            token = EmailCodeLoginChallengeStore.create(account_id=account_id, email=normalized_email, code=code)
        except EmailCodeLoginChallengeUnavailableError as error:
            logger.warning("Email-code challenge creation is unavailable", exc_info=True)
            raise account_errors.EmailCodeLoginUnavailableError from error
        send_email_code_login_mail_task.delay(language=language, to=recipient_email, code=code)
        self._rate_limiter.increment_rate_limit(normalized_email)
        return token

    @override
    def verify(self, *, normalized_email: str, code: str, token: str) -> EmailCodeChallengeStatus:
        try:
            result = EmailCodeLoginChallengeStore.verify(email=normalized_email.lower(), code=code, token=token)
        except EmailCodeLoginChallengeUnavailableError as error:
            logger.warning("Email-code challenge verification is unavailable", exc_info=True)
            raise account_errors.EmailCodeLoginUnavailableError from error
        return EmailCodeChallengeStatus(result.status.value)


class RedisResetPasswordEmailGateway(ResetPasswordEmailGateway):
    def __init__(
        self,
        *,
        redis: RedisClientWrapper | None = None,
        rate_limiter: RateLimiter | None = None,
    ) -> None:
        if rate_limiter is None:
            if redis is None:
                raise ValueError("redis is required when rate_limiter is not provided")
            rate_limiter = RateLimiter(
                prefix="reset_password_rate_limit",
                max_attempts=_RESET_PASSWORD_RATE_LIMIT_ATTEMPTS,
                time_window=_RESET_PASSWORD_RATE_LIMIT_SECONDS,
                redis_client=redis,
            )
        self._rate_limiter = rate_limiter

    @override
    def send(
        self,
        *,
        account_id: str | None,
        email: str,
        language: str,
        registration_allowed: bool,
    ) -> str:
        if self._rate_limiter.is_rate_limited(email):
            raise account_errors.ResetPasswordEmailRateLimitError(int(self._rate_limiter.time_window / 60))

        code = "".join(str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6))
        token = TokenManager.generate_token(
            account_id=account_id,
            email=email,
            token_type="reset_password",
            additional_data={"code": code},
        )
        if account_id is not None:
            send_reset_password_mail_task.delay(language=language, to=email, code=code)
        else:
            send_reset_password_mail_task_when_account_not_exist.delay(
                language=language,
                to=email,
                is_allow_register=registration_allowed,
            )
        self._rate_limiter.increment_rate_limit(email)
        return token


class LoggingConsoleAuthAuditGateway(ConsoleAuthAuditGateway):
    @override
    def login_failed(
        self,
        *,
        email: str,
        reason: LoginFailureReason,
        ip_address: str,
    ) -> None:
        logger.warning(
            "Console login failed: email=%s reason=%s ip_address=%s",
            email,
            reason,
            ip_address,
        )
