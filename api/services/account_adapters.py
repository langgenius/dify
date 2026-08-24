"""Infrastructure adapters shared by account application services."""

import secrets
from collections.abc import Sequence
from datetime import UTC, datetime
from hashlib import sha256
from typing import Any, override

from pydantic import TypeAdapter, ValidationError
from redis import RedisError

from configs import dify_config
from extensions.ext_redis import RedisClientWrapper
from libs.helper import RateLimiter, TokenManager
from libs.workspace_permission import check_workspace_member_invite_permission
from services.account_activation_service import (
    AccountActivationEligibility,
    InvitationTokenStore,
    WorkspaceInvitePolicy,
    WorkspaceMembershipCache,
)
from services.account_change_email_ports import (
    AccountEmailPolicyGateway,
    ChangeEmailCodeGenerator,
    ChangeEmailNotificationGateway,
    ChangeEmailSecurityGateway,
    ChangeEmailSendLimiter,
    ChangeEmailTokenGateway,
)
from services.account_deletion_feedback_service import AccountDeletionFeedbackGateway
from services.account_education_service import AccountEducationGateway
from services.account_errors import AccountDeletionRateLimitError
from services.account_ports import (
    AccountDeletionScheduler,
    AccountDeletionSyncGateway,
    AccountDeletionVerificationGateway,
    AccountDeletionVerificationNotifier,
)
from services.billing_service import BillingService
from services.enterprise.account_deletion_sync import sync_account_deletion_memberships
from services.entities.account_activation_entities import InvitationLookup, InvitationToken
from services.entities.account_entities import (
    AccountChangeEmailNewEmailToken,
    AccountChangeEmailNewEmailVerifiedToken,
    AccountChangeEmailOldEmailToken,
    AccountChangeEmailOldEmailVerifiedToken,
    AccountChangeEmailPhase,
    AccountChangeEmailTokenData,
    AccountDeletionChallenge,
    AccountEducationAutocomplete,
    AccountEducationStatus,
    AccountEducationVerification,
)
from services.entities.auth_entities import (
    ChangeEmailNewEmailToken,
    ChangeEmailNewEmailVerifiedToken,
    ChangeEmailOldEmailToken,
    ChangeEmailOldEmailVerifiedToken,
    ChangeEmailTokenData,
)
from tasks.delete_account_task import delete_account_task
from tasks.mail_account_deletion_task import send_account_deletion_verification_code
from tasks.mail_change_mail_task import send_change_mail_completed_notification_task, send_change_mail_task

_invitation_token_adapter = TypeAdapter(InvitationToken)
_change_email_token_adapter: TypeAdapter[ChangeEmailTokenData] = TypeAdapter(ChangeEmailTokenData)

_CHANGE_EMAIL_RATE_LIMIT_ATTEMPTS = 1
_CHANGE_EMAIL_RATE_LIMIT_SECONDS = 60
_CHANGE_EMAIL_VERIFICATION_FAILURE_LIMIT = 5
_ACCOUNT_DELETION_RATE_LIMIT_ATTEMPTS = 1
_ACCOUNT_DELETION_RATE_LIMIT_SECONDS = 60


class RedisInvitationTokenStore(InvitationTokenStore):
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis

    @override
    def find(self, invitation: InvitationLookup) -> InvitationToken | None:
        if invitation.workspace_id is not None and invitation.email is not None:
            account_id = self._redis.get(self._workspace_invitation_key(invitation))
            if account_id is None:
                return None
            return InvitationToken(
                account_id=account_id.decode("utf-8"),
                email=invitation.email,
                workspace_id=invitation.workspace_id,
            )

        data = self._redis.get(self._invitation_token_key(invitation.token))
        if data is None:
            return None
        return _invitation_token_adapter.validate_json(data)

    @override
    def revoke(self, invitation: InvitationLookup) -> None:
        if invitation.workspace_id is not None and invitation.email is not None:
            self._redis.delete(self._workspace_invitation_key(invitation))
        else:
            self._redis.delete(self._invitation_token_key(invitation.token))

    @staticmethod
    def _invitation_token_key(token: str) -> str:
        return f"member_invite:token:{token}"

    @staticmethod
    def _workspace_invitation_key(invitation: InvitationLookup) -> str:
        assert invitation.workspace_id is not None
        assert invitation.email is not None
        email_hash = sha256(invitation.email.encode()).hexdigest()
        return f"member_invite_token:{invitation.workspace_id}, {email_hash}:{invitation.token}"


class DeploymentWorkspaceInvitePolicy(WorkspaceInvitePolicy):
    @override
    def ensure_allowed(self, workspace_id: str) -> None:
        check_workspace_member_invite_permission(workspace_id)


