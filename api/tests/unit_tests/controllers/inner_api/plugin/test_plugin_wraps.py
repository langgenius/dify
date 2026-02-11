"""
Unit tests for inner_api plugin decorators
"""

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.inner_api.plugin.wraps import (
    TenantUserPayload,
    get_user,
    get_user_tenant,
    plugin_data,
)


class TestTenantUserPayload:
    """Test TenantUserPayload Pydantic model"""

    def test_valid_payload(self):
        """Test valid payload passes validation"""
        data = {"tenant_id": "tenant123", "user_id": "user456"}
        payload = TenantUserPayload.model_validate(data)
        assert payload.tenant_id == "tenant123"
        assert payload.user_id == "user456"

    def test_missing_tenant_id(self):
        """Test missing tenant_id raises ValidationError"""
        with pytest.raises(ValidationError):
            TenantUserPayload.model_validate({"user_id": "user456"})

    def test_missing_user_id(self):
        """Test missing user_id raises ValidationError"""
        with pytest.raises(ValidationError):
            TenantUserPayload.model_validate({"tenant_id": "tenant123"})


class TestGetUser:
    """Test get_user function"""

    @patch("controllers.inner_api.plugin.wraps.EndUser")
    @patch("controllers.inner_api.plugin.wraps.Session")
    @patch("controllers.inner_api.plugin.wraps.db")
    def test_should_return_existing_user_by_id(self, mock_db, mock_session_class, mock_enduser_class, app: Flask):
        """Test returning existing user when found by ID"""
        # Arrange
        mock_user = MagicMock()
        mock_user.id = "user123"
        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session
        mock_session.query.return_value.where.return_value.first.return_value = mock_user

        # Act
        with app.app_context():
            result = get_user("tenant123", "user123")

        # Assert
        assert result == mock_user
        mock_session.query.assert_called_once()

    @patch("controllers.inner_api.plugin.wraps.EndUser")
    @patch("controllers.inner_api.plugin.wraps.Session")
    @patch("controllers.inner_api.plugin.wraps.db")
    def test_should_return_existing_anonymous_user_by_session_id(
        self, mock_db, mock_session_class, mock_enduser_class, app: Flask
    ):
        """Test returning existing anonymous user by session_id"""
        # Arrange
        mock_user = MagicMock()
        mock_user.session_id = "anonymous_session"
        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session
        mock_session.query.return_value.where.return_value.first.return_value = mock_user

        # Act
        with app.app_context():
            result = get_user("tenant123", "anonymous_session")

        # Assert
        assert result == mock_user

    @patch("controllers.inner_api.plugin.wraps.EndUser")
    @patch("controllers.inner_api.plugin.wraps.Session")
    @patch("controllers.inner_api.plugin.wraps.db")
    def test_should_create_new_user_when_not_found(self, mock_db, mock_session_class, mock_enduser_class, app: Flask):
        """Test creating new user when not found in database"""
        # Arrange
        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session
        mock_session.query.return_value.where.return_value.first.return_value = None
        mock_new_user = MagicMock()
        mock_enduser_class.return_value = mock_new_user

        # Act
        with app.app_context():
            result = get_user("tenant123", "user123")

        # Assert
        assert result == mock_new_user
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()
        mock_session.refresh.assert_called_once()

    @patch("controllers.inner_api.plugin.wraps.EndUser")
    @patch("controllers.inner_api.plugin.wraps.Session")
    @patch("controllers.inner_api.plugin.wraps.db")
    def test_should_use_default_session_id_when_user_id_none(
        self, mock_db, mock_session_class, mock_enduser_class, app: Flask
    ):
        """Test using default session ID when user_id is None"""
        # Arrange
        mock_user = MagicMock()
        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session
        mock_session.query.return_value.where.return_value.first.return_value = mock_user

        # Act
        with app.app_context():
            result = get_user("tenant123", None)

        # Assert
        assert result == mock_user

    @patch("controllers.inner_api.plugin.wraps.EndUser")
    @patch("controllers.inner_api.plugin.wraps.Session")
    @patch("controllers.inner_api.plugin.wraps.db")
    def test_should_raise_error_on_database_exception(
        self, mock_db, mock_session_class, mock_enduser_class, app: Flask
    ):
        """Test raising ValueError when database operation fails"""
        # Arrange
        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session
        mock_session.query.side_effect = Exception("Database error")

        # Act & Assert
        with app.app_context():
            with pytest.raises(ValueError, match="user not found"):
                get_user("tenant123", "user123")


