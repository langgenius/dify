"""BillingService delegates to the generated billing and saas clients; HTTP behavior is covered in billing_client."""

from collections.abc import Callable
from unittest.mock import patch

import httpx
import pytest

from services.billing_client import billing, saas, transport
from services.billing_service import BillingService
from services.errors.billing import (
    BillingUpstreamUnavailableError,
)
from tests.helpers import billing_builders as builders

TENANT_ID = "11111111-1111-1111-1111-111111111111"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"


class TestBillingServiceSubscriptionInfo:
    """Subscription and usage reads delegate to the generated billing client."""

    def test_get_info_returns_the_generated_reply(self):
        reply = builders.subscription_info("team", vector_space=builders.vector_space(size=1.5, limit=50))

        with patch.object(billing, "subscription_get_subscription_info", return_value=reply) as get_info:
            result = BillingService.get_info(TENANT_ID, exclude_vector_space=True)

        assert result is reply
        get_info.assert_called_once_with(tenant_id=TENANT_ID, exclude_vector_space=True)

    @pytest.mark.parametrize("bypass_cache", [False, True])
    def test_get_vector_space_forwards_bypass_cache(self, bypass_cache: bool):
        reply = builders.vector_space(size=12.5, limit=50, usage_unknown=True)

        with patch.object(billing, "subscription_get_subscription_vector_space", return_value=reply) as get:
            result = BillingService.get_vector_space(TENANT_ID, bypass_cache=bypass_cache)

        assert result is reply
        get.assert_called_once_with(tenant_id=TENANT_ID, bypass_cache=bypass_cache)

    def test_get_knowledge_rate_limit_returns_the_generated_reply(self):
        reply = billing.GetKnowledgeRateLimitReply(subscription_plan="professional", limit=100)

        with patch.object(billing, "subscription_get_knowledge_rate_limit", return_value=reply) as get:
            result = BillingService.get_knowledge_rate_limit(TENANT_ID)

        assert result is reply
        get.assert_called_once_with(tenant_id=TENANT_ID)

    def test_get_subscription_returns_the_portal_link(self):
        reply = billing.GetSubscriptionPaymentLinkReply(url="https://payment.example.com/checkout")

        with patch.object(billing, "subscription_get_subscription_payment_link", return_value=reply) as get:
            result = BillingService.get_subscription("professional", "month", "user@example.com", TENANT_ID)

        assert result is reply
        get.assert_called_once_with(
            plan="professional", interval="month", prefilled_email="user@example.com", tenant_id=TENANT_ID
        )

    def test_get_invoices_returns_the_portal_link(self):
        reply = billing.GetInvoicesReply(url="https://billing.example.com/invoices")

        with patch.object(billing, "invoice_get_invoices", return_value=reply) as get:
            result = BillingService.get_invoices("user@example.com", TENANT_ID)

        assert result is reply
        get.assert_called_once_with(prefilled_email="user@example.com", tenant_id=TENANT_ID)

    def test_get_model_provider_payment_link_returns_the_generated_reply(self):
        reply = billing.GetModelProviderPaymentLinkReply(url="https://payment.example.com/provider")

        with patch.object(billing, "model_provider_get_model_provider_payment_link", return_value=reply) as get:
            # pyrefly: ignore [deprecated]
            result = BillingService.get_model_provider_payment_link("anthropic", TENANT_ID, ACCOUNT_ID, "a@b.com")

        assert result is reply
        get.assert_called_once_with(
            provider_name="anthropic", tenant_id=TENANT_ID, account_id=ACCOUNT_ID, prefilled_email="a@b.com"
        )

    def test_get_plan_bulk_chunks_requests_and_skips_failed_batches(self):
        tenant_ids = [f"tenant-{i}" for i in range(450)]

        def batch(*, body: billing.BatchGetSubscriptionPlanReq) -> billing.BatchGetSubscriptionPlanReply:
            if body.tenant_ids[0] == "tenant-200":
                raise BillingUpstreamUnavailableError("POST /subscription/plan/batch failed")
            return billing.BatchGetSubscriptionPlanReply(
                data={tenant_id: builders.plan_item("team", 1735689600) for tenant_id in body.tenant_ids}
            )

        with patch.object(billing, "subscription_batch_get_subscription_plan", side_effect=batch) as get:
            result = BillingService.get_plan_bulk(tenant_ids)

        assert [len(c.kwargs["body"].tenant_ids) for c in get.call_args_list] == [200, 200, 50]
        assert set(result) == set(tenant_ids[:200] + tenant_ids[400:])
        assert result["tenant-0"] == builders.plan_item("team", 1735689600)

    def test_get_plan_bulk_skips_invalid_items_from_http_response(
        self, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
    ) -> None:
        payload = {
            "data": {
                "valid": {"plan": "sandbox", "expiration_date": "-1"},
                "missing_expiration": {"plan": "sandbox"},
                "invalid_expiration": {"plan": "sandbox", "expiration_date": "invalid"},
                "missing_plan": {"expiration_date": -1},
                "invalid_item": "not-an-object",
                "null_item": None,
            }
        }
        config_overrides(BILLING_API_URL="http://billing/v1")
        with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))) as client:
            monkeypatch.setattr(transport, "_http_client", client)

            plans = BillingService.get_plan_bulk(list(payload["data"]))

        assert plans == {"valid": builders.plan_item("sandbox", -1)}

    def test_get_expired_subscription_cleanup_whitelist_returns_tenant_ids(self):
        reply = billing.ListSubscriptionCleanupWhitelistReply(
            data=[
                billing.SubscriptionCleanupWhitelist(
                    id=f"wl-{tenant_id}",
                    tenant_id=tenant_id,
                    contact="ops@example.com",
                    expired_at="2026-01-01T00:00:00Z",
                    created_at="2025-01-01T00:00:00Z",
                    updated_at="2025-01-01T00:00:00Z",
                )
                for tenant_id in ("tenant-a", "tenant-b")
            ]
        )

        with patch.object(billing, "subscription_list_subscription_cleanup_whitelist", return_value=reply):
            assert BillingService.get_expired_subscription_cleanup_whitelist() == ["tenant-a", "tenant-b"]

    def test_invalidate_vector_space_cache_bypasses_cache(self):
        tenant_id = "tenant-123"

        with patch.object(BillingService, "get_vector_space") as get_vector_space:
            BillingService.invalidate_vector_space_cache(tenant_id)

        get_vector_space.assert_called_once_with(tenant_id, bypass_cache=True)


