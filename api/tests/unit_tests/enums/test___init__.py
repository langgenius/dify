"""Unit tests for QuotaType, QuotaService, and QuotaCharge."""

from collections.abc import Callable
from unittest.mock import patch

import httpx
import pytest

from enums import DeploymentEdition, QuotaType
from services.billing_client import billing
from services.errors.billing import BillingUpstreamInvalidResponseError, BillingUpstreamUnavailableError
from services.quota_service import QuotaCharge, QuotaService, unlimited


def _feature(*, limit: int, usage: int) -> billing.QuotaFeatureInfo:
    return billing.QuotaFeatureInfo(usage=usage, limit=limit, reset_date=0)


def _quota_info(*, trigger_event: billing.QuotaFeatureInfo) -> billing.QuotaGetInfoReply:
    return billing.QuotaGetInfoReply(trigger_event=trigger_event, api_rate_limit=_feature(limit=0, usage=0))


class TestQuotaType:
    def test_billing_key_trigger(self) -> None:
        assert QuotaType.TRIGGER.billing_key == "trigger_event"

    def test_billing_key_workflow(self) -> None:
        assert QuotaType.WORKFLOW.billing_key == "api_rate_limit"

    def test_billing_key_unlimited_raises(self) -> None:
        with pytest.raises(ValueError, match="Invalid quota type"):
            _ = QuotaType.UNLIMITED.billing_key


