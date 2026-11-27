"""Credit-pool accounting tests against the billing quota API."""

from unittest.mock import patch
from uuid import UUID

import pytest

from core.app.entities.app_invoke_entities import CreditUsageCreatedBy
from core.credit_usage import CreditUsageAppType
from core.errors.error import InsufficientHostedCreditsError
from models.enums import ProviderQuotaType
from services.billing_client import billing
from services.credit_pool_service import (
    FEATURE_KEY_CREDIT_POOL,
    CreditPoolBalance,
    CreditPoolReservationState,
    CreditPoolService,
)


def test_credit_pool_balance_unlimited_remaining_and_sufficiency() -> None:
    pool = CreditPoolBalance(tenant_id="tenant-1", pool_type="paid", quota_limit=-1, quota_used=999)

    assert pool.remaining_credits == -1
    assert pool.has_sufficient_credits(10_000)


def test_credit_pool_balance_clamps_remaining_at_zero() -> None:
    pool = CreditPoolBalance(tenant_id="tenant-1", pool_type="trial", quota_limit=10, quota_used=12)

    assert pool.remaining_credits == 0
    assert pool.has_sufficient_credits(1) is False


def test_get_pool_reads_billing_quota_balance() -> None:
    with patch("services.billing_service.BillingService.quota_get_balance") as quota_get_balance:
        quota_get_balance.return_value = billing.QuotaGetBalanceReply(
            quota=1000, usage=250, available=750, reserved=0, exhausted_at=1748908800
        )

        pool = CreditPoolService.get_pool(tenant_id="tenant-1", pool_type=ProviderQuotaType.PAID)

    assert pool == CreditPoolBalance(
        tenant_id="tenant-1",
        pool_type="paid",
        quota_limit=1000,
        quota_used=250,
        exhausted_at=1748908800,
    )
    quota_get_balance.assert_called_once_with(
        tenant_id="tenant-1",
        feature_key=FEATURE_KEY_CREDIT_POOL,
        bucket="paid",
    )


@pytest.mark.parametrize(
    ("attribution", "expected_app_type", "expected_created_by"),
    [
        ({}, "unknown", "unknown"),
        (
            {"app_type": CreditUsageAppType.WORKFLOW, "created_by": CreditUsageCreatedBy.EVALUATION},
            "workflow",
            "evaluation",
        ),
    ],
)
def test_reserve_credits_commits_billing_reservation_once(
    attribution: dict[str, str], expected_app_type: str, expected_created_by: str
) -> None:
    with (
        patch("services.billing_service.BillingService.quota_reserve") as quota_reserve,
        patch("services.billing_service.BillingService.quota_commit") as quota_commit,
        patch("services.billing_service.BillingService.quota_release") as quota_release,
    ):
        quota_reserve.return_value = billing.QuotaReserveReply(reservation_id="reservation-1", available=7, reserved=3)

        reservation = CreditPoolService.reserve_credits(
            tenant_id="tenant-1",
            credits_required=3,
            pool_type=ProviderQuotaType.TRIAL,
            request_id="request-1",
            meta={"source": "test", **attribution},
        )
        reservation.commit()
        reservation.commit()
        reservation.release()

    assert reservation.state == CreditPoolReservationState.COMMITTED
    expected_metadata = {
        "source": "test",
        "created_by": expected_created_by,
        "app_type": expected_app_type,
    }
    quota_reserve.assert_called_once_with(
        tenant_id="tenant-1",
        feature_key=FEATURE_KEY_CREDIT_POOL,
        bucket="trial",
        request_id="request-1",
        amount=3,
        meta=expected_metadata,
    )
    quota_commit.assert_called_once_with(
        tenant_id="tenant-1",
        feature_key=FEATURE_KEY_CREDIT_POOL,
        bucket="trial",
        reservation_id="reservation-1",
        actual_amount=3,
        meta={**expected_metadata, "request_id": "request-1"},
    )
    quota_release.assert_not_called()


def test_reserve_credits_releases_billing_reservation() -> None:
    with (
        patch("services.billing_service.BillingService.quota_reserve") as quota_reserve,
        patch("services.billing_service.BillingService.quota_release") as quota_release,
    ):
        quota_reserve.return_value = billing.QuotaReserveReply(reservation_id="reservation-1", available=7, reserved=3)

        reservation = CreditPoolService.reserve_credits(
            tenant_id="tenant-1",
            credits_required=3,
            request_id="request-1",
        )
        reservation.release()
        reservation.release()

    assert reservation.state == CreditPoolReservationState.RELEASED
    quota_release.assert_called_once_with(
        tenant_id="tenant-1",
        feature_key=FEATURE_KEY_CREDIT_POOL,
        bucket="trial",
        reservation_id="reservation-1",
    )