class TestBillingServiceQuotaOperations:
    """Quota calls build the generated request bodies and return the generated replies."""

    def test_get_quota_info_returns_the_generated_reply(self):
        reply = billing.QuotaGetInfoReply(
            trigger_event=billing.QuotaFeatureInfo(usage=30, limit=100, reset_date=1767225600),
            api_rate_limit=billing.QuotaFeatureInfo(usage=0, limit=-1, reset_date=0),
        )

        with patch.object(billing, "quota_get_quota_info", return_value=reply) as get:
            assert BillingService.get_quota_info(TENANT_ID) is reply

        get.assert_called_once_with(tenant_id=TENANT_ID)

    def test_quota_reserve_sends_bucket_and_string_meta(self):
        reply = billing.QuotaReserveReply(reservation_id="rid-1", available=99, reserved=1)

        with patch.object(billing, "quota_reserve", return_value=reply) as reserve:
            result = BillingService.quota_reserve(
                tenant_id="t1",
                feature_key="credit_pool",
                request_id="req-1",
                amount=2,
                meta={"source": "llm.invoke", "attempt": 1},
                bucket="trial",
            )

        assert result is reply
        reserve.assert_called_once_with(
            body=billing.QuotaReserveReq(
                tenant_id="t1",
                feature_key="credit_pool",
                request_id="req-1",
                amount=2,
                meta={"source": "llm.invoke", "attempt": "1"},
                bucket="trial",
            )
        )

    def test_quota_reserve_defaults_to_empty_bucket_and_meta(self):
        reply = billing.QuotaReserveReply(reservation_id="rid-1", available=99, reserved=1)

        with patch.object(billing, "quota_reserve", return_value=reply) as reserve:
            BillingService.quota_reserve(tenant_id="t1", feature_key="trigger_event", request_id="req-1")

        assert reserve.call_args.kwargs["body"] == billing.QuotaReserveReq(
            tenant_id="t1", feature_key="trigger_event", request_id="req-1", amount=1, meta={}, bucket=""
        )

    def test_quota_commit_builds_the_request(self):
        reply = billing.QuotaCommitReply(available=98, reserved=0, refunded=0)

        with patch.object(billing, "quota_commit", return_value=reply) as commit:
            result = BillingService.quota_commit(
                tenant_id="t1",
                feature_key="credit_pool",
                reservation_id="rid-1",
                actual_amount=2,
                meta={"request_id": "req-1"},
                bucket="paid",
            )

        assert result is reply
        commit.assert_called_once_with(
            body=billing.QuotaCommitReq(
                tenant_id="t1",
                feature_key="credit_pool",
                reservation_id="rid-1",
                actual_amount=2,
                meta={"request_id": "req-1"},
                bucket="paid",
            )
        )

    def test_quota_release_builds_the_request(self):
        reply = billing.QuotaReleaseReply(available=100, reserved=0, released=1)

        with patch.object(billing, "quota_release", return_value=reply) as release:
            result = BillingService.quota_release(
                tenant_id="t1", feature_key="credit_pool", reservation_id="rid-1", bucket="trial"
            )

        assert result is reply
        release.assert_called_once_with(
            body=billing.QuotaReleaseReq(
                tenant_id="t1", feature_key="credit_pool", reservation_id="rid-1", bucket="trial"
            )
        )

    def test_quota_get_balance_forwards_the_bucket(self):
        reply = billing.QuotaGetBalanceReply(available=194, reserved=0, quota=200, usage=6, exhausted_at=0)

        with patch.object(billing, "quota_get_balance", return_value=reply) as get:
            assert BillingService.quota_get_balance("t1", "credit_pool", bucket="trial") is reply

        get.assert_called_once_with(tenant_id="t1", feature_key="credit_pool", bucket="trial")

    def test_quota_consume_capped_builds_the_request(self):
        reply = billing.QuotaConsumeCappedReply(deducted=3, available=0, reserved=0, quota=10, usage=10)

        with patch.object(billing, "quota_consume_capped", return_value=reply) as consume:
            result = BillingService.quota_consume_capped(
                tenant_id="t1", feature_key="credit_pool", request_id="req-1", amount=5, bucket="trial"
            )

        assert result is reply
        consume.assert_called_once_with(
            body=billing.QuotaConsumeCappedReq(
                tenant_id="t1", feature_key="credit_pool", request_id="req-1", amount=5, meta={}, bucket="trial"
            )
        )