class TestQuotaService:
    @pytest.fixture(autouse=True)
    def _cloud_edition(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)

    def test_reserve_outside_cloud_edition(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        with patch("services.billing_service.BillingService"):
            charge = QuotaService.reserve(QuotaType.TRIGGER, "t1")
            assert charge.success is True
            assert charge.charge_id is None

    def test_reserve_zero_amount_raises(self) -> None:
        with pytest.raises(ValueError, match="greater than 0"):
            QuotaService.reserve(QuotaType.TRIGGER, "t1", amount=0)

    def test_reserve_success(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.quota_reserve.return_value = billing.QuotaReserveReply(
                reservation_id="rid-1", available=99, reserved=1
            )

            charge = QuotaService.reserve(QuotaType.TRIGGER, "t1", amount=1)

            assert charge.success is True
            assert charge.charge_id == "rid-1"
            assert charge._tenant_id == "t1"
            assert charge._feature_key == "trigger_event"
            assert charge._amount == 1
            mock_bs.quota_reserve.assert_called_once()

    def test_reserve_no_reservation_id_raises(self) -> None:
        from services.errors.app import QuotaExceededError

        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.quota_reserve.return_value = billing.QuotaReserveReply(reservation_id="", available=0, reserved=0)

            with pytest.raises(QuotaExceededError):
                QuotaService.reserve(QuotaType.TRIGGER, "t1")

    def test_reserve_quota_exceeded_propagates(self) -> None:
        from services.errors.app import QuotaExceededError

        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.quota_reserve.side_effect = QuotaExceededError(feature="trigger", tenant_id="t1", required=1)

            with pytest.raises(QuotaExceededError):
                QuotaService.reserve(QuotaType.TRIGGER, "t1")

    @pytest.mark.parametrize(
        "error",
        [
            BillingUpstreamInvalidResponseError("POST /quota/reserve returned 400"),
            BillingUpstreamUnavailableError("POST /quota/reserve returned 503"),
        ],
    )
    def test_reserve_billing_error_answer_propagates(self, error: Exception) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.quota_reserve.side_effect = error

            with pytest.raises(type(error)):
                QuotaService.reserve(QuotaType.TRIGGER, "t1")

    def test_reserve_unreachable_billing_returns_unlimited(self) -> None:
        error = BillingUpstreamUnavailableError("POST /quota/reserve failed")
        error.__cause__ = httpx.ConnectError("connection refused")
        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.quota_reserve.side_effect = error

            charge = QuotaService.reserve(QuotaType.TRIGGER, "t1")
            assert charge.success is True
            assert charge.charge_id is None

    def test_reserve_api_exception_returns_unlimited(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.quota_reserve.side_effect = RuntimeError("network")

            charge = QuotaService.reserve(QuotaType.TRIGGER, "t1")
            assert charge.success is True
            assert charge.charge_id is None

    def test_consume_calls_reserve_and_commit(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.quota_reserve.return_value = billing.QuotaReserveReply(
                reservation_id="rid-c", available=9, reserved=1
            )
            mock_bs.quota_commit.return_value = billing.QuotaCommitReply(available=9, reserved=0, refunded=0)

            charge = QuotaService.consume(QuotaType.TRIGGER, "t1")
            assert charge.success is True
            mock_bs.quota_commit.assert_called_once()

    def test_check_outside_cloud_edition(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        assert QuotaService.check(QuotaType.TRIGGER, "t1") is True

    def test_check_zero_amount_raises(self) -> None:
        with pytest.raises(ValueError, match="greater than 0"):
            QuotaService.check(QuotaType.TRIGGER, "t1", amount=0)

    def test_check_sufficient_quota(self) -> None:
        with patch.object(QuotaService, "get_remaining", return_value=100):
            assert QuotaService.check(QuotaType.TRIGGER, "t1", amount=50) is True

    def test_check_insufficient_quota(self) -> None:
        with patch.object(QuotaService, "get_remaining", return_value=5):
            assert QuotaService.check(QuotaType.TRIGGER, "t1", amount=10) is False

    def test_check_unlimited_quota(self) -> None:
        with patch.object(QuotaService, "get_remaining", return_value=-1):
            assert QuotaService.check(QuotaType.TRIGGER, "t1", amount=999) is True

    def test_check_exception_returns_true(self) -> None:
        with patch.object(QuotaService, "get_remaining", side_effect=RuntimeError):
            assert QuotaService.check(QuotaType.TRIGGER, "t1") is True

    def test_release_outside_cloud_edition(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        with patch("services.billing_service.BillingService") as mock_bs:
            QuotaService.release(QuotaType.TRIGGER, "rid-1", "t1", "trigger_event")
            mock_bs.quota_release.assert_not_called()

    def test_release_empty_reservation(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            QuotaService.release(QuotaType.TRIGGER, "", "t1", "trigger_event")
            mock_bs.quota_release.assert_not_called()

    def test_release_success(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.quota_release.return_value = billing.QuotaReleaseReply(available=10, reserved=0, released=1)
            QuotaService.release(QuotaType.TRIGGER, "rid-1", "t1", "trigger_event")
            mock_bs.quota_release.assert_called_once_with(
                tenant_id="t1", feature_key="trigger_event", reservation_id="rid-1"
            )

    def test_release_exception_swallowed(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.quota_release.side_effect = RuntimeError("fail")
            QuotaService.release(QuotaType.TRIGGER, "rid-1", "t1", "trigger_event")

    def test_get_remaining_normal(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.get_quota_info.return_value = _quota_info(trigger_event=_feature(limit=100, usage=30))
            assert QuotaService.get_remaining(QuotaType.TRIGGER, "t1") == 70

    def test_get_remaining_unlimited(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.get_quota_info.return_value = _quota_info(trigger_event=_feature(limit=-1, usage=0))
            assert QuotaService.get_remaining(QuotaType.TRIGGER, "t1") == -1

    def test_get_remaining_over_limit_returns_zero(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.get_quota_info.return_value = _quota_info(trigger_event=_feature(limit=10, usage=15))
            assert QuotaService.get_remaining(QuotaType.TRIGGER, "t1") == 0

    def test_get_remaining_exception_returns_neg1(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.get_quota_info.side_effect = RuntimeError
            assert QuotaService.get_remaining(QuotaType.TRIGGER, "t1") == -1


class TestQuotaCharge:
    def test_commit_success(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.quota_commit.return_value = billing.QuotaCommitReply(available=9, reserved=0, refunded=0)
            charge = QuotaCharge(
                success=True,
                charge_id="rid-1",
                _quota_type=QuotaType.TRIGGER,
                _tenant_id="t1",
                _feature_key="trigger_event",
                _amount=1,
            )
            charge.commit()
            mock_bs.quota_commit.assert_called_once_with(
                tenant_id="t1",
                feature_key="trigger_event",
                reservation_id="rid-1",
                actual_amount=1,
            )
            assert charge._committed is True

    def test_commit_with_actual_amount(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.quota_commit.return_value = billing.QuotaCommitReply(available=9, reserved=0, refunded=0)
            charge = QuotaCharge(
                success=True,
                charge_id="rid-1",
                _quota_type=QuotaType.TRIGGER,
                _tenant_id="t1",
                _feature_key="trigger_event",
                _amount=10,
            )
            charge.commit(actual_amount=5)
            call_kwargs = mock_bs.quota_commit.call_args[1]
            assert call_kwargs["actual_amount"] == 5

    def test_commit_idempotent(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.quota_commit.return_value = billing.QuotaCommitReply(available=9, reserved=0, refunded=0)
            charge = QuotaCharge(
                success=True,
                charge_id="rid-1",
                _quota_type=QuotaType.TRIGGER,
                _tenant_id="t1",
                _feature_key="trigger_event",
                _amount=1,
            )
            charge.commit()
            charge.commit()
            assert mock_bs.quota_commit.call_count == 1

    def test_commit_no_charge_id_noop(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            charge = QuotaCharge(success=True, charge_id=None, _quota_type=QuotaType.TRIGGER)
            charge.commit()
            mock_bs.quota_commit.assert_not_called()

    def test_commit_no_tenant_id_noop(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            charge = QuotaCharge(
                success=True,
                charge_id="rid-1",
                _quota_type=QuotaType.TRIGGER,
                _tenant_id=None,
                _feature_key="trigger_event",
            )
            charge.commit()
            mock_bs.quota_commit.assert_not_called()

    def test_commit_exception_swallowed(self) -> None:
        with patch("services.billing_service.BillingService") as mock_bs:
            mock_bs.quota_commit.side_effect = RuntimeError("fail")
            charge = QuotaCharge(
                success=True,
                charge_id="rid-1",
                _quota_type=QuotaType.TRIGGER,
                _tenant_id="t1",
                _feature_key="trigger_event",
                _amount=1,
            )
            charge.commit()

    def test_refund_success(self) -> None:
        with patch.object(QuotaService, "release") as mock_rel:
            charge = QuotaCharge(
                success=True,
                charge_id="rid-1",
                _quota_type=QuotaType.TRIGGER,
                _tenant_id="t1",
                _feature_key="trigger_event",
            )
            charge.refund()
            mock_rel.assert_called_once_with(QuotaType.TRIGGER, "rid-1", "t1", "trigger_event")

    def test_refund_no_charge_id_noop(self) -> None:
        with patch.object(QuotaService, "release") as mock_rel:
            charge = QuotaCharge(success=True, charge_id=None, _quota_type=QuotaType.TRIGGER)
            charge.refund()
            mock_rel.assert_not_called()

    def test_refund_no_tenant_id_noop(self) -> None:
        with patch.object(QuotaService, "release") as mock_rel:
            charge = QuotaCharge(
                success=True,
                charge_id="rid-1",
                _quota_type=QuotaType.TRIGGER,
                _tenant_id=None,
            )
            charge.refund()
            mock_rel.assert_not_called()


class TestUnlimited:
    def test_unlimited_returns_success_with_no_charge_id(self) -> None:
        charge = unlimited()
        assert charge.success is True
        assert charge.charge_id is None
        assert charge._quota_type == QuotaType.UNLIMITED
