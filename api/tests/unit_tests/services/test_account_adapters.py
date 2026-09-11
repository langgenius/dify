from datetime import UTC, datetime
from hashlib import sha256
from typing import cast
from unittest.mock import MagicMock, patch

import pytest

from extensions.ext_redis import RedisClientWrapper
from libs.helper import RateLimiter
from services.account_adapters import (
    BillingAccountActivationEligibility,
    BillingAccountEducationGateway,
    BillingAccountEmailPolicyGateway,
    BillingWorkspaceMembershipCache,
    CeleryAccountDeletionVerificationNotifier,
    DeploymentWorkspaceInvitePolicy,
    RBACWorkspaceMemberAccessSync,
    RedisChangeEmailSecurityGateway,
    RedisInvitationTokenStore,
    TokenManagerAccountDeletionVerificationGateway,
    TokenManagerChangeEmailTokenGateway,
)
from services.account_errors import AccountDeletionRateLimitError
from services.entities.account_activation_entities import InvitationLookup, InvitationToken
from services.entities.account_entities import (
    AccountChangeEmailNewEmailToken,
    AccountEducationActivation,
    AccountEducationAutocomplete,
    AccountEducationStatus,
)


def test_invitation_token_store_reads_workspace_invitation_key() -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    redis.get.return_value = b"account-1"
    lookup = InvitationLookup(workspace_id="workspace-1", email="invitee@example.com", token="token-1")

    result = RedisInvitationTokenStore(redis=cast(RedisClientWrapper, redis)).find(lookup)

    assert result == InvitationToken(
        account_id="account-1",
        email="invitee@example.com",
        workspace_id="workspace-1",
    )
    email_hash = sha256(b"invitee@example.com").hexdigest()
    redis.get.assert_called_once_with(f"member_invite_token:workspace-1, {email_hash}:token-1")


def test_invitation_token_store_reads_global_invitation_payload() -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    redis.get.return_value = (
        b'{"account_id":"account-1","email":"invitee@example.com","workspace_id":"workspace-1",'
        b'"role":"editor","requires_setup":false}'
    )
    lookup = InvitationLookup(workspace_id=None, email="invitee@example.com", token="token-1")

    result = RedisInvitationTokenStore(redis=cast(RedisClientWrapper, redis)).find(lookup)

    assert result == InvitationToken(
        account_id="account-1",
        email="invitee@example.com",
        workspace_id="workspace-1",
        role="editor",
        requires_setup=False,
    )
    redis.get.assert_called_once_with("member_invite:token:token-1")


def test_invitation_token_store_revokes_its_redis_key() -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    lookup = InvitationLookup(workspace_id="workspace-1", email="invitee@example.com", token="token-1")

    RedisInvitationTokenStore(redis=cast(RedisClientWrapper, redis)).revoke(lookup)

    email_hash = sha256(b"invitee@example.com").hexdigest()
    redis.delete.assert_called_once_with(f"member_invite_token:workspace-1, {email_hash}:token-1")


def test_billing_eligibility_skips_gateway_when_disabled() -> None:
    with patch("services.account_adapters.BillingService.get_email_freeze_type") as get_freeze_type:
        result = BillingAccountActivationEligibility(enabled=False).get_freeze_type("invitee@example.com")

    assert result is None
    get_freeze_type.assert_not_called()


def test_billing_eligibility_returns_freeze_type_when_enabled() -> None:
    with patch(
        "services.account_adapters.BillingService.get_email_freeze_type",
        return_value="email_domain_suspended",
    ) as get_freeze_type:
        result = BillingAccountActivationEligibility(enabled=True).get_freeze_type("invitee@example.com")

    assert result == "email_domain_suspended"
    get_freeze_type.assert_called_once_with("invitee@example.com")


def test_membership_cache_skips_gateway_when_disabled() -> None:
    with patch("services.account_adapters.BillingService.clean_billing_info_cache") as invalidate:
        BillingWorkspaceMembershipCache(enabled=False).invalidate("workspace-1")

    invalidate.assert_not_called()


def test_workspace_policy_delegates_to_existing_policy_owner() -> None:
    with patch("services.account_adapters.check_workspace_member_invite_permission") as ensure_allowed:
        DeploymentWorkspaceInvitePolicy().ensure_allowed("workspace-1")

    ensure_allowed.assert_called_once_with("workspace-1")


def test_rbac_member_access_sync_skips_gateway_when_disabled() -> None:
    with patch(
        "tasks.initialize_created_app_rbac_access_task.sync_joined_workspace_member_rbac_access_task.delay"
    ) as delay:
        RBACWorkspaceMemberAccessSync(enabled=False).sync("workspace-1", "account-1")

    delay.assert_not_called()


def test_rbac_member_access_sync_enqueues_joined_member_sync_when_enabled() -> None:
    with patch(
        "tasks.initialize_created_app_rbac_access_task.sync_joined_workspace_member_rbac_access_task.delay"
    ) as delay:
        RBACWorkspaceMemberAccessSync(enabled=True).sync("workspace-1", "account-1")

    delay.assert_called_once_with("workspace-1", "account-1", operator_account_id=None)


def test_education_gateway_normalizes_billing_status_timestamp() -> None:
    gateway = BillingAccountEducationGateway()

    with patch(
        "services.account_adapters.BillingService.EducationIdentity.status",
        return_value={
            "result": True,
            "is_student": True,
            "expire_at": "2027-01-01T00:00:00+00:00",
            "allow_refresh": False,
        },
    ):
        result = gateway.status("account-1")

    assert result == AccountEducationStatus(
        result=True,
        is_student=True,
        expire_at=datetime(2027, 1, 1, tzinfo=UTC),
        allow_refresh=False,
    )