def test_billing_outage_does_not_permit_an_unreserved_hosted_call() -> None:
    """Only catalog reads may degrade; a live charge still requires a successful reservation."""
    with (
        patch.object(billing, "quota_reserve", side_effect=billing.BillingQuotaUpstreamUnavailableError()),
        pytest.raises(billing.BillingQuotaUpstreamUnavailableError),
    ):
        CreditPoolService.reserve_credits("tenant-1", 1, "paid", request_id="request-1")


def test_reserve_credits_raises_when_billing_has_no_reservation() -> None:
    with patch("services.billing_service.BillingService.quota_reserve") as quota_reserve:
        quota_reserve.return_value = billing.QuotaReserveReply(reservation_id="", available=1, reserved=0)

        with pytest.raises(InsufficientHostedCreditsError, match="Insufficient credits remaining"):
            CreditPoolService.reserve_credits(tenant_id="tenant-1", credits_required=3, request_id="request-1")


@pytest.mark.parametrize("credits_required", [0, -1])
def test_reserve_credits_rejects_non_positive_amount(credits_required: int) -> None:
    with pytest.raises(ValueError, match="credits_required must be greater than 0"):
        CreditPoolService.reserve_credits(tenant_id="tenant-1", credits_required=credits_required, request_id="r-1")


def test_reserve_credits_requires_a_request_id() -> None:
    with pytest.raises(ValueError, match="request_id is required"):
        CreditPoolService.reserve_credits(tenant_id="tenant-1", credits_required=3, request_id="")


def test_reservation_rejects_commit_after_release() -> None:
    with (
        patch("services.billing_service.BillingService.quota_reserve") as quota_reserve,
        patch("services.billing_service.BillingService.quota_release"),
    ):
        quota_reserve.return_value = billing.QuotaReserveReply(reservation_id="reservation-1", available=7, reserved=3)
        reservation = CreditPoolService.reserve_credits(
            tenant_id="tenant-1", credits_required=3, request_id="request-1"
        )
        reservation.release()

        with pytest.raises(RuntimeError, match="Cannot commit a released credit reservation."):
            reservation.commit()


@pytest.mark.parametrize("credits_required", [0, -1])
def test_deduct_credits_capped_skips_billing_for_non_positive_request(credits_required: int) -> None:
    with patch("services.billing_service.BillingService.quota_consume_capped") as quota_consume_capped:
        result = CreditPoolService.deduct_credits_capped(
            tenant_id="tenant-1",
            credits_required=credits_required,
        )

    assert result == 0
    quota_consume_capped.assert_not_called()


def test_deduct_credits_capped_uses_billing_consume_capped() -> None:
    with patch("services.billing_service.BillingService.quota_consume_capped") as quota_consume_capped:
        quota_consume_capped.return_value = billing.QuotaConsumeCappedReply(
            deducted=2, available=0, reserved=0, quota=10, usage=10
        )

        result = CreditPoolService.deduct_credits_capped(
            tenant_id="tenant-1",
            credits_required=5,
            pool_type=ProviderQuotaType.PAID,
            request_id="message-1",
            metadata={
                "provider": "openai",
                "model": "gpt-4o",
                "app_type": CreditUsageAppType.CHATBOT,
                "created_by": CreditUsageCreatedBy.APP,
            },
        )

    assert result == 2
    quota_consume_capped.assert_called_once_with(
        tenant_id="tenant-1",
        feature_key=FEATURE_KEY_CREDIT_POOL,
        bucket="paid",
        request_id="message-1",
        amount=5,
        meta={
            "source": "credit_pool.deduct_capped",
            "provider": "openai",
            "model": "gpt-4o",
            "app_type": CreditUsageAppType.CHATBOT.value,
            "created_by": CreditUsageCreatedBy.APP.value,
        },
    )


def test_deduct_credits_capped_generates_a_request_id_when_absent() -> None:
    with patch("services.billing_service.BillingService.quota_consume_capped") as quota_consume_capped:
        quota_consume_capped.return_value = billing.QuotaConsumeCappedReply(
            deducted=1, available=0, reserved=0, quota=1, usage=1
        )

        CreditPoolService.deduct_credits_capped(tenant_id="tenant-1", credits_required=1)

    generated_request_id = quota_consume_capped.call_args.kwargs["request_id"]
    assert str(UUID(generated_request_id)) == generated_request_id
    assert quota_consume_capped.call_args.kwargs["bucket"] == "trial"
