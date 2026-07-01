"""Testcontainers integration tests for CreditPoolService."""

from unittest.mock import patch
from uuid import uuid4

import pytest
from flask import has_app_context
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from core.errors.error import QuotaExceededError
from models import TenantCreditPool
from models.enums import ProviderQuotaType
from services.credit_pool_service import CreditPoolService


class TestCreditPoolService:
    def _create_tenant_id(self) -> str:
        return str(uuid4())

    def _create_pool(
        self,
        db_session: Session,
        *,
        tenant_id: str,
        quota_limit: int = 10,
        quota_used: int = 0,
    ) -> None:
        pool = TenantCreditPool(
            tenant_id=tenant_id,
            pool_type=ProviderQuotaType.TRIAL,
            quota_limit=quota_limit,
            quota_used=quota_used,
        )
        db_session.add(pool)
        db_session.commit()

    def test_create_default_pool(self, db_session_with_containers: Session) -> None:
        tenant_id = self._create_tenant_id()

        pool = CreditPoolService.create_default_pool(tenant_id, db_session_with_containers)

        assert isinstance(pool, TenantCreditPool)
        assert pool.tenant_id == tenant_id
        assert pool.pool_type == ProviderQuotaType.TRIAL
        assert pool.quota_used == 0
        assert pool.quota_limit > 0

    def test_get_pool_returns_pool_when_exists(self, db_session_with_containers: Session) -> None:
        tenant_id = self._create_tenant_id()
        self._create_pool(db_session_with_containers, tenant_id=tenant_id, quota_limit=10, quota_used=0)

        result = CreditPoolService.get_pool(tenant_id=tenant_id, pool_type=ProviderQuotaType.TRIAL)

        assert result is not None
        assert result.tenant_id == tenant_id
        assert result.pool_type == ProviderQuotaType.TRIAL

    @pytest.mark.usefixtures("flask_app_with_containers")
    def test_get_pool_uses_configured_session_factory_without_flask_app_context(self) -> None:
        tenant_id = self._create_tenant_id()
        session_maker = session_factory.get_session_maker()
        with session_maker.begin() as session:
            session.add(
                TenantCreditPool(
                    tenant_id=tenant_id,
                    pool_type=ProviderQuotaType.TRIAL,
                    quota_limit=10,
                    quota_used=2,
                )
            )

        assert not has_app_context()
        result = CreditPoolService.get_pool(tenant_id=tenant_id, pool_type=ProviderQuotaType.TRIAL)

        assert result is not None
        assert result.tenant_id == tenant_id
        assert result.pool_type == ProviderQuotaType.TRIAL
        assert result.quota_used == 2

    @pytest.mark.usefixtures("flask_app_with_containers")
    def test_get_pool_returns_none_when_not_exists(self) -> None:
        result = CreditPoolService.get_pool(tenant_id=self._create_tenant_id(), pool_type=ProviderQuotaType.TRIAL)

        assert result is None

    @pytest.mark.usefixtures("flask_app_with_containers")
    def test_check_credits_available_returns_false_when_no_pool(self) -> None:
        result = CreditPoolService.check_credits_available(tenant_id=self._create_tenant_id(), credits_required=10)

        assert result is False

    def test_check_credits_available_returns_true_when_sufficient(self, db_session_with_containers: Session) -> None:
        tenant_id = self._create_tenant_id()
        self._create_pool(db_session_with_containers, tenant_id=tenant_id, quota_limit=10, quota_used=0)

        result = CreditPoolService.check_credits_available(tenant_id=tenant_id, credits_required=10)

        assert result is True

    def test_check_credits_available_returns_false_when_insufficient(self, db_session_with_containers: Session) -> None:
        tenant_id = self._create_tenant_id()
        self._create_pool(db_session_with_containers, tenant_id=tenant_id, quota_limit=10, quota_used=10)

        result = CreditPoolService.check_credits_available(tenant_id=tenant_id, credits_required=1)

        assert result is False

    @pytest.mark.usefixtures("flask_app_with_containers")
    def test_check_and_deduct_credits_raises_when_no_pool(self) -> None:
        with pytest.raises(QuotaExceededError, match="Credit pool not found"):
            CreditPoolService.check_and_deduct_credits(tenant_id=self._create_tenant_id(), credits_required=1)

    def test_check_and_deduct_credits_returns_zero_for_non_positive_request(
        self, db_session_with_containers: Session
    ) -> None:
        tenant_id = self._create_tenant_id()
        self._create_pool(db_session_with_containers, tenant_id=tenant_id, quota_limit=10, quota_used=2)

        result = CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=0)

        assert result == 0
        updated_pool = CreditPoolService.get_pool(tenant_id=tenant_id)
        assert updated_pool is not None
        assert updated_pool.quota_used == 2

    def test_check_and_deduct_credits_raises_when_no_remaining(self, db_session_with_containers: Session) -> None:
        tenant_id = self._create_tenant_id()
        self._create_pool(db_session_with_containers, tenant_id=tenant_id, quota_limit=10, quota_used=10)

        with pytest.raises(QuotaExceededError, match="No credits remaining"):
            CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=1)

        updated_pool = CreditPoolService.get_pool(tenant_id=tenant_id)
        assert updated_pool is not None
        assert updated_pool.quota_used == 10

    def test_check_and_deduct_credits_deducts_required_amount(self, db_session_with_containers: Session) -> None:
        tenant_id = self._create_tenant_id()
        self._create_pool(db_session_with_containers, tenant_id=tenant_id, quota_limit=10, quota_used=2)
        credits_required = 3

        result = CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=credits_required)

        assert result == credits_required
        pool = CreditPoolService.get_pool(tenant_id=tenant_id)
        assert pool is not None
        assert pool.quota_used == 5

    def test_check_and_deduct_credits_raises_without_deducting_when_insufficient(
        self, db_session_with_containers: Session
    ) -> None:
        tenant_id = self._create_tenant_id()
        self._create_pool(db_session_with_containers, tenant_id=tenant_id, quota_limit=10, quota_used=9)

        with pytest.raises(QuotaExceededError, match="Insufficient credits remaining"):
            CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=3)

        updated_pool = CreditPoolService.get_pool(tenant_id=tenant_id)
        assert updated_pool is not None
        assert updated_pool.quota_used == 9

    def test_check_and_deduct_credits_wraps_unexpected_deduction_errors(
        self, db_session_with_containers: Session
    ) -> None:
        tenant_id = self._create_tenant_id()
        self._create_pool(db_session_with_containers, tenant_id=tenant_id, quota_limit=10, quota_used=2)

        with (
            patch.object(CreditPoolService, "_get_locked_pool", side_effect=RuntimeError("database unavailable")),
            pytest.raises(QuotaExceededError, match="Failed to deduct credits"),
        ):
            CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=1)

        updated_pool = CreditPoolService.get_pool(tenant_id=tenant_id)
        assert updated_pool is not None
        assert updated_pool.quota_used == 2

    def test_deduct_credits_capped_depletes_available_balance(self, db_session_with_containers: Session) -> None:
        tenant_id = self._create_tenant_id()
        self._create_pool(db_session_with_containers, tenant_id=tenant_id, quota_limit=10, quota_used=9)

        result = CreditPoolService.deduct_credits_capped(tenant_id=tenant_id, credits_required=3)

        assert result == 1
        updated_pool = CreditPoolService.get_pool(tenant_id=tenant_id)
        assert updated_pool is not None
        assert updated_pool.quota_used == 10

    def test_deduct_credits_capped_returns_zero_for_non_positive_request(
        self, db_session_with_containers: Session
    ) -> None:
        tenant_id = self._create_tenant_id()
        self._create_pool(db_session_with_containers, tenant_id=tenant_id, quota_limit=10, quota_used=2)

        result = CreditPoolService.deduct_credits_capped(tenant_id=tenant_id, credits_required=0)

        assert result == 0
        updated_pool = CreditPoolService.get_pool(tenant_id=tenant_id)
        assert updated_pool is not None
        assert updated_pool.quota_used == 2

    @pytest.mark.usefixtures("flask_app_with_containers")
    def test_deduct_credits_capped_returns_zero_when_no_pool(self) -> None:
        result = CreditPoolService.deduct_credits_capped(tenant_id=self._create_tenant_id(), credits_required=1)

        assert result == 0

    def test_deduct_credits_capped_returns_zero_when_pool_is_empty(self, db_session_with_containers: Session) -> None:
        tenant_id = self._create_tenant_id()
        self._create_pool(db_session_with_containers, tenant_id=tenant_id, quota_limit=10, quota_used=10)

        result = CreditPoolService.deduct_credits_capped(tenant_id=tenant_id, credits_required=1)

        assert result == 0
        updated_pool = CreditPoolService.get_pool(tenant_id=tenant_id)
        assert updated_pool is not None
        assert updated_pool.quota_used == 10

    def test_deduct_credits_capped_wraps_unexpected_deduction_errors(self, db_session_with_containers: Session) -> None:
        tenant_id = self._create_tenant_id()
        self._create_pool(db_session_with_containers, tenant_id=tenant_id, quota_limit=10, quota_used=2)

        with (
            patch.object(CreditPoolService, "_get_locked_pool", side_effect=RuntimeError("database unavailable")),
            pytest.raises(QuotaExceededError, match="Failed to deduct credits"),
        ):
            CreditPoolService.deduct_credits_capped(tenant_id=tenant_id, credits_required=1)

        updated_pool = CreditPoolService.get_pool(tenant_id=tenant_id)
        assert updated_pool is not None
        assert updated_pool.quota_used == 2

    def test_deduct_credits_capped_reraises_quota_exceeded_errors(self, db_session_with_containers: Session) -> None:
        tenant_id = self._create_tenant_id()
        self._create_pool(db_session_with_containers, tenant_id=tenant_id, quota_limit=10, quota_used=2)

        with (
            patch.object(CreditPoolService, "_get_locked_pool", side_effect=QuotaExceededError("quota unavailable")),
            pytest.raises(QuotaExceededError, match="quota unavailable"),
        ):
            CreditPoolService.deduct_credits_capped(tenant_id=tenant_id, credits_required=1)

        updated_pool = CreditPoolService.get_pool(tenant_id=tenant_id)
        assert updated_pool is not None
        assert updated_pool.quota_used == 2
