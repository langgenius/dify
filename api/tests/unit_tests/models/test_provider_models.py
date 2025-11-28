"""
Comprehensive unit tests for Provider models.

This test suite covers:
- ProviderType and ProviderQuotaType enum validation
- Provider model creation and properties
- ProviderModel credential management
- TenantDefaultModel configuration
- TenantPreferredModelProvider settings
- ProviderOrder payment tracking
- ProviderModelSetting load balancing
- LoadBalancingModelConfig management
- ProviderCredential storage
- ProviderModelCredential storage
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from models.provider import (
    LoadBalancingModelConfig,
    Provider,
    ProviderCredential,
    ProviderModel,
    ProviderModelCredential,
    ProviderModelSetting,
    ProviderOrder,
    ProviderQuotaType,
    ProviderType,
    TenantDefaultModel,
    TenantPreferredModelProvider,
)


class TestProviderTypeEnum:
    """Test suite for ProviderType enum validation."""

    def test_provider_type_custom_value(self):
        """Test ProviderType CUSTOM enum value."""
        # Assert
        assert ProviderType.CUSTOM.value == "custom"

    def test_provider_type_system_value(self):
        """Test ProviderType SYSTEM enum value."""
        # Assert
        assert ProviderType.SYSTEM.value == "system"

    def test_provider_type_value_of_custom(self):
        """Test ProviderType.value_of returns CUSTOM for 'custom' string."""
        # Act
        result = ProviderType.value_of("custom")

        # Assert
        assert result == ProviderType.CUSTOM

    def test_provider_type_value_of_system(self):
        """Test ProviderType.value_of returns SYSTEM for 'system' string."""
        # Act
        result = ProviderType.value_of("system")

        # Assert
        assert result == ProviderType.SYSTEM

    def test_provider_type_value_of_invalid_raises_error(self):
        """Test ProviderType.value_of raises ValueError for invalid value."""
        # Act & Assert
        with pytest.raises(ValueError, match="No matching enum found"):
            ProviderType.value_of("invalid_type")

    def test_provider_type_iteration(self):
        """Test iterating over ProviderType enum members."""
        # Act
        members = list(ProviderType)

        # Assert
        assert len(members) == 2
        assert ProviderType.CUSTOM in members
        assert ProviderType.SYSTEM in members


class TestProviderQuotaTypeEnum:
    """Test suite for ProviderQuotaType enum validation."""

    def test_provider_quota_type_paid_value(self):
        """Test ProviderQuotaType PAID enum value."""
        # Assert
        assert ProviderQuotaType.PAID.value == "paid"

    def test_provider_quota_type_free_value(self):
        """Test ProviderQuotaType FREE enum value."""
        # Assert
        assert ProviderQuotaType.FREE.value == "free"

    def test_provider_quota_type_trial_value(self):
        """Test ProviderQuotaType TRIAL enum value."""
        # Assert
        assert ProviderQuotaType.TRIAL.value == "trial"

    def test_provider_quota_type_value_of_paid(self):
        """Test ProviderQuotaType.value_of returns PAID for 'paid' string."""
        # Act
        result = ProviderQuotaType.value_of("paid")

        # Assert
        assert result == ProviderQuotaType.PAID

    def test_provider_quota_type_value_of_free(self):
        """Test ProviderQuotaType.value_of returns FREE for 'free' string."""
        # Act
        result = ProviderQuotaType.value_of("free")

        # Assert
        assert result == ProviderQuotaType.FREE

    def test_provider_quota_type_value_of_trial(self):
        """Test ProviderQuotaType.value_of returns TRIAL for 'trial' string."""
        # Act
        result = ProviderQuotaType.value_of("trial")

        # Assert
        assert result == ProviderQuotaType.TRIAL

    def test_provider_quota_type_value_of_invalid_raises_error(self):
        """Test ProviderQuotaType.value_of raises ValueError for invalid value."""
        # Act & Assert
        with pytest.raises(ValueError, match="No matching enum found"):
            ProviderQuotaType.value_of("invalid_quota")

    def test_provider_quota_type_iteration(self):
        """Test iterating over ProviderQuotaType enum members."""
        # Act
        members = list(ProviderQuotaType)

        # Assert
        assert len(members) == 3
        assert ProviderQuotaType.PAID in members
        assert ProviderQuotaType.FREE in members
        assert ProviderQuotaType.TRIAL in members


class TestProviderModel:
    """Test suite for Provider model validation and operations."""

    def test_provider_creation_with_required_fields(self):
        """Test creating a provider with all required fields."""
        # Arrange
        tenant_id = str(uuid4())
        provider_name = "openai"

        # Act
        provider = Provider(
            tenant_id=tenant_id,
            provider_name=provider_name,
        )

        # Assert
        assert provider.tenant_id == tenant_id
        assert provider.provider_name == provider_name
        assert provider.provider_type == "custom"
        assert provider.is_valid is False
        assert provider.quota_used == 0

    def test_provider_creation_with_all_fields(self):
        """Test creating a provider with all optional fields."""
        # Arrange
        tenant_id = str(uuid4())
        credential_id = str(uuid4())

        # Act
        provider = Provider(
            tenant_id=tenant_id,
            provider_name="anthropic",
            provider_type="system",
            is_valid=True,
            credential_id=credential_id,
            quota_type="paid",
            quota_limit=10000,
            quota_used=500,
        )

        # Assert
        assert provider.tenant_id == tenant_id
        assert provider.provider_name == "anthropic"
        assert provider.provider_type == "system"
        assert provider.is_valid is True
        assert provider.credential_id == credential_id
        assert provider.quota_type == "paid"
        assert provider.quota_limit == 10000
        assert provider.quota_used == 500

    def test_provider_default_values(self):
        """Test provider default values are set correctly."""
        # Arrange & Act
        provider = Provider(
            tenant_id=str(uuid4()),
            provider_name="test_provider",
        )

        # Assert
        assert provider.provider_type == "custom"
        assert provider.is_valid is False
        assert provider.quota_type == ""
        assert provider.quota_limit is None
        assert provider.quota_used == 0
        assert provider.credential_id is None

    def test_provider_repr(self):
        """Test provider __repr__ method."""
        # Arrange
        tenant_id = str(uuid4())
        provider = Provider(
            tenant_id=tenant_id,
            provider_name="openai",
            provider_type="custom",
        )

        # Act
        repr_str = repr(provider)

        # Assert
        assert "Provider" in repr_str
        assert "openai" in repr_str
        assert "custom" in repr_str

    def test_provider_token_is_set_false_when_no_credential(self):
        """Test token_is_set returns False when no credential."""
        # Arrange
        provider = Provider(
            tenant_id=str(uuid4()),
            provider_name="openai",
        )

        # Act & Assert
        assert provider.token_is_set is False

    def test_provider_is_enabled_false_when_not_valid(self):
        """Test is_enabled returns False when provider is not valid."""
        # Arrange
        provider = Provider(
            tenant_id=str(uuid4()),
            provider_name="openai",
            is_valid=False,
        )

        # Act & Assert
        assert provider.is_enabled is False

    def test_provider_is_enabled_true_for_valid_system_provider(self):
        """Test is_enabled returns True for valid system provider."""
        # Arrange
        provider = Provider(
            tenant_id=str(uuid4()),
            provider_name="openai",
            provider_type=ProviderType.SYSTEM.value,
            is_valid=True,
        )

        # Act & Assert
        assert provider.is_enabled is True

    def test_provider_quota_tracking(self):
        """Test provider quota tracking fields."""
        # Arrange
        provider = Provider(
            tenant_id=str(uuid4()),
            provider_name="openai",
            quota_type="trial",
            quota_limit=1000,
            quota_used=250,
        )

        # Assert
        assert provider.quota_type == "trial"
        assert provider.quota_limit == 1000
        assert provider.quota_used == 250
        remaining = provider.quota_limit - provider.quota_used
        assert remaining == 750


class TestProviderModelEntity:
    """Test suite for ProviderModel entity validation."""

    def test_provider_model_creation_with_required_fields(self):
        """Test creating a provider model with required fields."""
        # Arrange
        tenant_id = str(uuid4())

        # Act
        provider_model = ProviderModel(
            tenant_id=tenant_id,
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
        )

        # Assert
        assert provider_model.tenant_id == tenant_id
        assert provider_model.provider_name == "openai"
        assert provider_model.model_name == "gpt-4"
        assert provider_model.model_type == "llm"
        assert provider_model.is_valid is False

    def test_provider_model_with_credential(self):
        """Test provider model with credential ID."""
        # Arrange
        credential_id = str(uuid4())

        # Act
        provider_model = ProviderModel(
            tenant_id=str(uuid4()),
            provider_name="anthropic",
            model_name="claude-3",
            model_type="llm",
            credential_id=credential_id,
            is_valid=True,
        )

        # Assert
        assert provider_model.credential_id == credential_id
        assert provider_model.is_valid is True

    def test_provider_model_default_values(self):
        """Test provider model default values."""
        # Arrange & Act
        provider_model = ProviderModel(
            tenant_id=str(uuid4()),
            provider_name="openai",
            model_name="gpt-3.5-turbo",
            model_type="llm",
        )

        # Assert
        assert provider_model.is_valid is False
        assert provider_model.credential_id is None

    def test_provider_model_different_types(self):
        """Test provider model with different model types."""
        # Arrange
        tenant_id = str(uuid4())

        # Act - LLM type
        llm_model = ProviderModel(
            tenant_id=tenant_id,
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
        )

        # Act - Embedding type
        embedding_model = ProviderModel(
            tenant_id=tenant_id,
            provider_name="openai",
            model_name="text-embedding-ada-002",
            model_type="text-embedding",
        )

        # Act - Speech2Text type
        speech_model = ProviderModel(
            tenant_id=tenant_id,
            provider_name="openai",
            model_name="whisper-1",
            model_type="speech2text",
        )

        # Assert
        assert llm_model.model_type == "llm"
        assert embedding_model.model_type == "text-embedding"
        assert speech_model.model_type == "speech2text"


class TestTenantDefaultModel:
    """Test suite for TenantDefaultModel configuration."""

    def test_tenant_default_model_creation(self):
        """Test creating a tenant default model."""
        # Arrange
        tenant_id = str(uuid4())

        # Act
        default_model = TenantDefaultModel(
            tenant_id=tenant_id,
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
        )

        # Assert
        assert default_model.tenant_id == tenant_id
        assert default_model.provider_name == "openai"
        assert default_model.model_name == "gpt-4"
        assert default_model.model_type == "llm"

    def test_tenant_default_model_for_different_types(self):
        """Test tenant default models for different model types."""
        # Arrange
        tenant_id = str(uuid4())

        # Act
        llm_default = TenantDefaultModel(
            tenant_id=tenant_id,
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
        )

        embedding_default = TenantDefaultModel(
            tenant_id=tenant_id,
            provider_name="openai",
            model_name="text-embedding-3-small",
            model_type="text-embedding",
        )

        # Assert
        assert llm_default.model_type == "llm"
        assert embedding_default.model_type == "text-embedding"


class TestTenantPreferredModelProvider:
    """Test suite for TenantPreferredModelProvider settings."""

    def test_tenant_preferred_provider_creation(self):
        """Test creating a tenant preferred model provider."""
        # Arrange
        tenant_id = str(uuid4())

        # Act
        preferred = TenantPreferredModelProvider(
            tenant_id=tenant_id,
            provider_name="openai",
            preferred_provider_type="custom",
        )

        # Assert
        assert preferred.tenant_id == tenant_id
        assert preferred.provider_name == "openai"
        assert preferred.preferred_provider_type == "custom"

    def test_tenant_preferred_provider_system_type(self):
        """Test tenant preferred provider with system type."""
        # Arrange & Act
        preferred = TenantPreferredModelProvider(
            tenant_id=str(uuid4()),
            provider_name="anthropic",
            preferred_provider_type="system",
        )

        # Assert
        assert preferred.preferred_provider_type == "system"


class TestProviderOrder:
    """Test suite for ProviderOrder payment tracking."""

    def test_provider_order_creation_with_required_fields(self):
        """Test creating a provider order with required fields."""
        # Arrange
        tenant_id = str(uuid4())
        account_id = str(uuid4())

        # Act
        order = ProviderOrder(
            tenant_id=tenant_id,
            provider_name="openai",
            account_id=account_id,
            payment_product_id="prod_123",
            payment_id=None,
            transaction_id=None,
            quantity=1,
            currency=None,
            total_amount=None,
            payment_status="wait_pay",
            paid_at=None,
            pay_failed_at=None,
            refunded_at=None,
        )

        # Assert
        assert order.tenant_id == tenant_id
        assert order.provider_name == "openai"
        assert order.account_id == account_id
        assert order.payment_product_id == "prod_123"
        assert order.payment_status == "wait_pay"
        assert order.quantity == 1

    def test_provider_order_with_payment_details(self):
        """Test provider order with full payment details."""
        # Arrange
        tenant_id = str(uuid4())
        account_id = str(uuid4())
        paid_time = datetime.now(UTC)

        # Act
        order = ProviderOrder(
            tenant_id=tenant_id,
            provider_name="openai",
            account_id=account_id,
            payment_product_id="prod_456",
            payment_id="pay_789",
            transaction_id="txn_abc",
            quantity=5,
            currency="USD",
            total_amount=9999,
            payment_status="paid",
            paid_at=paid_time,
            pay_failed_at=None,
            refunded_at=None,
        )

        # Assert
        assert order.payment_id == "pay_789"
        assert order.transaction_id == "txn_abc"
        assert order.quantity == 5
        assert order.currency == "USD"
        assert order.total_amount == 9999
        assert order.payment_status == "paid"
        assert order.paid_at == paid_time

    def test_provider_order_payment_statuses(self):
        """Test provider order with different payment statuses."""
        # Arrange
        base_params = {
            "tenant_id": str(uuid4()),
            "provider_name": "openai",
            "account_id": str(uuid4()),
            "payment_product_id": "prod_123",
            "payment_id": None,
            "transaction_id": None,
            "quantity": 1,
            "currency": None,
            "total_amount": None,
            "paid_at": None,
            "pay_failed_at": None,
            "refunded_at": None,
        }

        # Act & Assert - Wait pay status
        wait_order = ProviderOrder(**base_params, payment_status="wait_pay")
        assert wait_order.payment_status == "wait_pay"

        # Act & Assert - Paid status
        paid_order = ProviderOrder(**base_params, payment_status="paid")
        assert paid_order.payment_status == "paid"

        # Act & Assert - Failed status
        failed_params = {**base_params, "pay_failed_at": datetime.now(UTC)}
        failed_order = ProviderOrder(**failed_params, payment_status="failed")
        assert failed_order.payment_status == "failed"
        assert failed_order.pay_failed_at is not None

        # Act & Assert - Refunded status
        refunded_params = {**base_params, "refunded_at": datetime.now(UTC)}
        refunded_order = ProviderOrder(**refunded_params, payment_status="refunded")
        assert refunded_order.payment_status == "refunded"
        assert refunded_order.refunded_at is not None


class TestProviderModelSetting:
    """Test suite for ProviderModelSetting load balancing configuration."""

    def test_provider_model_setting_creation(self):
        """Test creating a provider model setting."""
        # Arrange
        tenant_id = str(uuid4())

        # Act
        setting = ProviderModelSetting(
            tenant_id=tenant_id,
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
        )

        # Assert
        assert setting.tenant_id == tenant_id
        assert setting.provider_name == "openai"
        assert setting.model_name == "gpt-4"
        assert setting.model_type == "llm"
        assert setting.enabled is True
        assert setting.load_balancing_enabled is False

    def test_provider_model_setting_with_load_balancing(self):
        """Test provider model setting with load balancing enabled."""
        # Arrange & Act
        setting = ProviderModelSetting(
            tenant_id=str(uuid4()),
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
            enabled=True,
            load_balancing_enabled=True,
        )

        # Assert
        assert setting.enabled is True
        assert setting.load_balancing_enabled is True

    def test_provider_model_setting_disabled(self):
        """Test disabled provider model setting."""
        # Arrange & Act
        setting = ProviderModelSetting(
            tenant_id=str(uuid4()),
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
            enabled=False,
        )

        # Assert
        assert setting.enabled is False


class TestLoadBalancingModelConfig:
    """Test suite for LoadBalancingModelConfig management."""

    def test_load_balancing_config_creation(self):
        """Test creating a load balancing model config."""
        # Arrange
        tenant_id = str(uuid4())

        # Act
        config = LoadBalancingModelConfig(
            tenant_id=tenant_id,
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
            name="Primary API Key",
        )

        # Assert
        assert config.tenant_id == tenant_id
        assert config.provider_name == "openai"
        assert config.model_name == "gpt-4"
        assert config.model_type == "llm"
        assert config.name == "Primary API Key"
        assert config.enabled is True

    def test_load_balancing_config_with_credentials(self):
        """Test load balancing config with credential details."""
        # Arrange
        credential_id = str(uuid4())

        # Act
        config = LoadBalancingModelConfig(
            tenant_id=str(uuid4()),
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
            name="Secondary API Key",
            encrypted_config='{"api_key": "encrypted_value"}',
            credential_id=credential_id,
            credential_source_type="custom",
        )

        # Assert
        assert config.encrypted_config == '{"api_key": "encrypted_value"}'
        assert config.credential_id == credential_id
        assert config.credential_source_type == "custom"

    def test_load_balancing_config_disabled(self):
        """Test disabled load balancing config."""
        # Arrange & Act
        config = LoadBalancingModelConfig(
            tenant_id=str(uuid4()),
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
            name="Disabled Config",
            enabled=False,
        )

        # Assert
        assert config.enabled is False

    def test_load_balancing_config_multiple_entries(self):
        """Test multiple load balancing configs for same model."""
        # Arrange
        tenant_id = str(uuid4())
        base_params = {
            "tenant_id": tenant_id,
            "provider_name": "openai",
            "model_name": "gpt-4",
            "model_type": "llm",
        }

        # Act
        primary = LoadBalancingModelConfig(**base_params, name="Primary Key")
        secondary = LoadBalancingModelConfig(**base_params, name="Secondary Key")
        backup = LoadBalancingModelConfig(**base_params, name="Backup Key", enabled=False)

        # Assert
        assert primary.name == "Primary Key"
        assert secondary.name == "Secondary Key"
        assert backup.name == "Backup Key"
        assert primary.enabled is True
        assert secondary.enabled is True
        assert backup.enabled is False


class TestProviderCredential:
    """Test suite for ProviderCredential storage."""

    def test_provider_credential_creation(self):
        """Test creating a provider credential."""
        # Arrange
        tenant_id = str(uuid4())

        # Act
        credential = ProviderCredential(
            tenant_id=tenant_id,
            provider_name="openai",
            credential_name="Production API Key",
            encrypted_config='{"api_key": "sk-encrypted..."}',
        )

        # Assert
        assert credential.tenant_id == tenant_id
        assert credential.provider_name == "openai"
        assert credential.credential_name == "Production API Key"
        assert credential.encrypted_config == '{"api_key": "sk-encrypted..."}'

    def test_provider_credential_multiple_for_same_provider(self):
        """Test multiple credentials for the same provider."""
        # Arrange
        tenant_id = str(uuid4())

        # Act
        prod_cred = ProviderCredential(
            tenant_id=tenant_id,
            provider_name="openai",
            credential_name="Production",
            encrypted_config='{"api_key": "prod_key"}',
        )

        dev_cred = ProviderCredential(
            tenant_id=tenant_id,
            provider_name="openai",
            credential_name="Development",
            encrypted_config='{"api_key": "dev_key"}',
        )

        # Assert
        assert prod_cred.credential_name == "Production"
        assert dev_cred.credential_name == "Development"
        assert prod_cred.provider_name == dev_cred.provider_name


class TestProviderModelCredential:
    """Test suite for ProviderModelCredential storage."""

    def test_provider_model_credential_creation(self):
        """Test creating a provider model credential."""
        # Arrange
        tenant_id = str(uuid4())

        # Act
        credential = ProviderModelCredential(
            tenant_id=tenant_id,
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
            credential_name="GPT-4 API Key",
            encrypted_config='{"api_key": "sk-model-specific..."}',
        )

        # Assert
        assert credential.tenant_id == tenant_id
        assert credential.provider_name == "openai"
        assert credential.model_name == "gpt-4"
        assert credential.model_type == "llm"
        assert credential.credential_name == "GPT-4 API Key"

    def test_provider_model_credential_different_models(self):
        """Test credentials for different models of same provider."""
        # Arrange
        tenant_id = str(uuid4())

        # Act
        gpt4_cred = ProviderModelCredential(
            tenant_id=tenant_id,
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
            credential_name="GPT-4 Key",
            encrypted_config='{"api_key": "gpt4_key"}',
        )

        embedding_cred = ProviderModelCredential(
            tenant_id=tenant_id,
            provider_name="openai",
            model_name="text-embedding-3-large",
            model_type="text-embedding",
            credential_name="Embedding Key",
            encrypted_config='{"api_key": "embedding_key"}',
        )

        # Assert
        assert gpt4_cred.model_name == "gpt-4"
        assert gpt4_cred.model_type == "llm"
        assert embedding_cred.model_name == "text-embedding-3-large"
        assert embedding_cred.model_type == "text-embedding"

    def test_provider_model_credential_with_complex_config(self):
        """Test provider model credential with complex encrypted config."""
        # Arrange
        complex_config = (
            '{"api_key": "sk-xxx", "organization_id": "org-123", '
            '"base_url": "https://api.openai.com/v1", "timeout": 30}'
        )

        # Act
        credential = ProviderModelCredential(
            tenant_id=str(uuid4()),
            provider_name="openai",
            model_name="gpt-4-turbo",
            model_type="llm",
            credential_name="Custom Config",
            encrypted_config=complex_config,
        )

        # Assert
        assert credential.encrypted_config == complex_config
        assert "organization_id" in credential.encrypted_config
        assert "base_url" in credential.encrypted_config