def test_education_gateway_activates_with_primitive_account_context() -> None:
    gateway = BillingAccountEducationGateway()

    with patch(
        "services.account_adapters.BillingService.EducationIdentity.activate",
        return_value={"message": "success"},
    ) as activate:
        result = gateway.activate(
            account_id="account-1",
            tenant_id="workspace-1",
            token="education-token",
            institution="Dify University",
            role="Student",
        )

    assert result == AccountEducationActivation(message="success")
    activate.assert_called_once_with(
        account_id="account-1",
        tenant_id="workspace-1",
        token="education-token",
        institution="Dify University",
        role="Student",
    )


def test_education_gateway_normalizes_autocomplete_defaults() -> None:
    gateway = BillingAccountEducationGateway()

    with patch(
        "services.account_adapters.BillingService.EducationIdentity.autocomplete",
        return_value=None,
    ):
        result = gateway.autocomplete(keywords="Example", page=0, limit=20)

    assert result == AccountEducationAutocomplete(data=(), curr_page=None, has_next=None)


def test_billing_email_policy_preserves_suspended_domain_reason() -> None:
    gateway = BillingAccountEmailPolicyGateway(billing_enabled=True)

    with (
        patch("services.account_adapters.BillingService.is_email_in_freeze", return_value=True),
        patch(
            "services.account_adapters.BillingService.get_email_freeze_type",
            return_value="email_domain_suspended",
        ),
    ):
        assert gateway.is_frozen("user@suspended.example") == "email_domain_suspended"


def test_token_gateway_rejects_payload_without_account_binding() -> None:
    gateway = TokenManagerChangeEmailTokenGateway()

    with patch(
        "services.account_adapters.TokenManager.get_token_data",
        return_value={
            "token_type": "change_email",
            "email": "new@example.com",
            "old_email": "old@example.com",
            "code": "123456",
            "email_change_phase": "new_email",
        },
    ):
        assert gateway.get("token") is None


def test_token_gateway_issues_account_bound_state() -> None:
    gateway = TokenManagerChangeEmailTokenGateway()
    token_data = AccountChangeEmailNewEmailToken(
        account_id="account-1",
        email="new@example.com",
        old_email="old@example.com",
        code="123456",
    )

    with patch(
        "services.account_adapters.TokenManager.generate_token",
        return_value="token",
    ) as generate_token:
        assert gateway.issue(token_data) == "token"

    assert generate_token.call_args.kwargs["account_id"] == "account-1"
    assert generate_token.call_args.kwargs["email"] == "new@example.com"
    assert generate_token.call_args.kwargs["additional_data"] == {
        "old_email": "old@example.com",
        "code": "123456",
        "email_change_phase": "new_email",
    }


def test_security_gateway_counts_normal_ip_request() -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    redis.get.side_effect = [None, None]
    gateway = RedisChangeEmailSecurityGateway(
        redis=redis,
        email_send_ip_limit_per_minute=60,
        verification_failure_limit=5,
        verification_lockout_duration=600,
    )

    assert gateway.is_ip_limited("127.0.0.1") is False

    redis.setex.assert_called_once_with("email_send_ip_limit_minute:127.0.0.1", 60, 1)
    redis.expire.assert_called_once_with("email_send_ip_limit_minute:127.0.0.1", 60)


def test_security_gateway_freezes_second_over_limit_ip_strike() -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    redis.get.side_effect = [None, 2, 1]
    gateway = RedisChangeEmailSecurityGateway(
        redis=redis,
        email_send_ip_limit_per_minute=1,
        verification_failure_limit=5,
        verification_lockout_duration=600,
    )

    assert gateway.is_ip_limited("127.0.0.1") is True

    redis.setex.assert_called_once_with("email_send_ip_limit_freeze:127.0.0.1", 3600, 1)


def test_verification_gateway_binds_token_to_the_target_account() -> None:
    gateway = TokenManagerAccountDeletionVerificationGateway()

    with patch(
        "services.account_adapters.TokenManager.get_token_data",
        return_value={"account_id": "account-1", "code": "123456"},
    ):
        assert gateway.verify(account_id="account-1", token="token", code="123456") is True
        assert gateway.verify(account_id="account-2", token="token", code="123456") is False


def test_verification_gateway_creates_six_digit_account_bound_challenge() -> None:
    gateway = TokenManagerAccountDeletionVerificationGateway()

    with (
        patch("services.account_adapters.secrets.randbelow", side_effect=[1, 2, 3, 4, 5, 6]),
        patch(
            "services.account_adapters.TokenManager.generate_token",
            return_value="token",
        ) as generate_token,
    ):
        challenge = gateway.create(account_id="account-1", email="account@example.com")

    assert challenge.token == "token"
    assert challenge.code == "123456"
    assert generate_token.call_args.kwargs["account_id"] == "account-1"
    assert generate_token.call_args.kwargs["email"] == "account@example.com"
    assert generate_token.call_args.kwargs["additional_data"] == {"code": "123456"}


def test_verification_notifier_preserves_rate_limit_before_enqueuing_email() -> None:
    limiter = MagicMock(spec=RateLimiter)
    limiter.is_rate_limited.return_value = True
    limiter.time_window = 60
    notifier = CeleryAccountDeletionVerificationNotifier(rate_limiter=limiter)

    with (
        patch("services.account_adapters.send_account_deletion_verification_code") as mail_task,
        pytest.raises(AccountDeletionRateLimitError) as error,
    ):
        notifier.send(email="account@example.com", code="123456")

    assert error.value.retry_after_minutes == 1
    mail_task.delay.assert_not_called()
