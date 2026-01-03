"""Unit tests for load balancing credential validation APIs.

This module tests load balancing configuration endpoints:
- Credentials validation
- Configuration validation
- Authorization checks
- Error handling
"""
from __future__ import annotations

import builtins
import importlib
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.console.workspace.load_balancing_config import (
    LoadBalancingConfigCredentialsValidateApi,
    LoadBalancingCredentialsValidateApi,
)
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from models.account import Account
from models import TenantAccountRole


import pytest
from flask import Flask
from flask.views import MethodView
from werkzeug.exceptions import Forbidden

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]

from models.account import TenantAccountRole


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def load_balancing_module(monkeypatch: pytest.MonkeyPatch):
    """Reload controller module with lightweight decorators for testing."""

    from controllers.console import console_ns, wraps
    from libs import login

    def _noop(func):
        return func

    monkeypatch.setattr(login, "login_required", _noop)
    monkeypatch.setattr(wraps, "setup_required", _noop)
    monkeypatch.setattr(wraps, "account_initialization_required", _noop)

    def _noop_route(*args, **kwargs):  # type: ignore[override]
        def _decorator(cls):
            return cls

        return _decorator

    monkeypatch.setattr(console_ns, "route", _noop_route)

    module_name = "controllers.console.workspace.load_balancing_config"
    sys.modules.pop(module_name, None)
    module = importlib.import_module(module_name)
    return module


def _mock_user(role: TenantAccountRole) -> SimpleNamespace:
    return SimpleNamespace(current_role=role)


def _prepare_context(module, monkeypatch: pytest.MonkeyPatch, role=TenantAccountRole.OWNER):
    user = _mock_user(role)
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (user, "tenant-123"))
    mock_service = MagicMock()
    monkeypatch.setattr(module, "ModelLoadBalancingService", lambda: mock_service)
    return mock_service


def _request_payload():
    return {"model": "gpt-4o", "model_type": ModelType.LLM, "credentials": {"api_key": "sk-***"}}


def test_validate_credentials_success(app: Flask, load_balancing_module, monkeypatch: pytest.MonkeyPatch):
    service = _prepare_context(load_balancing_module, monkeypatch)

    with app.test_request_context(
        "/workspaces/current/model-providers/openai/models/load-balancing-configs/credentials-validate",
        method="POST",
        json=_request_payload(),
    ):
        response = load_balancing_module.LoadBalancingCredentialsValidateApi().post(provider="openai")

    assert response == {"result": "success"}
    service.validate_load_balancing_credentials.assert_called_once_with(
        tenant_id="tenant-123",
        provider="openai",
        model="gpt-4o",
        model_type=ModelType.LLM,
        credentials={"api_key": "sk-***"},
    )


def test_validate_credentials_returns_error_message(app: Flask, load_balancing_module, monkeypatch: pytest.MonkeyPatch):
    service = _prepare_context(load_balancing_module, monkeypatch)
    service.validate_load_balancing_credentials.side_effect = CredentialsValidateFailedError("invalid credentials")

    with app.test_request_context(
        "/workspaces/current/model-providers/openai/models/load-balancing-configs/credentials-validate",
        method="POST",
        json=_request_payload(),
    ):
        response = load_balancing_module.LoadBalancingCredentialsValidateApi().post(provider="openai")

    assert response == {"result": "error", "error": "invalid credentials"}


def test_validate_credentials_requires_privileged_role(
    app: Flask, load_balancing_module, monkeypatch: pytest.MonkeyPatch
):
    _prepare_context(load_balancing_module, monkeypatch, role=TenantAccountRole.NORMAL)

    with app.test_request_context(
        "/workspaces/current/model-providers/openai/models/load-balancing-configs/credentials-validate",
        method="POST",
        json=_request_payload(),
    ):
        api = load_balancing_module.LoadBalancingCredentialsValidateApi()
        with pytest.raises(Forbidden):
            api.post(provider="openai")


def test_validate_credentials_with_config_id(app: Flask, load_balancing_module, monkeypatch: pytest.MonkeyPatch):
    service = _prepare_context(load_balancing_module, monkeypatch)

    with app.test_request_context(
        "/workspaces/current/model-providers/openai/models/load-balancing-configs/cfg-1/credentials-validate",
        method="POST",
        json=_request_payload(),
    ):
        response = load_balancing_module.LoadBalancingConfigCredentialsValidateApi().post(
            provider="openai", config_id="cfg-1"
        )

    assert response == {"result": "success"}
    service.validate_load_balancing_credentials.assert_called_once_with(
        tenant_id="tenant-123",
        provider="openai",
        model="gpt-4o",
        model_type=ModelType.LLM,
        credentials={"api_key": "sk-***"},
        config_id="cfg-1",
    )

class TestLoadBalancingCredentialsValidateApi:
    """Unit tests for LoadBalancingCredentialsValidateApi."""

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
        with patch("controllers.console.workspace.load_balancing_config.ModelLoadBalancingService") as mock_service:
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

    def test_validate_credentials_unauthorized(self, app, mock_account_normal, mock_load_balancing_service, mock_decorators):
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

    def test_validate_credentials_owner_allowed(self, app, mock_account_owner, mock_load_balancing_service, mock_decorators):
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
            ):
                resource = LoadBalancingCredentialsValidateApi()
                result = resource.post(provider)

        # Assert
        assert result == {"result": "success"}

    def test_validate_credentials_missing_model(self, app, mock_account_admin, mock_load_balancing_service, mock_decorators):
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
                # RequestParser should raise BadRequest for missing required field
                from werkzeug.exceptions import BadRequest
                with pytest.raises(BadRequest):
                    resource.post(provider)

    def test_validate_credentials_invalid_model_type(self, app, mock_account_admin, mock_load_balancing_service, mock_decorators):
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
                # RequestParser should raise BadRequest for invalid choice
                from werkzeug.exceptions import BadRequest
                with pytest.raises(BadRequest):
                    resource.post(provider)

    def test_validate_credentials_missing_credentials(self, app, mock_account_admin, mock_load_balancing_service, mock_decorators):
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
                from werkzeug.exceptions import BadRequest
                with pytest.raises(BadRequest):
                    resource.post(provider)

    def test_validate_credentials_different_model_types(self, app, mock_account_admin, mock_load_balancing_service, mock_decorators):
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


class TestLoadBalancingConfigCredentialsValidateApi:
    """Unit tests for LoadBalancingConfigCredentialsValidateApi."""

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
        with patch("controllers.console.workspace.load_balancing_config.ModelLoadBalancingService") as mock_service:
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

    def test_validate_config_credentials_success(self, app, mock_account_admin, mock_load_balancing_service, mock_decorators):
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

    def test_validate_config_credentials_failure(self, app, mock_account_admin, mock_load_balancing_service, mock_decorators):
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
            ):
                resource = LoadBalancingConfigCredentialsValidateApi()
                result = resource.post(provider, config_id)

        # Assert
        assert result == {"result": "error", "error": error_message}

    def test_validate_config_credentials_unauthorized(self, app, mock_account_normal, mock_load_balancing_service, mock_decorators):
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

    def test_validate_config_credentials_with_config_id(self, app, mock_account_admin, mock_load_balancing_service, mock_decorators):
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
            ):
                resource = LoadBalancingConfigCredentialsValidateApi()
                result = resource.post(provider, config_id)

        # Assert
        assert result == {"result": "success"}
        # Verify config_id was passed
        call_args = mock_service_instance.validate_load_balancing_credentials.call_args
        assert call_args.kwargs["config_id"] == config_id
