"""Unit tests for load balancing credential validation APIs.

This module tests load balancing configuration endpoints:
- Credentials validation
- Configuration validation
- Authorization checks
- Error handling
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import Forbidden

from controllers.console.workspace import load_balancing_config
from controllers.console.workspace.load_balancing_config import (
    LoadBalancingConfigCredentialsValidateApi,
    LoadBalancingCredentialsValidateApi,
)
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from models import TenantAccountRole
from models.account import Account


class BaseTestLoadBalancing:
    """Base test class with common fixtures for load balancing API tests."""

    @pytest.fixture
    def app(self):
        """Create Flask app for testing."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret-key"
        return app

    @pytest.fixture
    def mock_account_admin(self):
        """Create a mock admin account."""
        account = MagicMock(spec=Account)
        account.id = "user-123"
        account.email = "admin@example.com"
        account.current_tenant_id = "tenant-456"
        account.current_role = TenantAccountRole.ADMIN
        account.is_authenticated = True
        return account

    @pytest.fixture
    def mock_account_owner(self):
        """Create a mock owner account."""
        account = MagicMock(spec=Account)
        account.id = "user-456"
        account.email = "owner@example.com"
        account.current_tenant_id = "tenant-456"
        account.current_role = TenantAccountRole.OWNER
        account.is_authenticated = True
        return account

    @pytest.fixture
    def mock_account_normal(self):
        """Create a mock normal user account."""
        account = MagicMock(spec=Account)
        account.id = "user-789"
        account.email = "user@example.com"
        account.current_tenant_id = "tenant-456"
        account.current_role = TenantAccountRole.NORMAL
        account.is_authenticated = True
        return account

    @pytest.fixture
    def mock_load_balancing_service(self):
        """Mock ModelLoadBalancingService."""
        # Mock ProviderManager to prevent database access
        # Return a mock provider configuration so real service code doesn't fail
        # The provider_configuration.provider.provider needs to be a string, not a MagicMock
        mock_provider = MagicMock()
        mock_provider.provider = "openai"  # Ensure this is a string
        mock_provider_config = MagicMock()
        mock_provider_config.provider = mock_provider
        mock_provider_manager_instance = MagicMock()
        mock_provider_manager_instance.get_configurations.return_value = {"openai": mock_provider_config}
        
        # Create a mock Session context manager to prevent database access
        mock_session = MagicMock()
        mock_session_context = MagicMock()
        mock_session_context.__enter__ = MagicMock(return_value=mock_session)
        mock_session_context.__exit__ = MagicMock(return_value=False)
        
        # Mock db in service module to prevent database access
        # Return a mock config when config_id is queried
        mock_load_balancing_config = MagicMock()
        mock_load_balancing_config.id = "config-123"
        # encrypted_config needs to be a JSON string, not a MagicMock
        mock_load_balancing_config.encrypted_config = json.dumps({"api_key": "test-key"})
        mock_db = MagicMock()
        # Simplify the mocking chain by directly setting the return value
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_load_balancing_config
        mock_db.session = MagicMock()
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_load_balancing_config
        
        # Create a factory function for mock service instances to ensure fresh instances
        def create_mock_service_instance():
            instance = MagicMock()
            instance.validate_load_balancing_credentials.return_value = None
            return instance
        
        default_mock_service_instance = create_mock_service_instance()
        
        # Mock ModelProviderFactory to prevent provider validation issues
        # The get_plugin_model_provider should return a mock that has a proper provider string
        mock_provider_entity = MagicMock()
        mock_provider_entity.provider = "openai"  # Ensure this is a string, not a MagicMock
        
        # Create the mock service before patching to ensure it's ready
        # Use a callable mock that returns a mock instance
        mock_service_class = MagicMock()
        # Ensure the mock is callable and returns a mock instance by default
        mock_service_class.return_value = default_mock_service_instance
        
        with (
            patch.object(load_balancing_config, "ModelLoadBalancingService", new=mock_service_class),
            patch("controllers.console.workspace.load_balancing_config.ModelLoadBalancingService", new=mock_service_class),
            patch("services.model_load_balancing_service.ModelLoadBalancingService", new=mock_service_class),
            patch("core.provider_manager.ProviderManager", return_value=mock_provider_manager_instance),
            patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager_instance),
            patch("core.provider_manager.Session", return_value=mock_session_context),
            patch("services.model_load_balancing_service.db", mock_db),
            patch("core.model_runtime.model_providers.model_provider_factory.ModelProviderFactory") as mock_factory,
            patch("services.model_load_balancing_service.ModelProviderFactory") as mock_factory_service,
        ):
            # Use the mock service class as the main mock
            mock_service = mock_service_class
            
            # The mock_service_class already has return_value set to default_mock_service_instance
            # Tests can override this by setting mock_load_balancing_service.return_value
            # Don't reset the mock - let tests have full control over return_value
            # Only reset call history if needed, but preserve return_value
            
            # Mock ModelProviderFactory to prevent provider validation issues
            # The factory is instantiated inside the service, so we need to patch it at the service module level
            mock_factory_instance = MagicMock()
            mock_factory.return_value = mock_factory_instance
            mock_factory_service.return_value = mock_factory_instance
            # Ensure get_plugin_model_provider returns a mock with a proper provider string
            # The method is called with provider="openai" (string), and should return a mock entity
            mock_factory_instance.get_plugin_model_provider.return_value = mock_provider_entity
            mock_factory_instance.provider_credentials_validate.return_value = {}
            mock_factory_instance.model_credentials_validate.return_value = {}
            
            # Yield the mock service
            yield mock_service

    @pytest.fixture
    def mock_decorators(self):
        """Mock decorators to avoid database access."""
        with (
            patch("controllers.console.wraps.db") as mock_db,
            patch("controllers.console.wraps.dify_config.EDITION", "CLOUD"),
            patch("libs.login.dify_config.LOGIN_DISABLED", False),
            patch("libs.login.check_csrf_token") as mock_csrf,
        ):
            mock_db.session.query.return_value.first.return_value = MagicMock()
            mock_csrf.return_value = None
            yield {"db": mock_db, "csrf": mock_csrf}


