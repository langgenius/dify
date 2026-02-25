from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import services.credit_pool_service as credit_pool_service_module
from core.errors.error import QuotaExceededError
from models import TenantCreditPool
from services.credit_pool_service import CreditPoolService


class TestCreditPoolService:
    def test_should_create_default_pool_with_trial_type_and_configured_quota(self):
        """Test create_default_pool persists a trial pool using configured hosted credits."""
        tenant_id = "tenant-123"
        hosted_pool_credits = 5000

        with (
            patch.object(credit_pool_service_module.dify_config, "HOSTED_POOL_CREDITS", hosted_pool_credits),
            patch.object(credit_pool_service_module, "db") as mock_db,
        ):
            pool = CreditPoolService.create_default_pool(tenant_id)

        assert isinstance(pool, TenantCreditPool)
        assert pool.tenant_id == tenant_id
        assert pool.pool_type == "trial"
        assert pool.quota_limit == hosted_pool_credits
        assert pool.quota_used == 0
        mock_db.session.add.assert_called_once_with(pool)
        mock_db.session.commit.assert_called_once()

    def test_should_return_first_pool_from_query_when_get_pool_called(self):
        """Test get_pool queries by tenant and pool_type and returns first result."""
        tenant_id = "tenant-123"
        pool_type = "enterprise"
        expected_pool = MagicMock(spec=TenantCreditPool)

        with patch.object(credit_pool_service_module, "db") as mock_db:
            query = mock_db.session.query.return_value
            filtered_query = query.filter_by.return_value
            filtered_query.first.return_value = expected_pool

            result = CreditPoolService.get_pool(tenant_id=tenant_id, pool_type=pool_type)

        assert result == expected_pool
        mock_db.session.query.assert_called_once_with(TenantCreditPool)
        query.filter_by.assert_called_once_with(tenant_id=tenant_id, pool_type=pool_type)
        filtered_query.first.assert_called_once()

    def test_should_return_false_when_pool_not_found_in_check_credits_available(self):
        """Test check_credits_available returns False when tenant has no pool."""
        with patch.object(CreditPoolService, "get_pool", return_value=None) as mock_get_pool:
            result = CreditPoolService.check_credits_available(tenant_id="tenant-123", credits_required=10)

        assert result is False
        mock_get_pool.assert_called_once_with("tenant-123", "trial")

    def test_should_return_true_when_remaining_credits_cover_required_amount(self):
        """Test check_credits_available returns True when remaining credits are sufficient."""
        pool = SimpleNamespace(remaining_credits=100)

        with patch.object(CreditPoolService, "get_pool", return_value=pool) as mock_get_pool:
            result = CreditPoolService.check_credits_available(tenant_id="tenant-123", credits_required=60)

        assert result is True
        mock_get_pool.assert_called_once_with("tenant-123", "trial")

    def test_should_return_false_when_remaining_credits_are_insufficient(self):
        """Test check_credits_available returns False when required credits exceed remaining credits."""
        pool = SimpleNamespace(remaining_credits=30)

        with patch.object(CreditPoolService, "get_pool", return_value=pool):
            result = CreditPoolService.check_credits_available(tenant_id="tenant-123", credits_required=60)

        assert result is False

    def test_should_raise_quota_exceeded_when_pool_not_found_in_check_and_deduct(self):
        """Test check_and_deduct_credits raises when tenant credit pool does not exist."""
        with patch.object(CreditPoolService, "get_pool", return_value=None):
            with pytest.raises(QuotaExceededError, match="Credit pool not found"):
                CreditPoolService.check_and_deduct_credits(tenant_id="tenant-123", credits_required=10)

    def test_should_raise_quota_exceeded_when_pool_has_no_remaining_credits(self):
        """Test check_and_deduct_credits raises when remaining credits are zero or negative."""
        pool = SimpleNamespace(remaining_credits=0)

        with patch.object(CreditPoolService, "get_pool", return_value=pool):
            with pytest.raises(QuotaExceededError, match="No credits remaining"):
                CreditPoolService.check_and_deduct_credits(tenant_id="tenant-123", credits_required=10)

    def test_should_deduct_minimum_of_required_and_remaining_credits(self):
        """Test check_and_deduct_credits updates quota_used by the actual deducted amount."""
        tenant_id = "tenant-123"
        pool_type = "trial"
        credits_required = 200
        remaining_credits = 120
        expected_deducted_credits = 120

        pool = SimpleNamespace(remaining_credits=remaining_credits)
        fake_engine = MagicMock()
        session = MagicMock()
        session_context = MagicMock()
        session_context.__enter__.return_value = session
        session_context.__exit__.return_value = None

        with (
            patch.object(CreditPoolService, "get_pool", return_value=pool),
            patch.object(credit_pool_service_module, "db", new=SimpleNamespace(engine=fake_engine)),
            patch.object(credit_pool_service_module, "Session", return_value=session_context) as mock_session_class,
        ):
            result = CreditPoolService.check_and_deduct_credits(
                tenant_id=tenant_id,
                credits_required=credits_required,
                pool_type=pool_type,
            )

        assert result == expected_deducted_credits
        mock_session_class.assert_called_once_with(fake_engine)
        session.execute.assert_called_once()
        session.commit.assert_called_once()

        stmt = session.execute.call_args.args[0]
        compiled_params = stmt.compile().params
        assert tenant_id in compiled_params.values()
        assert pool_type in compiled_params.values()
        assert expected_deducted_credits in compiled_params.values()

    def test_should_raise_quota_exceeded_when_deduction_update_fails(self):
        """Test check_and_deduct_credits translates DB update failures to QuotaExceededError."""
        pool = SimpleNamespace(remaining_credits=50)
        fake_engine = MagicMock()
        session = MagicMock()
        session.execute.side_effect = Exception("db failure")
        session_context = MagicMock()
        session_context.__enter__.return_value = session
        session_context.__exit__.return_value = None

        with (
            patch.object(CreditPoolService, "get_pool", return_value=pool),
            patch.object(credit_pool_service_module, "db", new=SimpleNamespace(engine=fake_engine)),
            patch.object(credit_pool_service_module, "Session", return_value=session_context),
            patch.object(credit_pool_service_module, "logger") as mock_logger,
        ):
            with pytest.raises(QuotaExceededError, match="Failed to deduct credits"):
                CreditPoolService.check_and_deduct_credits(tenant_id="tenant-123", credits_required=10)

        session.commit.assert_not_called()
        mock_logger.exception.assert_called_once()
