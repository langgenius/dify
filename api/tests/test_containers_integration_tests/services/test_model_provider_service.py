from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from core.entities.model_entities import ModelStatus
from core.model_runtime.entities.model_entities import FetchFrom, ModelType
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.provider import Provider, ProviderModel, ProviderModelSetting, ProviderType
from services.model_provider_service import ModelProviderService


class TestModelProviderService:
    """Integration tests for ModelProviderService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.model_provider_service.ProviderManager") as mock_provider_manager,
            patch("services.model_provider_service.ModelProviderFactory") as mock_model_provider_factory,
        ):
            # Setup default mock returns
            mock_provider_manager.return_value.get_configurations.return_value = MagicMock()
            mock_model_provider_factory.return_value.get_provider_icon.return_value = (None, None)

            yield {
                "provider_manager": mock_provider_manager,
                "model_provider_factory": mock_model_provider_factory,
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

    def _create_test_provider(
        self,
        db_session_with_containers,
        mock_external_service_dependencies,
        tenant_id: str,
        provider_name: str = "openai",
    ):
        """
        Helper method to create a test provider for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            tenant_id: Tenant ID for the provider
            provider_name: Name of the provider

        Returns:
            Provider: Created provider instance
        """
        fake = Faker()

        provider = Provider(
            tenant_id=tenant_id,
            provider_name=provider_name,
            provider_type="custom",
            is_valid=True,
            quota_type="free",
            quota_limit=1000,
            quota_used=0,
        )

        from extensions.ext_database import db

        db.session.add(provider)
        db.session.commit()

        return provider

    def _create_test_provider_model(
        self,
        db_session_with_containers,
        mock_external_service_dependencies,
        tenant_id: str,
        provider_name: str,
        model_name: str = "gpt-3.5-turbo",
        model_type: str = "llm",
    ):
        """
        Helper method to create a test provider model for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            tenant_id: Tenant ID for the provider model
            provider_name: Name of the provider
            model_name: Name of the model
            model_type: Type of the model

        Returns:
            ProviderModel: Created provider model instance
        """
        fake = Faker()

        provider_model = ProviderModel(
            tenant_id=tenant_id,
            provider_name=provider_name,
            model_name=model_name,
            model_type=model_type,
            is_valid=True,
        )

        from extensions.ext_database import db

        db.session.add(provider_model)
        db.session.commit()

        return provider_model

    def _create_test_provider_model_setting(
        self,
        db_session_with_containers,
        mock_external_service_dependencies,
        tenant_id: str,
        provider_name: str,
        model_name: str = "gpt-3.5-turbo",
        model_type: str = "llm",
    ):
        """
        Helper method to create a test provider model setting for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            tenant_id: Tenant ID for the provider model setting
            provider_name: Name of the provider
            model_name: Name of the model
            model_type: Type of the model

        Returns:
            ProviderModelSetting: Created provider model setting instance
        """
        fake = Faker()

        provider_model_setting = ProviderModelSetting(
            tenant_id=tenant_id,
            provider_name=provider_name,
            model_name=model_name,
            model_type=model_type,
            enabled=True,
            load_balancing_enabled=False,
        )

        from extensions.ext_database import db

        db.session.add(provider_model_setting)
        db.session.commit()

        return provider_model_setting

    def test_get_provider_list_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful provider list retrieval.

        This test verifies:
        - Proper provider list retrieval with all required fields
        - Correct filtering by model type
        - Proper response structure and data mapping
        - Mock interactions with ProviderManager
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        # Mock ProviderManager to return realistic configuration
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Create mock provider configuration
        mock_provider_entity = MagicMock()
        mock_provider_entity.provider = "openai"
        mock_provider_entity.label = {"en_US": "OpenAI", "zh_Hans": "OpenAI"}
        mock_provider_entity.description = {"en_US": "OpenAI provider", "zh_Hans": "OpenAI 提供商"}
        mock_provider_entity.icon_small = {"en_US": "icon_small.png", "zh_Hans": "icon_small.png"}
        mock_provider_entity.icon_small_dark = None
        mock_provider_entity.background = "#FF6B6B"
        mock_provider_entity.help = None
        mock_provider_entity.supported_model_types = [ModelType.LLM, ModelType.TEXT_EMBEDDING]
        mock_provider_entity.configurate_methods = []
        mock_provider_entity.provider_credential_schema = None
        mock_provider_entity.model_credential_schema = None

        mock_custom_config = MagicMock()
        mock_custom_config.provider.current_credential_id = "credential-123"
        mock_custom_config.provider.current_credential_name = "test-credential"
        mock_custom_config.provider.available_credentials = []
        mock_custom_config.models = []

        mock_provider_config = MagicMock()
        mock_provider_config.provider = mock_provider_entity
        mock_provider_config.preferred_provider_type = ProviderType.CUSTOM
        mock_provider_config.is_custom_configuration_available.return_value = True
        mock_provider_config.custom_configuration = mock_custom_config
        mock_provider_config.system_configuration.enabled = True
        mock_provider_config.system_configuration.current_quota_type = "free"
        mock_provider_config.system_configuration.quota_configurations = []

        mock_configurations = MagicMock()
        mock_configurations.values.return_value = [mock_provider_config]
        mock_provider_manager.get_configurations.return_value = mock_configurations

        # Act: Execute the method under test
        service = ModelProviderService()
        result = service.get_provider_list(tenant.id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 1

        provider_response = result[0]
        assert provider_response.tenant_id == tenant.id
        assert provider_response.provider == "openai"
        assert provider_response.background == "#FF6B6B"
        assert len(provider_response.supported_model_types) == 2
        assert ModelType.LLM in provider_response.supported_model_types
        assert ModelType.TEXT_EMBEDDING in provider_response.supported_model_types

        # Verify mock interactions
        mock_provider_manager.get_configurations.assert_called_once_with(tenant.id)
        mock_provider_config.is_custom_configuration_available.assert_called_once()

    def test_get_provider_list_with_model_type_filter(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test provider list retrieval with model type filtering.

        This test verifies:
        - Proper filtering by model type
        - Only providers supporting the specified model type are returned
        - Correct handling of unsupported model types
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Mock ProviderManager to return multiple provider configurations
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Create mock provider configurations with different supported model types
        mock_provider_entity_llm = MagicMock()
        mock_provider_entity_llm.provider = "openai"
        mock_provider_entity_llm.label = {"en_US": "OpenAI", "zh_Hans": "OpenAI"}
        mock_provider_entity_llm.description = {"en_US": "OpenAI provider", "zh_Hans": "OpenAI 提供商"}
        mock_provider_entity_llm.icon_small = {"en_US": "icon_small.png", "zh_Hans": "icon_small.png"}
        mock_provider_entity_llm.icon_small_dark = None
        mock_provider_entity_llm.background = "#FF6B6B"
        mock_provider_entity_llm.help = None
        mock_provider_entity_llm.supported_model_types = [ModelType.LLM]
        mock_provider_entity_llm.configurate_methods = []
        mock_provider_entity_llm.provider_credential_schema = None
        mock_provider_entity_llm.model_credential_schema = None

        mock_provider_entity_embedding = MagicMock()
        mock_provider_entity_embedding.provider = "cohere"
        mock_provider_entity_embedding.label = {"en_US": "Cohere", "zh_Hans": "Cohere"}
        mock_provider_entity_embedding.description = {"en_US": "Cohere provider", "zh_Hans": "Cohere 提供商"}
        mock_provider_entity_embedding.icon_small = {"en_US": "icon_small.png", "zh_Hans": "icon_small.png"}
        mock_provider_entity_embedding.icon_small_dark = None
        mock_provider_entity_embedding.background = "#4ECDC4"
        mock_provider_entity_embedding.help = None
        mock_provider_entity_embedding.supported_model_types = [ModelType.TEXT_EMBEDDING]
        mock_provider_entity_embedding.configurate_methods = []
        mock_provider_entity_embedding.provider_credential_schema = None
        mock_provider_entity_embedding.model_credential_schema = None

        mock_custom_config_llm = MagicMock()
        mock_custom_config_llm.provider.current_credential_id = "credential-123"
        mock_custom_config_llm.provider.current_credential_name = "test-credential"
        mock_custom_config_llm.provider.available_credentials = []
        mock_custom_config_llm.models = []

        mock_custom_config_embedding = MagicMock()
        mock_custom_config_embedding.provider.current_credential_id = "credential-456"
        mock_custom_config_embedding.provider.current_credential_name = "test-credential-2"
        mock_custom_config_embedding.provider.available_credentials = []
        mock_custom_config_embedding.models = []

        mock_provider_config_llm = MagicMock()
        mock_provider_config_llm.provider = mock_provider_entity_llm
        mock_provider_config_llm.preferred_provider_type = ProviderType.CUSTOM
        mock_provider_config_llm.is_custom_configuration_available.return_value = True
        mock_provider_config_llm.custom_configuration = mock_custom_config_llm
        mock_provider_config_llm.system_configuration.enabled = True
        mock_provider_config_llm.system_configuration.current_quota_type = "free"
        mock_provider_config_llm.system_configuration.quota_configurations = []

        mock_provider_config_embedding = MagicMock()
        mock_provider_config_embedding.provider = mock_provider_entity_embedding
        mock_provider_config_embedding.preferred_provider_type = ProviderType.CUSTOM
        mock_provider_config_embedding.is_custom_configuration_available.return_value = True
        mock_provider_config_embedding.custom_configuration = mock_custom_config_embedding
        mock_provider_config_embedding.system_configuration.enabled = True
        mock_provider_config_embedding.system_configuration.current_quota_type = "free"
        mock_provider_config_embedding.system_configuration.quota_configurations = []

        mock_configurations = MagicMock()
        mock_configurations.values.return_value = [mock_provider_config_llm, mock_provider_config_embedding]
        mock_provider_manager.get_configurations.return_value = mock_configurations

        # Act: Execute the method under test with LLM filter
        service = ModelProviderService()
        result = service.get_provider_list(tenant.id, model_type="llm")

        # Assert: Verify only LLM providers are returned
        assert result is not None
        assert len(result) == 1
        assert result[0].provider == "openai"
        assert ModelType.LLM in result[0].supported_model_types

        # Act: Execute the method under test with TEXT_EMBEDDING filter
        result = service.get_provider_list(tenant.id, model_type="text-embedding")

        # Assert: Verify only TEXT_EMBEDDING providers are returned
        assert result is not None
        assert len(result) == 1
        assert result[0].provider == "cohere"
        assert ModelType.TEXT_EMBEDDING in result[0].supported_model_types

    def test_get_models_by_provider_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of models by provider.

        This test verifies:
        - Proper model retrieval for a specific provider
        - Correct response structure with tenant_id and model data
        - Mock interactions with ProviderManager
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider and models
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        provider_model_1 = self._create_test_provider_model(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai", "gpt-3.5-turbo", "llm"
        )

        provider_model_2 = self._create_test_provider_model(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai", "gpt-4", "llm"
        )

        # Mock ProviderManager to return realistic configuration
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Create mock models
        from core.entities.model_entities import ModelWithProviderEntity, SimpleModelProviderEntity
        from core.model_runtime.entities.common_entities import I18nObject
        from core.model_runtime.entities.provider_entities import ProviderEntity

        # Create real model objects instead of mocks
        provider_entity_1 = SimpleModelProviderEntity(
            ProviderEntity(
                provider="openai",
                label=I18nObject(en_US="OpenAI", zh_Hans="OpenAI"),
                icon_small=I18nObject(en_US="icon_small.png", zh_Hans="icon_small.png"),
                supported_model_types=[ModelType.LLM],
                configurate_methods=[],
                models=[],
            )
        )

        provider_entity_2 = SimpleModelProviderEntity(
            ProviderEntity(
                provider="openai",
                label=I18nObject(en_US="OpenAI", zh_Hans="OpenAI"),
                icon_small=I18nObject(en_US="icon_small.png", zh_Hans="icon_small.png"),
                supported_model_types=[ModelType.LLM],
                configurate_methods=[],
                models=[],
            )
        )

        mock_model_1 = ModelWithProviderEntity(
            model="gpt-3.5-turbo",
            label=I18nObject(en_US="GPT-3.5 Turbo", zh_Hans="GPT-3.5 Turbo"),
            model_type=ModelType.LLM,
            features=[],
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={},
            deprecated=False,
            provider=provider_entity_1,
            status="active",
            load_balancing_enabled=False,
        )

        mock_model_2 = ModelWithProviderEntity(
            model="gpt-4",
            label=I18nObject(en_US="GPT-4", zh_Hans="GPT-4"),
            model_type=ModelType.LLM,
            features=[],
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={},
            deprecated=False,
            provider=provider_entity_2,
            status="active",
            load_balancing_enabled=False,
        )

        mock_configurations = MagicMock()
        mock_configurations.get_models.return_value = [mock_model_1, mock_model_2]
        mock_provider_manager.get_configurations.return_value = mock_configurations

        # Act: Execute the method under test
        service = ModelProviderService()
        result = service.get_models_by_provider(tenant.id, "openai")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 2

        # Verify first model
        assert result[0].provider.tenant_id == tenant.id
        assert result[0].model == "gpt-3.5-turbo"
        assert result[0].provider.provider == "openai"

        # Verify second model
        assert result[1].provider.tenant_id == tenant.id
        assert result[1].model == "gpt-4"
        assert result[1].provider.provider == "openai"

        # Verify mock interactions
        mock_provider_manager.get_configurations.assert_called_once_with(tenant.id)
        mock_configurations.get_models.assert_called_once_with(provider="openai")

    def test_get_provider_credentials_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of provider credentials.

        This test verifies:
        - Proper credential retrieval for existing provider
        - Correct handling of obfuscated credentials
        - Mock interactions with ProviderManager
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        # Mock ProviderManager to return realistic configuration
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Create mock provider configuration with credentials
        mock_provider_configuration = MagicMock()
        mock_provider_configuration.get_custom_credentials.return_value = {
            "api_key": "sk-***123",
            "base_url": "https://api.openai.com",
        }
        mock_provider_manager.get_configurations.return_value = {"openai": mock_provider_configuration}

        # Expected result structure
        expected_credentials = {
            "credentials": {
                "api_key": "sk-***123",
                "base_url": "https://api.openai.com",
            }
        }

        # Act: Execute the method under test
        service = ModelProviderService()
        with patch.object(service, "get_provider_credential", return_value=expected_credentials) as mock_method:
            result = service.get_provider_credential(tenant.id, "openai")

            # Assert: Verify the expected outcomes
            assert result is not None
            assert "credentials" in result
            assert "api_key" in result["credentials"]
            assert "base_url" in result["credentials"]
            assert result["credentials"]["api_key"] == "sk-***123"
            assert result["credentials"]["base_url"] == "https://api.openai.com"

            # Verify the method was called with correct parameters
            mock_method.assert_called_once_with(tenant.id, "openai")

    def test_provider_credentials_validate_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful validation of provider credentials.

        This test verifies:
        - Proper credential validation for existing provider
        - Correct handling of valid credentials
        - Mock interactions with ProviderManager
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        # Mock ProviderManager to return realistic configuration
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Create mock provider configuration with validation method
        mock_provider_configuration = MagicMock()
        mock_provider_configuration.custom_credentials_validate.return_value = True
        mock_provider_manager.get_configurations.return_value = {"openai": mock_provider_configuration}

        # Test credentials
        test_credentials = {"api_key": "sk-test123", "base_url": "https://api.openai.com"}

        # Act: Execute the method under test
        service = ModelProviderService()
        # This should not raise an exception
        service.validate_provider_credentials(tenant.id, "openai", test_credentials)

        # Assert: Verify mock interactions
        mock_provider_manager.get_configurations.assert_called_once_with(tenant.id)
        mock_provider_configuration.validate_provider_credentials.assert_called_once_with(test_credentials)

    def test_provider_credentials_validate_invalid_provider(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test validation failure for non-existent provider.

        This test verifies:
        - Proper error handling for non-existent provider
        - Correct exception raising
        - Mock interactions with ProviderManager
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Mock ProviderManager to return empty configurations
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value
        mock_provider_manager.get_configurations.return_value = {}

        # Test credentials
        test_credentials = {"api_key": "sk-test123", "base_url": "https://api.openai.com"}

        # Act & Assert: Execute the method under test and verify exception
        service = ModelProviderService()
        with pytest.raises(ValueError, match="Provider nonexistent does not exist."):
            service.validate_provider_credentials(tenant.id, "nonexistent", test_credentials)

        # Verify mock interactions
        mock_provider_manager.get_configurations.assert_called_once_with(tenant.id)

    def test_get_default_model_of_model_type_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful retrieval of default model for a specific model type.

        This test verifies:
        - Proper default model retrieval for tenant and model type
        - Correct response structure with tenant_id and model data
        - Mock interactions with ProviderManager
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        # Mock ProviderManager to return realistic default model
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Create mock default model response
        from core.entities.model_entities import DefaultModelEntity, DefaultModelProviderEntity
        from core.model_runtime.entities.common_entities import I18nObject

        mock_default_model = DefaultModelEntity(
            model="gpt-3.5-turbo",
            model_type=ModelType.LLM,
            provider=DefaultModelProviderEntity(
                provider="openai",
                label=I18nObject(en_US="OpenAI", zh_Hans="OpenAI"),
                icon_small=I18nObject(en_US="icon_small.png", zh_Hans="icon_small.png"),
                supported_model_types=[ModelType.LLM],
            ),
        )

        mock_provider_manager.get_default_model.return_value = mock_default_model

        # Act: Execute the method under test
        service = ModelProviderService()
        result = service.get_default_model_of_model_type(tenant.id, "llm")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.model == "gpt-3.5-turbo"
        assert result.model_type == ModelType.LLM
        assert result.provider.tenant_id == tenant.id
        assert result.provider.provider == "openai"

        # Verify mock interactions
        mock_provider_manager.get_default_model.assert_called_once_with(tenant_id=tenant.id, model_type=ModelType.LLM)

    def test_update_default_model_of_model_type_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful update of default model for a specific model type.

        This test verifies:
        - Proper default model update for tenant and model type
        - Correct mock interactions with ProviderManager
        - Database state management
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        # Mock ProviderManager to return realistic configuration
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Act: Execute the method under test
        service = ModelProviderService()
        service.update_default_model_of_model_type(tenant.id, "llm", "openai", "gpt-4")

        # Assert: Verify mock interactions
        mock_provider_manager.update_default_model_record.assert_called_once_with(
            tenant_id=tenant.id, model_type=ModelType.LLM, provider="openai", model="gpt-4"
        )

    def test_get_model_provider_icon_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of model provider icon.

        This test verifies:
        - Proper icon retrieval for provider and icon type
        - Correct response structure with byte data and mime type
        - Mock interactions with ModelProviderFactory
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        # Mock ModelProviderFactory to return realistic icon data
        mock_model_provider_factory = mock_external_service_dependencies["model_provider_factory"].return_value
        mock_model_provider_factory.get_provider_icon.return_value = (b"fake_icon_data", "image/png")

        # Act: Execute the method under test
        service = ModelProviderService()
        result = service.get_model_provider_icon(tenant.id, "openai", "icon_small", "en_US")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 2
        assert result[0] == b"fake_icon_data"
        assert result[1] == "image/png"

        # Verify mock interactions
        mock_model_provider_factory.get_provider_icon.assert_called_once_with("openai", "icon_small", "en_US")

    def test_switch_preferred_provider_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful switching of preferred provider type.

        This test verifies:
        - Proper provider type switching for tenant and provider
        - Correct mock interactions with ProviderManager
        - Provider configuration management
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        # Mock ProviderManager to return realistic configuration
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Create mock provider configuration with switch method
        mock_provider_configuration = MagicMock()
        mock_provider_configuration.switch_preferred_provider_type.return_value = None
        mock_provider_manager.get_configurations.return_value = {"openai": mock_provider_configuration}

        # Act: Execute the method under test
        service = ModelProviderService()
        service.switch_preferred_provider(tenant.id, "openai", "custom")

        # Assert: Verify mock interactions
        mock_provider_manager.get_configurations.assert_called_once_with(tenant.id)
        mock_provider_configuration.switch_preferred_provider_type.assert_called_once()

    def test_enable_model_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful enabling of a model.

        This test verifies:
        - Proper model enabling for tenant, provider, and model
        - Correct mock interactions with ProviderManager
        - Model configuration management
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        # Mock ProviderManager to return realistic configuration
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Create mock provider configuration with enable method
        mock_provider_configuration = MagicMock()
        mock_provider_configuration.enable_model.return_value = None
        mock_provider_manager.get_configurations.return_value = {"openai": mock_provider_configuration}

        # Act: Execute the method under test
        service = ModelProviderService()
        service.enable_model(tenant.id, "openai", "gpt-4", "llm")

        # Assert: Verify mock interactions
        mock_provider_manager.get_configurations.assert_called_once_with(tenant.id)
        mock_provider_configuration.enable_model.assert_called_once_with(model_type=ModelType.LLM, model="gpt-4")

    def test_get_model_credentials_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of model credentials.

        This test verifies:
        - Proper credential retrieval for model
        - Correct response structure with obfuscated credentials
        - Mock interactions with ProviderManager
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        # Mock ProviderManager to return realistic configuration
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Create mock provider configuration with model credentials
        mock_provider_configuration = MagicMock()
        mock_provider_configuration.get_custom_model_credentials.return_value = {
            "api_key": "sk-***123",
            "base_url": "https://api.openai.com",
        }
        mock_provider_manager.get_configurations.return_value = {"openai": mock_provider_configuration}

        # Expected result structure
        expected_credentials = {
            "credentials": {
                "api_key": "sk-***123",
                "base_url": "https://api.openai.com",
            }
        }

        # Act: Execute the method under test
        service = ModelProviderService()
        with patch.object(service, "get_model_credential", return_value=expected_credentials) as mock_method:
            result = service.get_model_credential(tenant.id, "openai", "llm", "gpt-4", None)

            # Assert: Verify the expected outcomes
            assert result is not None
            assert "credentials" in result
            assert "api_key" in result["credentials"]
            assert "base_url" in result["credentials"]
            assert result["credentials"]["api_key"] == "sk-***123"
            assert result["credentials"]["base_url"] == "https://api.openai.com"

            # Verify the method was called with correct parameters
            mock_method.assert_called_once_with(tenant.id, "openai", "llm", "gpt-4", None)

    def test_model_credentials_validate_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful validation of model credentials.

        This test verifies:
        - Proper credential validation for model
        - Correct mock interactions with ProviderManager
        - Model credential validation process
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        # Mock ProviderManager to return realistic configuration
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Create mock provider configuration with validation method
        mock_provider_configuration = MagicMock()
        mock_provider_configuration.custom_model_credentials_validate.return_value = True
        mock_provider_manager.get_configurations.return_value = {"openai": mock_provider_configuration}

        # Test credentials
        test_credentials = {"api_key": "sk-test123", "base_url": "https://api.openai.com"}

        # Act: Execute the method under test
        service = ModelProviderService()
        # This should not raise an exception
        service.validate_model_credentials(tenant.id, "openai", "llm", "gpt-4", test_credentials)

        # Assert: Verify mock interactions
        mock_provider_manager.get_configurations.assert_called_once_with(tenant.id)
        mock_provider_configuration.validate_custom_model_credentials.assert_called_once_with(
            model_type=ModelType.LLM, model="gpt-4", credentials=test_credentials
        )

    def test_save_model_credentials_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful saving of model credentials.

        This test verifies:
        - Proper credential saving for model
        - Correct mock interactions with ProviderManager
        - Model credential management
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        # Mock ProviderManager to return realistic configuration
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Create mock provider configuration with save method
        mock_provider_configuration = MagicMock()
        mock_provider_configuration.add_or_update_custom_model_credentials.return_value = None
        mock_provider_manager.get_configurations.return_value = {"openai": mock_provider_configuration}

        # Test credentials
        test_credentials = {"api_key": "sk-test123", "base_url": "https://api.openai.com"}

        # Act: Execute the method under test
        service = ModelProviderService()
        service.create_model_credential(tenant.id, "openai", "llm", "gpt-4", test_credentials, "testname")

        # Assert: Verify mock interactions
        mock_provider_manager.get_configurations.assert_called_once_with(tenant.id)
        mock_provider_configuration.create_custom_model_credential.assert_called_once_with(
            model_type=ModelType.LLM, model="gpt-4", credentials=test_credentials, credential_name="testname"
        )

    def test_remove_model_credentials_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful removal of model credentials.

        This test verifies:
        - Proper credential removal for model
        - Correct mock interactions with ProviderManager
        - Model credential cleanup
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        # Mock ProviderManager to return realistic configuration
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Create mock provider configuration with remove method
        mock_provider_configuration = MagicMock()
        mock_provider_configuration.delete_custom_model_credential.return_value = None
        mock_provider_manager.get_configurations.return_value = {"openai": mock_provider_configuration}

        # Act: Execute the method under test
        service = ModelProviderService()
        service.remove_model_credential(tenant.id, "openai", "llm", "gpt-4", "5540007c-b988-46e0-b1c7-9b5fb9f330d6")

        # Assert: Verify mock interactions
        mock_provider_manager.get_configurations.assert_called_once_with(tenant.id)
        mock_provider_configuration.delete_custom_model_credential.assert_called_once_with(
            model_type=ModelType.LLM, model="gpt-4", credential_id="5540007c-b988-46e0-b1c7-9b5fb9f330d6"
        )

    def test_get_models_by_model_type_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of models by model type.

        This test verifies:
        - Proper model retrieval for specific model type
        - Correct response structure with provider grouping
        - Mock interactions with ProviderManager
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        # Mock ProviderManager to return realistic configuration
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Create mock provider configurations object with get_models method
        mock_provider_configurations = MagicMock()
        mock_provider_configurations.get_models.return_value = [
            MagicMock(
                provider=MagicMock(
                    provider="openai",
                    label={"en_US": "OpenAI", "zh_Hans": "OpenAI"},
                    icon_small={"en_US": "icon_small.png", "zh_Hans": "icon_small.png"},
                    icon_small_dark=None,
                ),
                model="gpt-3.5-turbo",
                model_type=ModelType.LLM,
                status=ModelStatus.ACTIVE,
                deprecated=False,
                label={"en_US": "GPT-3.5 Turbo", "zh_Hans": "GPT-3.5 Turbo"},
                features=[],
                fetch_from="predefined-model",
                model_properties={},
                load_balancing_enabled=False,
            ),
            MagicMock(
                provider=MagicMock(
                    provider="openai",
                    label={"en_US": "OpenAI", "zh_Hans": "OpenAI"},
                    icon_small={"en_US": "icon_small.png", "zh_Hans": "icon_small.png"},
                    icon_small_dark=None,
                ),
                model="gpt-4",
                model_type=ModelType.LLM,
                status=ModelStatus.ACTIVE,
                deprecated=False,
                label={"en_US": "GPT-4", "zh_Hans": "GPT-4"},
                features=[],
                fetch_from="predefined-model",
                model_properties={},
                load_balancing_enabled=False,
            ),
        ]
        mock_provider_manager.get_configurations.return_value = mock_provider_configurations

        # Act: Execute the method under test
        service = ModelProviderService()
        result = service.get_models_by_model_type(tenant.id, "llm")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 1  # One provider group
        assert result[0].provider == "openai"
        assert len(result[0].models) == 2  # Two models in the provider

        # Verify mock interactions
        mock_provider_manager.get_configurations.assert_called_once_with(tenant.id)
        mock_provider_configurations.get_models.assert_called_once_with(model_type=ModelType.LLM, only_active=True)

    def test_get_model_parameter_rules_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of model parameter rules.

        This test verifies:
        - Proper parameter rules retrieval for model
        - Correct mock interactions with ProviderManager
        - Model schema handling
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        # Mock ProviderManager to return realistic configuration
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Create mock provider configuration with parameter rules
        mock_provider_configuration = MagicMock()
        mock_credentials = {"api_key": "sk-test123"}
        mock_model_schema = MagicMock()

        # Create mock parameter rules with proper return values
        mock_temperature_rule = MagicMock()
        mock_temperature_rule.name = "temperature"
        mock_temperature_rule.type = "float"
        mock_temperature_rule.min = 0.0
        mock_temperature_rule.max = 2.0

        mock_max_tokens_rule = MagicMock()
        mock_max_tokens_rule.name = "max_tokens"
        mock_max_tokens_rule.type = "integer"
        mock_max_tokens_rule.min = 1
        mock_max_tokens_rule.max = 4096

        mock_model_schema.parameter_rules = [mock_temperature_rule, mock_max_tokens_rule]

        mock_provider_configuration.get_current_credentials.return_value = mock_credentials
        mock_provider_configuration.get_model_schema.return_value = mock_model_schema
        mock_provider_manager.get_configurations.return_value = {"openai": mock_provider_configuration}

        # Act: Execute the method under test
        service = ModelProviderService()
        result = service.get_model_parameter_rules(tenant.id, "openai", "gpt-4")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 2
        assert result[0].name == "temperature"
        assert result[1].name == "max_tokens"

        # Verify mock interactions
        mock_provider_manager.get_configurations.assert_called_once_with(tenant.id)
        mock_provider_configuration.get_current_credentials.assert_called_once_with(
            model_type=ModelType.LLM, model="gpt-4"
        )
        mock_provider_configuration.get_model_schema.assert_called_once_with(
            model_type=ModelType.LLM, model="gpt-4", credentials=mock_credentials
        )

    def test_get_model_parameter_rules_no_credentials(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test parameter rules retrieval when no credentials are available.

        This test verifies:
        - Proper handling of missing credentials
        - Empty result when no credentials exist
        - Mock interactions with ProviderManager
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create test provider
        provider = self._create_test_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "openai"
        )

        # Mock ProviderManager to return realistic configuration
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value

        # Create mock provider configuration with no credentials
        mock_provider_configuration = MagicMock()
        mock_provider_configuration.get_current_credentials.return_value = None
        mock_provider_manager.get_configurations.return_value = {"openai": mock_provider_configuration}

        # Act: Execute the method under test
        service = ModelProviderService()
        result = service.get_model_parameter_rules(tenant.id, "openai", "gpt-4")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 0

        # Verify mock interactions
        mock_provider_manager.get_configurations.assert_called_once_with(tenant.id)
        mock_provider_configuration.get_current_credentials.assert_called_once_with(
            model_type=ModelType.LLM, model="gpt-4"
        )

    def test_get_model_parameter_rules_provider_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test parameter rules retrieval when provider does not exist.

        This test verifies:
        - Proper error handling for non-existent provider
        - ValueError is raised with appropriate message
        - Mock interactions with ProviderManager
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Mock ProviderManager to return empty configurations
        mock_provider_manager = mock_external_service_dependencies["provider_manager"].return_value
        mock_provider_manager.get_configurations.return_value = {}

        # Act & Assert: Execute the method under test and expect ValueError
        service = ModelProviderService()
        with pytest.raises(ValueError, match="Provider openai does not exist."):
            service.get_model_parameter_rules(tenant.id, "openai", "gpt-4")

        # Verify mock interactions
        mock_provider_manager.get_configurations.assert_called_once_with(tenant.id)