class TestLoadBalancingCredentialsValidateApi(BaseTestLoadBalancing):
    """Unit tests for LoadBalancingCredentialsValidateApi."""

    def test_validate_credentials_success(self, app, mock_account_admin, mock_load_balancing_service, mock_decorators):
        """Test successful credentials validation."""
        # Arrange
        provider = "openai"
        model = "gpt-4"
        model_type = ModelType.LLM.value
        credentials = {"api_key": "test-api-key", "base_url": "https://api.openai.com"}

        mock_service_instance = MagicMock()
        mock_load_balancing_service.return_value = mock_service_instance
        mock_service_instance.validate_load_balancing_credentials.return_value = None  # No exception means success

        with app.test_request_context(
            method="POST",
            json={
                "model": model,
                "model_type": model_type,
                "credentials": credentials,
            },
            path=f"/workspaces/current/model-providers/{provider}/models/load-balancing-configs/credentials-validate",
        ):
            with (
                patch(
                    "controllers.console.workspace.load_balancing_config.current_account_with_tenant",
                    return_value=(mock_account_admin, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_admin),
                patch(
                    "controllers.console.workspace.load_balancing_config.console_ns",
                    new=MagicMock(payload={
                        "model": model,
                        "model_type": model_type,
                        "credentials": credentials,
                    }),
                ),
            ):
                resource = LoadBalancingCredentialsValidateApi()
                result = resource.post(provider)

        # Assert
        assert result == {"result": "success"}
        mock_service_instance.validate_load_balancing_credentials.assert_called_once_with(
            tenant_id="tenant-456",
            provider=provider,
            model=model,
            model_type=model_type,
            credentials=credentials,
        )

    def test_validate_credentials_failure(self, app, mock_account_admin, mock_load_balancing_service, mock_decorators):
        """Test credentials validation failure."""
        # Arrange
        provider = "openai"
        model = "gpt-4"
        model_type = ModelType.LLM.value
        credentials = {"api_key": "invalid-key"}
        error_message = "Invalid API key"

        mock_service_instance = MagicMock()
        mock_load_balancing_service.return_value = mock_service_instance
        mock_service_instance.validate_load_balancing_credentials.side_effect = CredentialsValidateFailedError(
            error_message
        )

        with app.test_request_context(
            method="POST",
            json={
                "model": model,
                "model_type": model_type,
                "credentials": credentials,
            },
            path=f"/workspaces/current/model-providers/{provider}/models/load-balancing-configs/credentials-validate",
        ):
            with (
                patch(
                    "controllers.console.workspace.load_balancing_config.current_account_with_tenant",
                    return_value=(mock_account_admin, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_admin),
                patch(
                    "controllers.console.workspace.load_balancing_config.console_ns",
                    new=MagicMock(payload={
                        "model": model,
                        "model_type": model_type,
                        "credentials": credentials,
                    }),
                ),
            ):
                resource = LoadBalancingCredentialsValidateApi()
                result = resource.post(provider)

        # Assert
        assert result == {"result": "error", "error": error_message}
        mock_service_instance.validate_load_balancing_credentials.assert_called_once_with(
            tenant_id="tenant-456",
            provider=provider,
            model=model,
            model_type=model_type,
            credentials=credentials,
        )

    def test_validate_credentials_unauthorized(
        self, app, mock_account_normal, mock_load_balancing_service, mock_decorators
    ):
        """Test that non-privileged users cannot validate credentials."""
        # Arrange
        provider = "openai"

        with app.test_request_context(
            method="POST",
            json={
                "model": "gpt-4",
                "model_type": ModelType.LLM.value,
                "credentials": {"api_key": "test-key"},
            },
            path=f"/workspaces/current/model-providers/{provider}/models/load-balancing-configs/credentials-validate",
        ):
            with (
                patch(
                    "controllers.console.workspace.load_balancing_config.current_account_with_tenant",
                    return_value=(mock_account_normal, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_normal),
            ):
                resource = LoadBalancingCredentialsValidateApi()

                # Act & Assert
                with pytest.raises(Forbidden):
                    resource.post(provider)

    def test_validate_credentials_owner_allowed(
        self, app, mock_account_owner, mock_load_balancing_service, mock_decorators
    ):
        """Test that owner role can validate credentials."""
        # Arrange
        provider = "openai"
        model = "gpt-4"
        model_type = ModelType.LLM.value
        credentials = {"api_key": "test-api-key"}

        mock_service_instance = MagicMock()
        mock_load_balancing_service.return_value = mock_service_instance
        mock_service_instance.validate_load_balancing_credentials.return_value = None

        with app.test_request_context(
            method="POST",
            json={
                "model": model,
                "model_type": model_type,
                "credentials": credentials,
            },
            path=f"/workspaces/current/model-providers/{provider}/models/load-balancing-configs/credentials-validate",
        ):
            with (
                patch(
                    "controllers.console.workspace.load_balancing_config.current_account_with_tenant",
                    return_value=(mock_account_owner, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_owner),
                patch(
                    "controllers.console.workspace.load_balancing_config.console_ns",
                    new=MagicMock(payload={
                        "model": model,
                        "model_type": model_type,
                        "credentials": credentials,
                    }),
                ),
            ):
                resource = LoadBalancingCredentialsValidateApi()
                result = resource.post(provider)

        # Assert
        assert result == {"result": "success"}

    def test_validate_credentials_missing_model(
        self, app, mock_account_admin, mock_load_balancing_service, mock_decorators
    ):
        """Test validation with missing model parameter."""
        # Arrange
        provider = "openai"

        with app.test_request_context(
            method="POST",
            json={
                "model_type": ModelType.LLM.value,
                "credentials": {"api_key": "test-key"},
            },
            path=f"/workspaces/current/model-providers/{provider}/models/load-balancing-configs/credentials-validate",
        ):
            with (
                patch(
                    "controllers.console.workspace.load_balancing_config.current_account_with_tenant",
                    return_value=(mock_account_admin, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_admin),
            ):
                resource = LoadBalancingCredentialsValidateApi()

                # Act & Assert
                # Pydantic validation should raise ValidationError for missing required field
                with pytest.raises(ValidationError):
                    resource.post(provider)

    def test_validate_credentials_invalid_model_type(
        self, app, mock_account_admin, mock_load_balancing_service, mock_decorators
    ):
        """Test validation with invalid model_type."""
        # Arrange
        provider = "openai"
        invalid_model_type = "invalid-type"

        with app.test_request_context(
            method="POST",
            json={
                "model": "gpt-4",
                "model_type": invalid_model_type,
                "credentials": {"api_key": "test-key"},
            },
            path=f"/workspaces/current/model-providers/{provider}/models/load-balancing-configs/credentials-validate",
        ):
            with (
                patch(
                    "controllers.console.workspace.load_balancing_config.current_account_with_tenant",
                    return_value=(mock_account_admin, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_admin),
            ):
                resource = LoadBalancingCredentialsValidateApi()

                # Act & Assert
                # Pydantic validation should raise ValidationError for invalid model type
                with pytest.raises(ValidationError):
                    resource.post(provider)

    def test_validate_credentials_missing_credentials(
        self, app, mock_account_admin, mock_load_balancing_service, mock_decorators
    ):
        """Test validation with missing credentials parameter."""
        # Arrange
        provider = "openai"

        with app.test_request_context(
            method="POST",
            json={
                "model": "gpt-4",
                "model_type": ModelType.LLM.value,
            },
            path=f"/workspaces/current/model-providers/{provider}/models/load-balancing-configs/credentials-validate",
        ):
            with (
                patch(
                    "controllers.console.workspace.load_balancing_config.current_account_with_tenant",
                    return_value=(mock_account_admin, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_admin),
            ):
                resource = LoadBalancingCredentialsValidateApi()

                # Act & Assert
                # Pydantic validation should raise ValidationError for missing required field
                with pytest.raises(ValidationError):
                    resource.post(provider)

    def test_validate_credentials_different_model_types(
        self, app, mock_account_admin, mock_load_balancing_service, mock_decorators
    ):
        """Test validation with different model types."""
        # Arrange
        provider = "openai"
        model = "text-embedding-ada-002"
        model_type = ModelType.TEXT_EMBEDDING.value
        credentials = {"api_key": "test-api-key"}

        mock_service_instance = MagicMock()
        mock_load_balancing_service.return_value = mock_service_instance
        mock_service_instance.validate_load_balancing_credentials.return_value = None

        with app.test_request_context(
            method="POST",
            json={
                "model": model,
                "model_type": model_type,
                "credentials": credentials,
            },
            path=f"/workspaces/current/model-providers/{provider}/models/load-balancing-configs/credentials-validate",
        ):
            with (
                patch(
                    "controllers.console.workspace.load_balancing_config.current_account_with_tenant",
                    return_value=(mock_account_admin, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_admin),
                patch(
                    "controllers.console.workspace.load_balancing_config.console_ns",
                    new=MagicMock(payload={
                        "model": model,
                        "model_type": model_type,
                        "credentials": credentials,
                    }),
                ),
            ):
                resource = LoadBalancingCredentialsValidateApi()
                result = resource.post(provider)

        # Assert
        assert result == {"result": "success"}
        mock_service_instance.validate_load_balancing_credentials.assert_called_once_with(
            tenant_id="tenant-456",
            provider=provider,
            model=model,
            model_type=model_type,
            credentials=credentials,
        )


class TestLoadBalancingConfigCredentialsValidateApi(BaseTestLoadBalancing):
    """Unit tests for LoadBalancingConfigCredentialsValidateApi."""

    def test_validate_config_credentials_success(
        self, app, mock_account_admin, mock_load_balancing_service, mock_decorators
    ):
        """Test successful config credentials validation."""
        # Arrange
        provider = "openai"
        config_id = "config-123"
        model = "gpt-4"
        model_type = ModelType.LLM.value
        credentials = {"api_key": "test-api-key", "base_url": "https://api.openai.com"}

        mock_service_instance = MagicMock()
        mock_load_balancing_service.return_value = mock_service_instance
        mock_service_instance.validate_load_balancing_credentials.return_value = None

        with app.test_request_context(
            method="POST",
            json={
                "model": model,
                "model_type": model_type,
                "credentials": credentials,
            },
            path=f"/workspaces/current/model-providers/{provider}/models/load-balancing-configs/{config_id}/credentials-validate",
        ):
            with (
                patch(
                    "controllers.console.workspace.load_balancing_config.current_account_with_tenant",
                    return_value=(mock_account_admin, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_admin),
                patch(
                    "controllers.console.workspace.load_balancing_config.console_ns",
                    new=MagicMock(payload={
                        "model": model,
                        "model_type": model_type,
                        "credentials": credentials,
                    }),
                ),
            ):
                resource = LoadBalancingConfigCredentialsValidateApi()
                result = resource.post(provider, config_id)

        # Assert
        assert result == {"result": "success"}
        mock_service_instance.validate_load_balancing_credentials.assert_called_once_with(
            tenant_id="tenant-456",
            provider=provider,
            model=model,
            model_type=model_type,
            credentials=credentials,
            config_id=config_id,
        )

    def test_validate_config_credentials_failure(
        self, app, mock_account_admin, mock_load_balancing_service, mock_decorators
    ):
        """Test config credentials validation failure."""
        # Arrange
        provider = "openai"
        config_id = "config-123"
        model = "gpt-4"
        model_type = ModelType.LLM.value
        credentials = {"api_key": "invalid-key"}
        error_message = "Invalid API key"

        mock_service_instance = MagicMock()
        mock_load_balancing_service.return_value = mock_service_instance
        mock_service_instance.validate_load_balancing_credentials.side_effect = CredentialsValidateFailedError(
            error_message
        )

        with app.test_request_context(
            method="POST",
            json={
                "model": model,
                "model_type": model_type,
                "credentials": credentials,
            },
            path=f"/workspaces/current/model-providers/{provider}/models/load-balancing-configs/{config_id}/credentials-validate",
        ):
            with (
                patch(
                    "controllers.console.workspace.load_balancing_config.current_account_with_tenant",
                    return_value=(mock_account_admin, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_admin),
                patch(
                    "controllers.console.workspace.load_balancing_config.console_ns",
                    new=MagicMock(payload={
                        "model": model,
                        "model_type": model_type,
                        "credentials": credentials,
                    }),
                ),
            ):
                resource = LoadBalancingConfigCredentialsValidateApi()
                result = resource.post(provider, config_id)

        # Assert
        assert result == {"result": "error", "error": error_message}

    def test_validate_config_credentials_unauthorized(
        self, app, mock_account_normal, mock_load_balancing_service, mock_decorators
    ):
        """Test that non-privileged users cannot validate config credentials."""
        # Arrange
        provider = "openai"
        config_id = "config-123"

        with app.test_request_context(
            method="POST",
            json={
                "model": "gpt-4",
                "model_type": ModelType.LLM.value,
                "credentials": {"api_key": "test-key"},
            },
            path=f"/workspaces/current/model-providers/{provider}/models/load-balancing-configs/{config_id}/credentials-validate",
        ):
            with (
                patch(
                    "controllers.console.workspace.load_balancing_config.current_account_with_tenant",
                    return_value=(mock_account_normal, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_normal),
            ):
                resource = LoadBalancingConfigCredentialsValidateApi()

                # Act & Assert
                with pytest.raises(Forbidden):
                    resource.post(provider, config_id)

    def test_validate_config_credentials_with_config_id(
        self, app, mock_account_admin, mock_load_balancing_service, mock_decorators
    ):
        """Test that config_id is passed to validation service."""
        # Arrange
        provider = "openai"
        config_id = "specific-config-456"
        model = "gpt-4"
        model_type = ModelType.LLM.value
        credentials = {"api_key": "test-api-key"}

        mock_service_instance = MagicMock()
        mock_load_balancing_service.return_value = mock_service_instance
        mock_service_instance.validate_load_balancing_credentials.return_value = None

        with app.test_request_context(
            method="POST",
            json={
                "model": model,
                "model_type": model_type,
                "credentials": credentials,
            },
            path=f"/workspaces/current/model-providers/{provider}/models/load-balancing-configs/{config_id}/credentials-validate",
        ):
            with (
                patch(
                    "controllers.console.workspace.load_balancing_config.current_account_with_tenant",
                    return_value=(mock_account_admin, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_admin),
                patch(
                    "controllers.console.workspace.load_balancing_config.console_ns",
                    new=MagicMock(payload={
                        "model": model,
                        "model_type": model_type,
                        "credentials": credentials,
                    }),
                ),
            ):
                resource = LoadBalancingConfigCredentialsValidateApi()
                result = resource.post(provider, config_id)

        # Assert
        assert result == {"result": "success"}
        # Verify config_id was passed
        call_args = mock_service_instance.validate_load_balancing_credentials.call_args
        assert call_args.kwargs["config_id"] == config_id
