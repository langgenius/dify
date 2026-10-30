"""Infrastructure adapters shared by account application services."""

import logging
import secrets
import uuid
from collections.abc import Sequence
from contextlib import AbstractContextManager
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import override

from pydantic import TypeAdapter, ValidationError
from redis import RedisError
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Unauthorized

from configs import dify_config
from enums import DeploymentEdition
from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from libs.helper import RateLimiter, TokenManager
from libs.helper import timezone as validate_timezone
from libs.workspace_permission import check_workspace_member_invite_permission
from models.account import Account, AccountStatus
from repositories.account.repository import SQLAlchemyAccountRepository
from services.account.login_adapters import DeploymentConsoleAuthPolicyGateway
from services.account_activation_service import (
    AccountActivationEligibility,
    InvitationTokenStore,
    WorkspaceInvitePolicy,
    WorkspaceMemberAccessSync,
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
from services.account_security_gateway import RedisAccountEmailSecurityGateway
from services.billing_service import BillingService
from services.enterprise.account_deletion_sync import sync_account_deletion_memberships
from services.enterprise.enterprise_service import try_join_default_workspace
from services.entities.account_activation_entities import InvitationLookup, InvitationToken
from services.entities.account_entities import (
    AccountChangeEmailNewEmailToken,
    AccountChangeEmailNewEmailVerifiedToken,
    AccountChangeEmailOldEmailToken,
    AccountChangeEmailOldEmailVerifiedToken,
    AccountChangeEmailPhase,
    AccountChangeEmailTokenData,
    AccountDeletionChallenge,
    AccountEducationActivation,
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
from services.system_feature_service import SystemFeatureService
from services.telemetry_service import CommunityTelemetryService
from tasks.delete_account_task import delete_account_task
from tasks.mail_account_deletion_task import send_account_deletion_verification_code
from tasks.mail_change_mail_task import send_change_mail_completed_notification_task, send_change_mail_task

logger = logging.getLogger(__name__)

_invitation_token_adapter = TypeAdapter(InvitationToken)
_change_email_token_adapter: TypeAdapter[ChangeEmailTokenData] = TypeAdapter(ChangeEmailTokenData)

_CHANGE_EMAIL_RATE_LIMIT_ATTEMPTS = 1
_CHANGE_EMAIL_RATE_LIMIT_SECONDS = 60
_ACCOUNT_DELETION_RATE_LIMIT_ATTEMPTS = 1
_ACCOUNT_DELETION_RATE_LIMIT_SECONDS = 60
_ACCOUNT_LAST_ACTIVE_REFRESH_INTERVAL = timedelta(minutes=10)

_RELEASE_INVITATION_ACCEPTANCE_LUA = """
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
"""

_REVOKE_INVITATION_SUBJECT_LUA = """
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then ttl = tonumber(ARGV[1]) end
redis.call('SET', KEYS[1], 'revoked', 'PX', ttl)
return ttl
"""

_COMPLETE_INVITATION_ACCEPTANCE_LUA = """
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end

local source_ttl = redis.call('PTTL', KEYS[2])
local subject_state = redis.call('GET', KEYS[3])
if not subject_state or subject_state == ARGV[2] or subject_state == 'revoked' then
    local subject_ttl = redis.call('PTTL', KEYS[3])
    if subject_ttl <= 0 then subject_ttl = source_ttl end
    if subject_ttl <= 0 then subject_ttl = tonumber(ARGV[3]) end
    redis.call('SET', KEYS[3], 'revoked', 'PX', subject_ttl)
end

if ARGV[4] == 'membership' then
    local marker_ttl = source_ttl
    if marker_ttl <= 0 then marker_ttl = tonumber(ARGV[3]) end
    redis.call('SET', KEYS[4], '1', 'PX', marker_ttl)
else
    redis.call('DEL', KEYS[2])
end
redis.call('DEL', KEYS[1])
return 1
"""


class AccountIdentityGateway:
    """Materialize framework identities while the repositories own their Sessions."""

    def __init__(
        self,
        *,
        accounts: SQLAlchemyAccountRepository,
        redis: RedisClientWrapper,
    ) -> None:
        self._accounts = accounts
        self._redis = redis

    def get_account_by_id(self, account_id: str) -> Account | None:
        return self._accounts.get_model(account_id)

    def get_account_for_workspace(self, account_id: str, workspace_id: str) -> Account | None:
        return self._accounts.get_workspace_identity(account_id, workspace_id)

    def get_account_by_email(self, email: str, *, case_fallback: bool = False) -> Account | None:
        return self._accounts.find_identity(email, case_fallback=case_fallback)

    def load_user(self, account_id: str) -> Account | None:
        now = naive_utc_now()
        account = self._accounts.load_identity(account_id, now=now)
        if account is None:
            return None
        if account.status == AccountStatus.BANNED:
            raise Unauthorized("Account is banned.")
        before = now - _ACCOUNT_LAST_ACTIVE_REFRESH_INTERVAL
        if account.last_active_at < before:
            try:
                should_refresh = self._redis.set(
                    f"account_last_active_refresh:{account_id}",
                    1,
                    ex=int(_ACCOUNT_LAST_ACTIVE_REFRESH_INTERVAL.total_seconds()),
                    nx=True,
                )
            except RedisError:
                should_refresh = True
            if should_refresh:
                self._accounts.touch_activity(account_id, now=now, before=before, touch_updated_at=True)
                account.last_active_at = now
        return account


class DeploymentAccountLifecyclePolicy(DeploymentConsoleAuthPolicyGateway):
    def __init__(self) -> None:
        super().__init__(billing_enabled=dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD)

    def validate_timezone(self, timezone: str) -> str:
        return validate_timezone(timezone)

    def try_join_default_workspace(self, account_id: str) -> None:
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE:
            try_join_default_workspace(account_id)


class InstallationTelemetryGateway:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def report(self) -> None:
        try:
            with self._session_factory() as session:
                CommunityTelemetryService.report_install(session=session)
        except Exception:
            logger.debug("Failed to report install telemetry", exc_info=True)


class RedisInvitationTokenStore(InvitationTokenStore):
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis

    def create(self, invitation: InvitationToken) -> str:
        token = str(uuid.uuid4())
        ttl_seconds = dify_config.INVITE_EXPIRY_HOURS * 60 * 60
        self._redis.setex(
            self._invitation_token_key(token),
            ttl_seconds,
            _invitation_token_adapter.dump_json(invitation),
        )
        # A deliberate re-invitation starts a new subject lifecycle, while only
        # the latest token remains valid. Writing the source first means a Redis
        # failure leaves the previous lifecycle authoritative rather than
        # reviving an older token without a usable replacement.
        self._redis.setex(
            self._subject_state_key(invitation.workspace_id, invitation.account_id),
            ttl_seconds,
            token,
        )
        return token

    def acquire_workspace_admission(self, workspace_id: str) -> AbstractContextManager[object]:
        return self._redis.lock(f"workspace_member_invite:{workspace_id}", timeout=60)

    @override
    def find(self, invitation: InvitationLookup) -> InvitationToken | None:
        token = self._find_source(invitation)
        if token is None:
            return None
        return token if self._is_subject_token_valid(token.workspace_id, token.account_id, invitation.token) else None

    @override
    def revoke_subject(self, workspace_id: str, account_id: str) -> None:
        self._redis.register_script(_REVOKE_INVITATION_SUBJECT_LUA)(
            keys=[self._subject_state_key(workspace_id, account_id)],
            args=[self._maximum_ttl_ms()],
        )

    def is_subject_revoked(self, workspace_id: str, account_id: str) -> bool:
        state = self._redis.get(self._subject_state_key(workspace_id, account_id))
        if isinstance(state, bytes):
            state = state.decode("utf-8")
        return state == "revoked"

    def _is_subject_token_valid(self, workspace_id: str, account_id: str, token: str) -> bool:
        state = self._redis.get(self._subject_state_key(workspace_id, account_id))
        if state is None:
            # Invitations issued before subject-scoped state was introduced
            # remain usable until the first successful acceptance or removal.
            return True
        if isinstance(state, bytes):
            state = state.decode("utf-8")
        return state == token

    @override
    def claim(self, invitation: InvitationLookup, *, require_unused_membership: bool) -> str | None:
        if require_unused_membership and self.is_membership_consumed(invitation):
            return None
        ttl = self._redis.pttl(self._source_key(invitation))
        if ttl <= 0:
            return None
        claim_id = f"claim:{uuid.uuid4()}"
        claimed = self._redis.set(
            self._acceptance_claim_key(invitation.token),
            claim_id,
            nx=True,
            px=ttl,
        )
        if not claimed:
            return None
        if require_unused_membership:
            try:
                membership_consumed = self.is_membership_consumed(invitation)
            except BaseException:
                self.release(invitation, claim_id)
                raise
            if membership_consumed:
                self.release(invitation, claim_id)
                return None
        return claim_id

    @override
    def release(self, invitation: InvitationLookup, claim_id: str) -> None:
        self._redis.register_script(_RELEASE_INVITATION_ACCEPTANCE_LUA)(
            keys=[self._acceptance_claim_key(invitation.token)],
            args=[claim_id],
        )

    @override
    def complete_activation(self, invitation: InvitationLookup, claim_id: str) -> None:
        self._complete(invitation, claim_id, membership=False)

    @override
    def complete_membership(self, invitation: InvitationLookup, claim_id: str) -> None:
        self._complete(invitation, claim_id, membership=True)

    @override
    def is_membership_consumed(self, invitation: InvitationLookup) -> bool:
        return self._redis.get(self._membership_used_key(invitation.token)) in {b"1", "1"}

    def _complete(self, invitation: InvitationLookup, claim_id: str, *, membership: bool) -> None:
        source = self._find_source(invitation)
        if source is None:
            raise RuntimeError("Invitation source is no longer available")
        completed = self._redis.register_script(_COMPLETE_INVITATION_ACCEPTANCE_LUA)(
            keys=[
                self._acceptance_claim_key(invitation.token),
                self._source_key(invitation),
                self._subject_state_key(source.workspace_id, source.account_id),
                self._membership_used_key(invitation.token),
            ],
            args=[
                claim_id,
                invitation.token,
                self._maximum_ttl_ms(),
                "membership" if membership else "activation",
            ],
        )
        if completed != 1:
            raise RuntimeError("Invitation acceptance claim is no longer owned")

    def _find_source(self, invitation: InvitationLookup) -> InvitationToken | None:
        data = self._redis.get(self._source_key(invitation))
        if data is None:
            return None
        if invitation.workspace_id is not None and invitation.email is not None:
            account_id = data.decode("utf-8") if isinstance(data, bytes) else str(data)
            return InvitationToken(
                account_id=account_id,
                email=invitation.email,
                workspace_id=invitation.workspace_id,
            )
        return _invitation_token_adapter.validate_json(data)

    @staticmethod
    def _maximum_ttl_ms() -> int:
        return int(dify_config.INVITE_EXPIRY_HOURS * 60 * 60 * 1000)

    def _source_key(self, invitation: InvitationLookup) -> str:
        if invitation.workspace_id is not None and invitation.email is not None:
            return self._workspace_invitation_key(invitation)
        return self._invitation_token_key(invitation.token)

    @staticmethod
    def _invitation_token_key(token: str) -> str:
        return f"member_invite:token:{token}"

    @classmethod
    def _membership_used_key(cls, token: str) -> str:
        return f"{cls._invitation_token_key(token)}:membership_used"

    @classmethod
    def _acceptance_claim_key(cls, token: str) -> str:
        return f"{cls._invitation_token_key(token)}:acceptance_claim"

    @staticmethod
    def _workspace_invitation_key(invitation: InvitationLookup) -> str:
        assert invitation.workspace_id is not None
        assert invitation.email is not None
        email_hash = sha256(invitation.email.encode()).hexdigest()
        return f"member_invite_token:{invitation.workspace_id}, {email_hash}:{invitation.token}"

    @staticmethod
    def _subject_state_key(workspace_id: str, account_id: str) -> str:
        return f"member_invite:subject:{workspace_id}:{account_id}:state"


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

    @override
    def has_account_capacity(self) -> bool:
        return SystemFeatureService.get_license().seats.is_available()


class BillingWorkspaceMembershipCache(WorkspaceMembershipCache):
    def __init__(self, *, enabled: bool) -> None:
        self._enabled = enabled

    @override
    def invalidate(self, workspace_id: str) -> None:
        if self._enabled:
            BillingService.clean_billing_info_cache(workspace_id)


class RBACWorkspaceMemberAccessSync(WorkspaceMemberAccessSync):
    def __init__(self, *, enabled: bool) -> None:
        self._enabled = enabled

    @override
    def sync(self, workspace_id: str, account_id: str) -> None:
        if not self._enabled:
            return

        from tasks.initialize_created_app_rbac_access_task import sync_joined_workspace_member_rbac_access_task

        sync_joined_workspace_member_rbac_access_task.delay(
            workspace_id,
            account_id,
            operator_account_id=None,
        )


class BillingAccountEducationGateway(AccountEducationGateway):
    @override
    def verify(self, *, account_id: str) -> AccountEducationVerification:
        result = BillingService.EducationIdentity.verify(account_id=account_id) or {}
        return AccountEducationVerification(token=result.get("token"))

    @override
    def activate(
        self,
        *,
        account_id: str,
        tenant_id: str,
        token: str,
        institution: str,
        role: str,
    ) -> AccountEducationActivation:
        result = BillingService.EducationIdentity.activate(
            account_id=account_id,
            tenant_id=tenant_id,
            token=token,
            institution=institution,
            role=role,
        )
        return AccountEducationActivation(message=result["message"])

    @override
    def status(self, account_id: str) -> AccountEducationStatus:
        result = BillingService.EducationIdentity.status(account_id) or {}
        expire_at = result.get("expire_at")
        return AccountEducationStatus(
            result=result.get("result"),
            is_student=result.get("is_student"),
            expire_at=datetime.fromisoformat(expire_at).astimezone(UTC) if isinstance(expire_at, str) else expire_at,
            allow_refresh=result.get("allow_refresh"),
        )

    @override
    def autocomplete(self, *, keywords: str, page: int, limit: int) -> AccountEducationAutocomplete:
        result = BillingService.EducationIdentity.autocomplete(keywords, page, limit) or {}
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
            "email": token_data.email,
            "old_email": token_data.old_email,
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


class RedisChangeEmailSecurityGateway(RedisAccountEmailSecurityGateway, ChangeEmailSecurityGateway):
    def __init__(
        self,
        *,
        redis: RedisClientWrapper,
        email_send_ip_limit_per_minute: int,
        verification_failure_limit: int,
        verification_lockout_duration: int,
    ) -> None:
        super().__init__(
            redis=redis,
            email_send_ip_limit_per_minute=email_send_ip_limit_per_minute,
            verification_failure_limit=verification_failure_limit,
            verification_lockout_duration=verification_lockout_duration,
            verification_key_prefix="change_email_error_rate_limit",
        )


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