class BillingAccountActivationEligibility(AccountActivationEligibility):
    def __init__(self, *, enabled: bool) -> None:
        self._enabled = enabled

    @override
    def get_freeze_type(self, email: str) -> str | None:
        if not self._enabled:
            return None
        return BillingService.get_email_freeze_type(email)


class BillingWorkspaceMembershipCache(WorkspaceMembershipCache):
    def __init__(self, *, enabled: bool) -> None:
        self._enabled = enabled

    @override
    def invalidate(self, workspace_id: str) -> None:
        if self._enabled:
            BillingService.clean_billing_info_cache(workspace_id)


class BillingAccountEducationGateway(AccountEducationGateway):
    @override
    def verify(self, *, account_id: str, email: str) -> AccountEducationVerification:
        result = BillingService.EducationIdentity.verify(account_id, email) or {}
        return AccountEducationVerification(token=result.get("token"))

    @override
    def activate(
        self,
        *,
        account_id: str,
        email: str,
        tenant_id: str,
        token: str,
        institution: str,
        role: str,
    ) -> dict[str, Any] | None:
        return BillingService.EducationIdentity.activate(
            account_id=account_id,
            email=email,
            tenant_id=tenant_id,
            token=token,
            institution=institution,
            role=role,
        )

    @override
    def status(self, account_id: str) -> AccountEducationStatus:
        result: dict[str, Any] = BillingService.EducationIdentity.status(account_id) or {}
        expire_at = result.get("expire_at")
        return AccountEducationStatus(
            result=result.get("result"),
            is_student=result.get("is_student"),
            expire_at=datetime.fromisoformat(expire_at).astimezone(UTC) if isinstance(expire_at, str) else expire_at,
            allow_refresh=result.get("allow_refresh"),
        )

    @override
    def autocomplete(self, *, keywords: str, page: int, limit: int) -> AccountEducationAutocomplete:
        result: dict[str, Any] = BillingService.EducationIdentity.autocomplete(keywords, page, limit) or {}
        return AccountEducationAutocomplete(
            data=tuple(result.get("data") or ()),
            curr_page=result.get("curr_page"),
            has_next=result.get("has_next"),
        )


class BillingAccountDeletionFeedbackGateway(AccountDeletionFeedbackGateway):
    @override
    def submit(self, *, email: str, feedback: str) -> None:
        BillingService.update_account_deletion_feedback(email, feedback)


class TokenManagerChangeEmailTokenGateway(ChangeEmailTokenGateway):
    @override
    def get(self, token: str) -> AccountChangeEmailTokenData | None:
        payload = TokenManager.get_token_data(token, "change_email")
        if payload is None:
            return None
        try:
            token_data = _change_email_token_adapter.validate_python(payload)
        except ValidationError:
            return None
        token_kwargs = {
            "account_id": token_data.account_id,
            "email": str(token_data.email),
            "old_email": str(token_data.old_email),
            "code": token_data.code,
        }
        if isinstance(token_data, ChangeEmailOldEmailToken):
            return AccountChangeEmailOldEmailToken(**token_kwargs)
        if isinstance(token_data, ChangeEmailOldEmailVerifiedToken):
            return AccountChangeEmailOldEmailVerifiedToken(**token_kwargs)
        if isinstance(token_data, ChangeEmailNewEmailToken):
            return AccountChangeEmailNewEmailToken(**token_kwargs)
        if isinstance(token_data, ChangeEmailNewEmailVerifiedToken):
            return AccountChangeEmailNewEmailVerifiedToken(**token_kwargs)
        return None

    @override
    def issue(self, token_data: AccountChangeEmailTokenData) -> str:
        return TokenManager.generate_token(
            account_id=token_data.account_id,
            email=token_data.email,
            token_type="change_email",
            additional_data={
                "old_email": token_data.old_email,
                "code": token_data.code,
                "email_change_phase": token_data.phase.value,
            },
        )

    @override
    def revoke(self, token: str) -> None:
        TokenManager.revoke_token(token, "change_email")


class SecureChangeEmailCodeGenerator(ChangeEmailCodeGenerator):
    @override
    def generate(self) -> str:
        return "".join(str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6))


class CeleryChangeEmailNotificationGateway(ChangeEmailNotificationGateway):
    @override
    def send_code(self, *, email: str, code: str, language: str, phase: AccountChangeEmailPhase) -> None:
        send_change_mail_task.delay(language=language, to=email, code=code, phase=phase)

    @override
    def send_completed(self, *, email: str, language: str) -> None:
        send_change_mail_completed_notification_task.delay(language=language, to=email)


class RateLimiterChangeEmailSendLimiter(ChangeEmailSendLimiter):
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
                prefix="change_email_rate_limit",
                max_attempts=_CHANGE_EMAIL_RATE_LIMIT_ATTEMPTS,
                time_window=_CHANGE_EMAIL_RATE_LIMIT_SECONDS,
                redis_client=redis,
            )
        self._rate_limiter = rate_limiter

    @override
    def is_limited(self, email: str) -> bool:
        return self._rate_limiter.is_rate_limited(email)

    @override
    def record(self, email: str) -> None:
        self._rate_limiter.increment_rate_limit(email)

    @property
    @override
    def retry_after_minutes(self) -> int:
        return int(self._rate_limiter.time_window / 60)