class TestBillingServiceCacheManagement:
    """Unit tests for billing cache management.

    Tests cover:
    - Billing info cache invalidation
    - Proper Redis key formatting
    """

    @pytest.fixture
    def mock_redis_client(self):
        """Mock Redis client."""
        with patch("services.billing_service.redis_client") as mock_redis:
            yield mock_redis

    def test_clean_billing_info_cache(self, mock_redis_client):
        """Test cleaning billing info cache."""
        # Arrange
        tenant_id = "tenant-123"
        expected_key = f"tenant:{tenant_id}:billing_info"

        # Act
        BillingService.clean_billing_info_cache(tenant_id)

        # Assert
        mock_redis_client.delete.assert_called_once_with(expected_key)


class TestBillingServiceAccountAndEducation:
    """Education, compliance, account and notification calls delegate to the generated clients."""

    def test_compliance_download_returns_the_link(self):
        reply = billing.DownloadComplianceDocumentReply(url="https://billing.example.com/compliance")

        with patch.object(billing, "compliance_download_compliance_document", return_value=reply) as download:
            result = BillingService.get_compliance_download_link("soc2", ACCOUNT_ID, TENANT_ID, "127.0.0.1", "ua")

        assert result is reply
        download.assert_called_once_with(
            body=billing.DownloadComplianceDocumentReq(
                doc_name="soc2", account_id=ACCOUNT_ID, tenant_id=TENANT_ID, ip_address="127.0.0.1", device_info="ua"
            )
        )

    def test_education_activate_sends_account_context_in_the_body(self):
        reply = billing.CreateEducationIdentityReply(message="success")

        with patch.object(billing, "education_create_education_identity", return_value=reply) as create:
            result = BillingService.EducationIdentity.activate(
                account_id=ACCOUNT_ID, tenant_id=TENANT_ID, token="token", institution="Dify University", role="Student"
            )

        assert result is reply
        create.assert_called_once_with(
            body=billing.CreateEducationIdentityReq(
                account_id=ACCOUNT_ID,
                curr_tenant_id=TENANT_ID,
                institution="Dify University",
                role="Student",
                token="token",
            )
        )

    def test_education_reads_return_the_generated_replies(self):
        verify = billing.VerifyEducationIdentityReply(token="token", status="eligible")
        status = billing.GetEducationIdentityStatusReply(
            result=True, is_student=True, expire_at="2027-01-01T00:00:00+00:00", allow_refresh=False
        )
        autocomplete = billing.AutocompleteEducationInstitutionReply(
            data=["Dify University"], curr_page=0, has_next=False
        )

        with (
            patch.object(billing, "education_verify_education_identity", return_value=verify),
            patch.object(billing, "education_get_education_identity_status", return_value=status),
            patch.object(billing, "education_autocomplete_education_institution", return_value=autocomplete) as search,
        ):
            assert BillingService.EducationIdentity.verify(ACCOUNT_ID) is verify
            assert BillingService.EducationIdentity.status(ACCOUNT_ID) is status
            assert BillingService.EducationIdentity.autocomplete("Dify") is autocomplete

        search.assert_called_once_with(keywords="Dify", page=0, limit=20)

    def test_delete_account_and_feedback_call_saas(self):
        with (
            patch.object(saas, "account_delete_account", return_value=saas.DeleteAccountReply(message="ok")) as delete,
            patch.object(
                saas, "account_add_delete_feedback", return_value=saas.AddDeleteFeedbackReply(message="ok")
            ) as feedback,
        ):
            BillingService.delete_account(ACCOUNT_ID)
            BillingService.update_account_deletion_feedback("user@example.com", "too expensive")

        delete.assert_called_once_with(account_id=ACCOUNT_ID)
        feedback.assert_called_once_with(
            body=saas.AddDeleteFeedbackRequest(email="user@example.com", feedback="too expensive")
        )

    @pytest.mark.parametrize(
        ("data", "freeze_type", "expected"),
        [
            (False, "freeze", None),
            (True, "freeze", "freeze"),
            (True, "email_domain_suspended", "email_domain_suspended"),
            (True, "", "freeze"),
            (True, "unexpected", "freeze"),
        ],
    )
    def test_get_email_freeze_type(self, data: bool, freeze_type: str, expected: str | None):
        reply = saas.CheckAccountInFreezeReply.model_construct(data=data, freeze_type=freeze_type)

        with patch.object(saas, "account_check_account_in_freeze", return_value=reply) as check:
            assert BillingService.get_email_freeze_type("user@example.com") == expected
            assert BillingService.is_email_in_freeze("user@example.com") is (expected is not None)

        check.assert_called_with(email="user@example.com")

    def test_get_email_freeze_type_swallows_billing_errors(self):
        with patch.object(saas, "account_check_account_in_freeze", side_effect=BillingUpstreamUnavailableError("down")):
            assert BillingService.get_email_freeze_type("user@example.com") is None

    def test_notifications_call_saas(self):
        active = saas.GetAccountNotificationReply(should_show=False, notifications=[])
        dismissed = saas.DismissNotificationReply(success=True)

        with (
            patch.object(saas, "notification_get_account_notification", return_value=active) as get,
            patch.object(saas, "notification_dismiss_notification", return_value=dismissed) as dismiss,
        ):
            assert BillingService.get_account_notification(ACCOUNT_ID) is active
            assert BillingService.dismiss_notification("notification-1", ACCOUNT_ID) is dismissed

        get.assert_called_once_with(account_id=ACCOUNT_ID)
        dismiss.assert_called_once_with(
            notification_id="notification-1",
            body=saas.DismissNotificationReq(notification_id="notification-1", account_id=ACCOUNT_ID),
        )
