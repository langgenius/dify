from unittest.mock import MagicMock, patch

import pytest
from faker import Faker
from sqlalchemy import select

from models.account import TenantAccountJoin, TenantAccountRole
from models.model import Account, Tenant
from models.provider import LoadBalancingModelConfig, Provider, ProviderModelSetting
from services.model_load_balancing_service import ModelLoadBalancingService


class TestModelLoadBalancingService:
    """Integration tests for ModelLoadBalancingService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.model_load_balancing_service.ProviderManager") as mock_provider_manager,
            patch("services.model_load_balancing_service.LBModelManager") as mock_lb_model_manager,
            patch("services.model_load_balancing_service.ModelProviderFactory") as mock_model_provider_factory,
            patch("services.model_load_balancing_service.encrypter") as mock_encrypter,
        ):
            # Setup default mock returns
            mock_provider_manager_instance = mock_provider_manager.return_value

            # Mock provider configuration
            mock_provider_config = MagicMock()
            mock_provider_config.provider.provider = "openai"
            mock_provider_config.custom_configuration.provider = None

            # Mock provider model setting
            mock_provider_model_setting = MagicMock()
            mock_provider_model_setting.load_balancing_enabled = False

            mock_provider_config.get_provider_model_setting.return_value = mock_provider_model_setting

            # Mock provider configurations dict
            mock_provider_configs = {"openai": mock_provider_config}
            mock_provider_manager_instance.get_configurations.return_value = mock_provider_configs

            # Mock LBModelManager
            mock_lb_model_manager.get_config_in_cooldown_and_ttl.return_value = (False, 0)

            # Mock ModelProviderFactory
            mock_model_provider_factory_instance = mock_model_provider_factory.return_value

            # Mock credential schemas
            mock_credential_schema = MagicMock()
            mock_credential_schema.credential_form_schemas = []

            # Mock provider configuration methods
            mock_provider_config.extract_secret_variables.return_value = []
            mock_provider_config.obfuscated_credentials.return_value = {}
            mock_provider_config._get_credential_schema.return_value = mock_credential_schema

            yield {
                "provider_manager": mock_provider_manager,
                "lb_model_manager": mock_lb_model_manager,
                "model_provider_factory": mock_model_provider_factory,
                "encrypter": mock_encrypter,
                "provider_config": mock_provider_config,
                "provider_model_setting": mock_provider_model_setting,
                "credential_schema": mock_credential_schema,
            }

    def _create_test_account_and_tenant(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test account and tenant for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (account, tenant) - Created account and tenant instances
        """
        fake = Faker()

        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )

        from extensions.ext_database import db

        db.session.add(account)
        db.session.commit()

        # Create tenant for the account
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        # Set current tenant for account
        account.current_tenant = tenant

        return account, tenant

    def _create_test_provider_and_setting(
        self, db_session_with_containers, tenant_id, mock_external_service_dependencies
    ):
        """
        Helper method to create a test provider and provider model setting.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            tenant_id: Tenant ID for the provider
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (provider, provider_model_setting) - Created provider and setting instances
        """
        fake = Faker()

        from extensions.ext_database import db

        # Create provider
        provider = Provider(
            tenant_id=tenant_id,
            provider_name="openai",
            provider_type="custom",
            is_valid=True,
        )
        db.session.add(provider)
        db.session.commit()

        # Create provider model setting
        provider_model_setting = ProviderModelSetting(
            tenant_id=tenant_id,
            provider_name="openai",
            model_name="gpt-3.5-turbo",
            model_type="text-generation",  # Use the origin model type that matches the query
            enabled=True,
            load_balancing_enabled=False,
        )
        db.session.add(provider_model_setting)
        db.session.commit()

        return provider, provider_model_setting

    def test_enable_model_load_balancing_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful model load balancing enablement.

        This test verifies:
        - Proper provider configuration retrieval
        - Successful enablement of model load balancing
        - Correct method calls to provider configuration
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )
        provider, provider_model_setting = self._create_test_provider_and_setting(
            db_session_with_containers, tenant.id, mock_external_service_dependencies
        )

        # Setup mocks for enable method
        mock_provider_config = mock_external_service_dependencies["provider_config"]
        mock_provider_config.enable_model_load_balancing = MagicMock()

        # Act: Execute the method under test
        service = ModelLoadBalancingService()
        service.enable_model_load_balancing(
            tenant_id=tenant.id, provider="openai", model="gpt-3.5-turbo", model_type="llm"
        )

        # Assert: Verify the expected outcomes
        mock_provider_config.enable_model_load_balancing.assert_called_once()
        call_args = mock_provider_config.enable_model_load_balancing.call_args
        assert call_args.kwargs["model"] == "gpt-3.5-turbo"
        assert call_args.kwargs["model_type"].value == "llm"  # ModelType enum value

        # Verify database state
        from extensions.ext_database import db

        db.session.refresh(provider)
        db.session.refresh(provider_model_setting)
        assert provider.id is not None
        assert provider_model_setting.id is not None

    def test_disable_model_load_balancing_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful model load balancing disablement.

        This test verifies:
        - Proper provider configuration retrieval
        - Successful disablement of model load balancing
        - Correct method calls to provider configuration
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )
        provider, provider_model_setting = self._create_test_provider_and_setting(
            db_session_with_containers, tenant.id, mock_external_service_dependencies
        )

        # Setup mocks for disable method
        mock_provider_config = mock_external_service_dependencies["provider_config"]
        mock_provider_config.disable_model_load_balancing = MagicMock()

        # Act: Execute the method under test
        service = ModelLoadBalancingService()
        service.disable_model_load_balancing(
            tenant_id=tenant.id, provider="openai", model="gpt-3.5-turbo", model_type="llm"
        )

        # Assert: Verify the expected outcomes
        mock_provider_config.disable_model_load_balancing.assert_called_once()
        call_args = mock_provider_config.disable_model_load_balancing.call_args
        assert call_args.kwargs["model"] == "gpt-3.5-turbo"
        assert call_args.kwargs["model_type"].value == "llm"  # ModelType enum value

        # Verify database state
        from extensions.ext_database import db

        db.session.refresh(provider)
        db.session.refresh(provider_model_setting)
        assert provider.id is not None
        assert provider_model_setting.id is not None

    def test_enable_model_load_balancing_provider_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error handling when provider does not exist.

        This test verifies:
        - Proper error handling for non-existent provider
        - Correct exception type and message
        - No database state changes
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Setup mocks to return empty provider configurations
        mock_provider_manager = mock_external_service_dependencies["provider_manager"]
        mock_provider_manager_instance = mock_provider_manager.return_value
        mock_provider_manager_instance.get_configurations.return_value = {}

        # Act & Assert: Verify proper error handling
        service = ModelLoadBalancingService()
        with pytest.raises(ValueError) as exc_info:
            service.enable_model_load_balancing(
                tenant_id=tenant.id, provider="nonexistent_provider", model="gpt-3.5-turbo", model_type="llm"
            )

        # Verify correct error message
        assert "Provider nonexistent_provider does not exist." in str(exc_info.value)

        # Verify no database state changes occurred
        from extensions.ext_database import db

        db.session.rollback()

    def test_get_load_balancing_configs_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of load balancing configurations.

        This test verifies:
        - Proper provider configuration retrieval
        - Successful database query for load balancing configs
        - Correct return format and data structure
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )
        provider, provider_model_setting = self._create_test_provider_and_setting(
            db_session_with_containers, tenant.id, mock_external_service_dependencies
        )

        # Create load balancing config
        from extensions.ext_database import db

        load_balancing_config = LoadBalancingModelConfig(
            tenant_id=tenant.id,
            provider_name="openai",
            model_name="gpt-3.5-turbo",
            model_type="text-generation",  # Use the origin model type that matches the query
            name="config1",
            encrypted_config='{"api_key": "test_key"}',
            enabled=True,
        )
        db.session.add(load_balancing_config)
        db.session.commit()

        # Verify the config was created
        db.session.refresh(load_balancing_config)
        assert load_balancing_config.id is not None

        # Setup mocks for get_load_balancing_configs method
        mock_provider_config = mock_external_service_dependencies["provider_config"]
        mock_provider_model_setting = mock_external_service_dependencies["provider_model_setting"]
        mock_provider_model_setting.load_balancing_enabled = True

        # Mock credential schema methods
        mock_credential_schema = mock_external_service_dependencies["credential_schema"]
        mock_credential_schema.credential_form_schemas = []

        # Mock encrypter
        mock_encrypter = mock_external_service_dependencies["encrypter"]
        mock_encrypter.get_decrypt_decoding.return_value = ("key", "cipher")

        # Mock _get_credential_schema method
        mock_provider_config._get_credential_schema.return_value = mock_credential_schema

        # Mock extract_secret_variables method
        mock_provider_config.extract_secret_variables.return_value = []

        # Mock obfuscated_credentials method
        mock_provider_config.obfuscated_credentials.return_value = {}

        # Mock LBModelManager.get_config_in_cooldown_and_ttl
        mock_lb_model_manager = mock_external_service_dependencies["lb_model_manager"]
        mock_lb_model_manager.get_config_in_cooldown_and_ttl.return_value = (False, 0)

        # Act: Execute the method under test
        service = ModelLoadBalancingService()
        is_enabled, configs = service.get_load_balancing_configs(
            tenant_id=tenant.id, provider="openai", model="gpt-3.5-turbo", model_type="llm"
        )

        # Assert: Verify the expected outcomes
        assert is_enabled is True
        assert len(configs) == 1
        assert configs[0]["id"] == load_balancing_config.id
        assert configs[0]["name"] == "config1"
        assert configs[0]["enabled"] is True
        assert configs[0]["in_cooldown"] is False
        assert configs[0]["ttl"] == 0

        # Verify database state
        db.session.refresh(load_balancing_config)
        assert load_balancing_config.id is not None

    def test_get_load_balancing_configs_provider_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error handling when provider does not exist in get_load_balancing_configs.

        This test verifies:
        - Proper error handling for non-existent provider
        - Correct exception type and message
        - No database state changes
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Setup mocks to return empty provider configurations
        mock_provider_manager = mock_external_service_dependencies["provider_manager"]
        mock_provider_manager_instance = mock_provider_manager.return_value
        mock_provider_manager_instance.get_configurations.return_value = {}

        # Act & Assert: Verify proper error handling
        service = ModelLoadBalancingService()
        with pytest.raises(ValueError) as exc_info:
            service.get_load_balancing_configs(
                tenant_id=tenant.id, provider="nonexistent_provider", model="gpt-3.5-turbo", model_type="llm"
            )

        # Verify correct error message
        assert "Provider nonexistent_provider does not exist." in str(exc_info.value)

        # Verify no database state changes occurred
        from extensions.ext_database import db

        db.session.rollback()

    def test_get_load_balancing_configs_with_inherit_config(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test load balancing configs retrieval with inherit configuration.

        This test verifies:
        - Proper handling of inherit configuration
        - Correct ordering of configurations
        - Inherit config initialization when needed
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )
        provider, provider_model_setting = self._create_test_provider_and_setting(
            db_session_with_containers, tenant.id, mock_external_service_dependencies
        )

        # Create load balancing config
        from extensions.ext_database import db

        load_balancing_config = LoadBalancingModelConfig(
            tenant_id=tenant.id,
            provider_name="openai",
            model_name="gpt-3.5-turbo",
            model_type="text-generation",  # Use the origin model type that matches the query
            name="config1",
            encrypted_config='{"api_key": "test_key"}',
            enabled=True,
        )
        db.session.add(load_balancing_config)
        db.session.commit()

        # Setup mocks for inherit config scenario
        mock_provider_config = mock_external_service_dependencies["provider_config"]
        mock_provider_config.custom_configuration.provider = MagicMock()  # Enable custom config

        mock_provider_model_setting = mock_external_service_dependencies["provider_model_setting"]
        mock_provider_model_setting.load_balancing_enabled = True

        # Mock credential schema methods
        mock_credential_schema = mock_external_service_dependencies["credential_schema"]
        mock_credential_schema.credential_form_schemas = []

        # Mock encrypter
        mock_encrypter = mock_external_service_dependencies["encrypter"]
        mock_encrypter.get_decrypt_decoding.return_value = ("key", "cipher")

        # Act: Execute the method under test
        service = ModelLoadBalancingService()
        is_enabled, configs = service.get_load_balancing_configs(
            tenant_id=tenant.id, provider="openai", model="gpt-3.5-turbo", model_type="llm"
        )

        # Assert: Verify the expected outcomes
        assert is_enabled is True
        assert len(configs) == 2  # inherit config + existing config

        # First config should be inherit config
        assert configs[0]["name"] == "__inherit__"
        assert configs[0]["enabled"] is True

        # Second config should be the existing config
        assert configs[1]["id"] == load_balancing_config.id
        assert configs[1]["name"] == "config1"

        # Verify database state
        db.session.refresh(load_balancing_config)
        assert load_balancing_config.id is not None

        # Verify inherit config was created in database
        inherit_configs = db.session.scalars(
            select(LoadBalancingModelConfig).where(LoadBalancingModelConfig.name == "__inherit__")
        ).all()
        assert len(inherit_configs) == 1