class RedisChangeEmailSecurityGateway(ChangeEmailSecurityGateway):
    def __init__(
        self,
        *,
        redis: RedisClientWrapper,
        email_send_ip_limit_per_minute: int | None = None,
        verification_failure_limit: int = _CHANGE_EMAIL_VERIFICATION_FAILURE_LIMIT,
        verification_lockout_duration: int | None = None,
    ) -> None:
        self._redis = redis
        self._email_send_ip_limit_per_minute = (
            email_send_ip_limit_per_minute
            if email_send_ip_limit_per_minute is not None
            else dify_config.EMAIL_SEND_IP_LIMIT_PER_MINUTE
        )
        self._verification_failure_limit = verification_failure_limit
        self._verification_lockout_duration = (
            verification_lockout_duration
            if verification_lockout_duration is not None
            else dify_config.CHANGE_EMAIL_LOCKOUT_DURATION
        )

    @override
    def is_ip_limited(self, ip_address: str) -> bool:
        minute_key = f"email_send_ip_limit_minute:{ip_address}"
        freeze_key = f"email_send_ip_limit_freeze:{ip_address}"
        hour_limit_key = f"email_send_ip_limit_hour:{ip_address}"
        try:
            if self._redis.get(freeze_key):
                return True

            current_minute_count = int(self._redis.get(minute_key) or 0)
            if current_minute_count > self._email_send_ip_limit_per_minute:
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

    @override
    def is_verification_limited(self, email: str) -> bool:
        try:
            count = self._redis.get(self._verification_key(email))
            return count is not None and int(count) > self._verification_failure_limit
        except RedisError:
            return False

    @override
    def record_verification_failure(self, email: str) -> None:
        try:
            key = self._verification_key(email)
            count = int(self._redis.get(key) or 0) + 1
            self._redis.setex(key, self._verification_lockout_duration, count)
        except RedisError:
            return None

    @override
    def reset_verification_failures(self, email: str) -> None:
        try:
            self._redis.delete(self._verification_key(email))
        except RedisError:
            return None

    @staticmethod
    def _verification_key(email: str) -> str:
        return f"change_email_error_rate_limit:{email}"


class BillingAccountEmailPolicyGateway(AccountEmailPolicyGateway):
    def __init__(self, *, billing_enabled: bool) -> None:
        self._billing_enabled = billing_enabled

    @override
    def is_frozen(self, email: str) -> str | None:
        if not self._billing_enabled or not BillingService.is_email_in_freeze(email):
            return None
        return BillingService.get_email_freeze_type(email) or "freeze"


class TokenManagerAccountDeletionVerificationGateway(AccountDeletionVerificationGateway):
    @override
    def create(self, *, account_id: str, email: str) -> AccountDeletionChallenge:
        code = "".join(str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6))
        token = TokenManager.generate_token(
            account_id=account_id,
            email=email,
            token_type="account_deletion",
            additional_data={"code": code},
        )
        return AccountDeletionChallenge(token=token, code=code)

    @override
    def verify(self, *, account_id: str, token: str, code: str) -> bool:
        token_data = TokenManager.get_token_data(token, "account_deletion")
        if token_data is None:
            return False
        return token_data.get("account_id") == account_id and token_data.get("code") == code


class CeleryAccountDeletionVerificationNotifier(AccountDeletionVerificationNotifier):
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
                prefix="email_code_account_deletion_rate_limit",
                max_attempts=_ACCOUNT_DELETION_RATE_LIMIT_ATTEMPTS,
                time_window=_ACCOUNT_DELETION_RATE_LIMIT_SECONDS,
                redis_client=redis,
            )
        self._rate_limiter = rate_limiter

    @override
    def send(self, *, email: str, code: str) -> None:
        if self._rate_limiter.is_rate_limited(email):
            raise AccountDeletionRateLimitError(int(self._rate_limiter.time_window / 60))

        send_account_deletion_verification_code.delay(to=email, code=code)
        self._rate_limiter.increment_rate_limit(email)


class EnterpriseAccountDeletionSyncGateway(AccountDeletionSyncGateway):
    @override
    def sync(self, *, account_id: str, workspace_ids: Sequence[str]) -> bool:
        return sync_account_deletion_memberships(
            account_id=account_id,
            workspace_ids=workspace_ids,
            source="account_deleted",
        )


class CeleryAccountDeletionScheduler(AccountDeletionScheduler):
    @override
    def schedule(self, account_id: str) -> None:
        delete_account_task.delay(account_id)
