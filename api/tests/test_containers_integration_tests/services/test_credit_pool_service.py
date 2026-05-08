"""Testcontainers integration tests for CreditPoolService."""

from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from core.errors.error import QuotaExceededError
from models import TenantCreditPool
from models.enums import ProviderQuotaType
from services.credit_pool_service import CreditPoolService


class TestCreditPoolService:
    def _create_tenant_id(self) -> str:
        return str(uuid4())

    def test_create_default_pool(self, db_session_with_containers: Session):
        tenant_id = self._create_tenant_id()

        pool = CreditPoolService.create_default_pool(tenant_id)

        assert isinstance(pool, TenantCreditPool)
        assert pool.tenant_id == tenant_id
        assert pool.pool_type == ProviderQuotaType.TRIAL
        assert pool.quota_used == 0
        assert pool.quota_limit > 0

    def test_get_pool_returns_pool_when_exists(self, db_session_with_containers: Session):
        tenant_id = self._create_tenant_id()
        CreditPoolService.create_default_pool(tenant_id)

        result = CreditPoolService.get_pool(tenant_id=tenant_id, pool_type=ProviderQuotaType.TRIAL)

        assert result is not None
        assert result.tenant_id == tenant_id
        assert result.pool_type == ProviderQuotaType.TRIAL

    def test_get_pool_returns_none_when_not_exists(self, db_session_with_containers: Session):
        result = CreditPoolService.get_pool(tenant_id=self._create_tenant_id(), pool_type=ProviderQuotaType.TRIAL)

        assert result is None

    def test_check_credits_available_returns_false_when_no_pool(self, db_session_with_containers: Session):
        result = CreditPoolService.check_credits_available(tenant_id=self._create_tenant_id(), credits_required=10)

        assert result is False

    def test_check_credits_available_returns_true_when_sufficient(self, db_session_with_containers: Session):
        tenant_id = self._create_tenant_id()
        CreditPoolService.create_default_pool(tenant_id)

        result = CreditPoolService.check_credits_available(tenant_id=tenant_id, credits_required=10)

        assert result is True

    def test_check_credits_available_returns_false_when_insufficient(self, db_session_with_containers: Session):
        tenant_id = self._create_tenant_id()
        pool = CreditPoolService.create_default_pool(tenant_id)
        # Exhaust credits
        pool.quota_used = pool.quota_limit
        db_session_with_containers.commit()

        result = CreditPoolService.check_credits_available(tenant_id=tenant_id, credits_required=1)

        assert result is False

    def test_check_and_deduct_credits_raises_when_no_pool(self, db_session_with_containers: Session):
        with pytest.raises(QuotaExceededError, match="Credit pool not found"):
            CreditPoolService.check_and_deduct_credits(tenant_id=self._create_tenant_id(), credits_required=10)

    def test_check_and_deduct_credits_raises_when_no_remaining(self, db_session_with_containers: Session):
        tenant_id = self._create_tenant_id()
        pool = CreditPoolService.create_default_pool(tenant_id)
        pool.quota_used = pool.quota_limit
        db_session_with_containers.commit()

        with pytest.raises(QuotaExceededError, match="No credits remaining"):
            CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=10)

    def test_check_and_deduct_credits_deducts_required_amount(self, db_session_with_containers: Session):
        tenant_id = self._create_tenant_id()
        CreditPoolService.create_default_pool(tenant_id)
        credits_required = 10

        result = CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=credits_required)

        assert result == credits_required
        db_session_with_containers.expire_all()
        pool = CreditPoolService.get_pool(tenant_id=tenant_id)
        assert pool.quota_used == credits_required

    def test_check_and_deduct_credits_caps_at_remaining(self, db_session_with_containers: Session):
        tenant_id = self._create_tenant_id()
        pool = CreditPoolService.create_default_pool(tenant_id)
        remaining = 5
        pool.quota_used = pool.quota_limit - remaining
        db_session_with_containers.commit()

        result = CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=200)

        assert result == remaining
        db_session_with_containers.expire_all()
        updated_pool = CreditPoolService.get_pool(tenant_id=tenant_id)
        assert updated_pool.quota_used == pool.quota_limit