class TestGetUserTenant:
    """Test get_user_tenant decorator"""

    @patch("controllers.inner_api.plugin.wraps.Tenant")
    def test_should_inject_tenant_and_user_models(self, mock_tenant_class, app: Flask, monkeypatch):
        """Test that decorator injects tenant_model and user_model into kwargs"""

        # Arrange
        @get_user_tenant
        def protected_view(tenant_model, user_model, **kwargs):
            return {"tenant": tenant_model, "user": user_model}

        mock_tenant = MagicMock()
        mock_tenant.id = "tenant123"
        mock_user = MagicMock()
        mock_user.id = "user456"

        # Act
        with app.test_request_context(json={"tenant_id": "tenant123", "user_id": "user456"}):
            monkeypatch.setattr(app, "login_manager", MagicMock(), raising=False)
            with patch("controllers.inner_api.plugin.wraps.db.session.query") as mock_query:
                with patch("controllers.inner_api.plugin.wraps.get_user") as mock_get_user:
                    mock_query.return_value.where.return_value.first.return_value = mock_tenant
                    mock_get_user.return_value = mock_user
                    result = protected_view()

        # Assert
        assert result["tenant"] == mock_tenant
        assert result["user"] == mock_user

    def test_should_raise_error_when_tenant_id_missing(self, app: Flask):
        """Test that Pydantic ValidationError is raised when tenant_id is missing from payload"""

        # Arrange
        @get_user_tenant
        def protected_view(tenant_model, user_model, **kwargs):
            return "success"

        # Act & Assert - Pydantic validates payload before manual check
        with app.test_request_context(json={"user_id": "user456"}):
            with pytest.raises(ValidationError):
                protected_view()

    def test_should_raise_error_when_tenant_not_found(self, app: Flask):
        """Test that ValueError is raised when tenant is not found"""

        # Arrange
        @get_user_tenant
        def protected_view(tenant_model, user_model, **kwargs):
            return "success"

        # Act & Assert
        with app.test_request_context(json={"tenant_id": "nonexistent", "user_id": "user456"}):
            with patch("controllers.inner_api.plugin.wraps.db.session.query") as mock_query:
                mock_query.return_value.where.return_value.first.return_value = None
                with pytest.raises(ValueError, match="tenant not found"):
                    protected_view()

    @patch("controllers.inner_api.plugin.wraps.Tenant")
    def test_should_use_default_session_id_when_user_id_empty(self, mock_tenant_class, app: Flask, monkeypatch):
        """Test that default session ID is used when user_id is empty string"""

        # Arrange
        @get_user_tenant
        def protected_view(tenant_model, user_model, **kwargs):
            return {"tenant": tenant_model, "user": user_model}

        mock_tenant = MagicMock()
        mock_tenant.id = "tenant123"
        mock_user = MagicMock()

        # Act - use empty string for user_id to trigger default logic
        with app.test_request_context(json={"tenant_id": "tenant123", "user_id": ""}):
            monkeypatch.setattr(app, "login_manager", MagicMock(), raising=False)
            with patch("controllers.inner_api.plugin.wraps.db.session.query") as mock_query:
                with patch("controllers.inner_api.plugin.wraps.get_user") as mock_get_user:
                    mock_query.return_value.where.return_value.first.return_value = mock_tenant
                    mock_get_user.return_value = mock_user
                    result = protected_view()

        # Assert
        assert result["tenant"] == mock_tenant
        assert result["user"] == mock_user
        from models.model import DefaultEndUserSessionID

        mock_get_user.assert_called_once_with("tenant123", DefaultEndUserSessionID.DEFAULT_SESSION_ID)


class PluginTestPayload:
    """Simple test payload class"""

    def __init__(self, data: dict):
        self.value = data.get("value")

    @classmethod
    def model_validate(cls, data: dict):
        return cls(data)


class TestPluginData:
    """Test plugin_data decorator"""

    def test_should_inject_valid_payload(self, app: Flask):
        """Test that valid payload is injected into kwargs"""

        # Arrange
        @plugin_data(payload_type=PluginTestPayload)
        def protected_view(payload, **kwargs):
            return payload

        # Act
        with app.test_request_context(json={"value": "test_data"}):
            result = protected_view()

        # Assert
        assert result.value == "test_data"

    def test_should_raise_error_on_invalid_json(self, app: Flask):
        """Test that ValueError is raised when JSON parsing fails"""

        # Arrange
        @plugin_data(payload_type=PluginTestPayload)
        def protected_view(payload, **kwargs):
            return payload

        # Act & Assert - Malformed JSON triggers ValueError
        with app.test_request_context(data="not valid json", content_type="application/json"):
            with pytest.raises(ValueError):
                protected_view()

    def test_should_raise_error_on_invalid_payload(self, app: Flask):
        """Test that ValueError is raised when payload validation fails"""

        # Arrange
        class InvalidPayload:
            @classmethod
            def model_validate(cls, data: dict):
                raise Exception("Validation failed")

        @plugin_data(payload_type=InvalidPayload)
        def protected_view(payload, **kwargs):
            return payload

        # Act & Assert
        with app.test_request_context(json={"data": "test"}):
            with pytest.raises(ValueError, match="invalid payload"):
                protected_view()

    def test_should_work_as_parameterized_decorator(self, app: Flask):
        """Test that decorator works when used with parentheses"""

        # Arrange
        @plugin_data(payload_type=PluginTestPayload)
        def protected_view(payload, **kwargs):
            return payload

        # Act
        with app.test_request_context(json={"value": "parameterized"}):
            result = protected_view()

        # Assert
        assert result.value == "parameterized"
