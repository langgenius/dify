"""
Unit tests for inner_api auth decorators
"""

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import HTTPException

from configs import dify_config
from controllers.inner_api.wraps import (
    billing_inner_api_only,
    enterprise_inner_api_only,
    enterprise_inner_api_user_auth,
    plugin_inner_api_only,
)


class TestBillingInnerApiOnly:
    """Test billing_inner_api_only decorator"""

    def test_should_allow_when_inner_api_enabled_and_valid_key(self, app: Flask):
        """Test that valid API key allows access when INNER_API is enabled"""

        # Arrange
        @billing_inner_api_only
        def protected_view():
            return "success"

        # Act
        with app.test_request_context(headers={"X-Inner-Api-Key": "valid_key"}):
            with patch.object(dify_config, "INNER_API", True):
                with patch.object(dify_config, "INNER_API_KEY", "valid_key"):
                    result = protected_view()

        # Assert
        assert result == "success"

    def test_should_return_404_when_inner_api_disabled(self, app: Flask):
        """Test that 404 is returned when INNER_API is disabled"""

        # Arrange
        @billing_inner_api_only
        def protected_view():
            return "success"

        # Act & Assert
        with app.test_request_context():
            with patch.object(dify_config, "INNER_API", False):
                with pytest.raises(HTTPException) as exc_info:
                    protected_view()
                assert exc_info.value.code == 404

    def test_should_return_401_when_api_key_missing(self, app: Flask):
        """Test that 401 is returned when X-Inner-Api-Key header is missing"""

        # Arrange
        @billing_inner_api_only
        def protected_view():
            return "success"

        # Act & Assert
        with app.test_request_context(headers={}):
            with patch.object(dify_config, "INNER_API", True):
                with patch.object(dify_config, "INNER_API_KEY", "valid_key"):
                    with pytest.raises(HTTPException) as exc_info:
                        protected_view()
                    assert exc_info.value.code == 401

    def test_should_return_401_when_api_key_invalid(self, app: Flask):
        """Test that 401 is returned when X-Inner-Api-Key header is invalid"""

        # Arrange
        @billing_inner_api_only
        def protected_view():
            return "success"

        # Act & Assert
        with app.test_request_context(headers={"X-Inner-Api-Key": "invalid_key"}):
            with patch.object(dify_config, "INNER_API", True):
                with patch.object(dify_config, "INNER_API_KEY", "valid_key"):
                    with pytest.raises(HTTPException) as exc_info:
                        protected_view()
                    assert exc_info.value.code == 401


class TestEnterpriseInnerApiOnly:
    """Test enterprise_inner_api_only decorator"""

    def test_should_allow_when_inner_api_enabled_and_valid_key(self, app: Flask):
        """Test that valid API key allows access when INNER_API is enabled"""

        # Arrange
        @enterprise_inner_api_only
        def protected_view():
            return "success"

        # Act
        with app.test_request_context(headers={"X-Inner-Api-Key": "valid_key"}):
            with patch.object(dify_config, "INNER_API", True):
                with patch.object(dify_config, "INNER_API_KEY", "valid_key"):
                    result = protected_view()

        # Assert
        assert result == "success"

    def test_should_return_404_when_inner_api_disabled(self, app: Flask):
        """Test that 404 is returned when INNER_API is disabled"""

        # Arrange
        @enterprise_inner_api_only
        def protected_view():
            return "success"

        # Act & Assert
        with app.test_request_context():
            with patch.object(dify_config, "INNER_API", False):
                with pytest.raises(HTTPException) as exc_info:
                    protected_view()
                assert exc_info.value.code == 404

    def test_should_return_401_when_api_key_missing(self, app: Flask):
        """Test that 401 is returned when X-Inner-Api-Key header is missing"""

        # Arrange
        @enterprise_inner_api_only
        def protected_view():
            return "success"

        # Act & Assert
        with app.test_request_context(headers={}):
            with patch.object(dify_config, "INNER_API", True):
                with patch.object(dify_config, "INNER_API_KEY", "valid_key"):
                    with pytest.raises(HTTPException) as exc_info:
                        protected_view()
                    assert exc_info.value.code == 401

    def test_should_return_401_when_api_key_invalid(self, app: Flask):
        """Test that 401 is returned when X-Inner-Api-Key header is invalid"""

        # Arrange
        @enterprise_inner_api_only
        def protected_view():
            return "success"

        # Act & Assert
        with app.test_request_context(headers={"X-Inner-Api-Key": "invalid_key"}):
            with patch.object(dify_config, "INNER_API", True):
                with patch.object(dify_config, "INNER_API_KEY", "valid_key"):
                    with pytest.raises(HTTPException) as exc_info:
                        protected_view()
                    assert exc_info.value.code == 401


class TestEnterpriseInnerApiUserAuth:
    """Test enterprise_inner_api_user_auth decorator for HMAC-based user authentication"""

    def test_should_pass_through_when_inner_api_disabled(self, app: Flask):
        """Test that request passes through when INNER_API is disabled"""

        # Arrange
        @enterprise_inner_api_user_auth
        def protected_view(**kwargs):
            return kwargs.get("user", "no_user")

        # Act
        with app.test_request_context():
            with patch.object(dify_config, "INNER_API", False):
                result = protected_view()

        # Assert
        assert result == "no_user"

    def test_should_pass_through_when_authorization_header_missing(self, app: Flask):
        """Test that request passes through when Authorization header is missing"""

        # Arrange
        @enterprise_inner_api_user_auth
        def protected_view(**kwargs):
            return kwargs.get("user", "no_user")

        # Act
        with app.test_request_context(headers={}):
            with patch.object(dify_config, "INNER_API", True):
                result = protected_view()

        # Assert
        assert result == "no_user"

    def test_should_pass_through_when_authorization_format_invalid(self, app: Flask):
        """Test that request passes through when Authorization format is invalid (no colon)"""

        # Arrange
        @enterprise_inner_api_user_auth
        def protected_view(**kwargs):
            return kwargs.get("user", "no_user")

        # Act
        with app.test_request_context(headers={"Authorization": "invalid_format"}):
            with patch.object(dify_config, "INNER_API", True):
                result = protected_view()

        # Assert
        assert result == "no_user"

    def test_should_pass_through_when_hmac_signature_invalid(self, app: Flask):
        """Test that request passes through when HMAC signature is invalid"""

        # Arrange
        @enterprise_inner_api_user_auth
        def protected_view(**kwargs):
            return kwargs.get("user", "no_user")

        # Act - use wrong signature
        with app.test_request_context(
            headers={"Authorization": "DIFY user123:wrong_signature", "X-Inner-Api-Key": "valid_key"}
        ):
            with patch.object(dify_config, "INNER_API", True):
                result = protected_view()

        # Assert
        assert result == "no_user"

    def test_should_inject_user_when_hmac_signature_valid(self, app: Flask):
        """Test that user is injected when HMAC signature is valid"""
        # Arrange
        from base64 import b64encode
        from hashlib import sha1
        from hmac import new as hmac_new

        @enterprise_inner_api_user_auth
        def protected_view(**kwargs):
            return kwargs.get("user")

        # Calculate valid HMAC signature
        user_id = "user123"
        inner_api_key = "valid_key"
        data_to_sign = f"DIFY {user_id}"
        signature = hmac_new(inner_api_key.encode("utf-8"), data_to_sign.encode("utf-8"), sha1)
        valid_signature = b64encode(signature.digest()).decode("utf-8")

        # Create mock user
        mock_user = MagicMock()
        mock_user.id = user_id

        # Act
        with app.test_request_context(
            headers={"Authorization": f"DIFY {user_id}:{valid_signature}", "X-Inner-Api-Key": inner_api_key}
        ):
            with patch.object(dify_config, "INNER_API", True):
                with patch("controllers.inner_api.wraps.db.session.query") as mock_query:
                    mock_query.return_value.where.return_value.first.return_value = mock_user
                    result = protected_view()

        # Assert
        assert result == mock_user

    def test_should_extract_user_id_with_bearer_prefix(self, app: Flask):
        """Test that user ID is correctly extracted when Authorization has Bearer prefix.

        For "Bearer DIFY user123:signature", the decorator strips the prefix
        via split(" ")[-1] and extracts "user123" as the real user_id.
        """
        # Arrange
        from base64 import b64encode
        from hashlib import sha1
        from hmac import new as hmac_new

        @enterprise_inner_api_user_auth
        def protected_view(**kwargs):
            return kwargs.get("user")

        user_id = "user123"
        inner_api_key = "valid_key"
        data_to_sign = f"DIFY {user_id}"
        signature = hmac_new(inner_api_key.encode("utf-8"), data_to_sign.encode("utf-8"), sha1)
        valid_signature = b64encode(signature.digest()).decode("utf-8")

        mock_user = MagicMock()
        mock_user.id = user_id

        # Act - Authorization header with "Bearer " prefix before DIFY
        with app.test_request_context(
            headers={
                "Authorization": f"Bearer DIFY {user_id}:{valid_signature}",
                "X-Inner-Api-Key": inner_api_key,
            }
        ):
            with patch.object(dify_config, "INNER_API", True):
                with patch("controllers.inner_api.wraps.db.session.query") as mock_query:
                    mock_query.return_value.where.return_value.first.return_value = mock_user
                    result = protected_view()

        # Assert
        assert result == mock_user


class TestPluginInnerApiOnly:
    """Test plugin_inner_api_only decorator"""

    def test_should_allow_when_plugin_daemon_key_set_and_valid_key(self, app: Flask):
        """Test that valid API key allows access when PLUGIN_DAEMON_KEY is set"""

        # Arrange
        @plugin_inner_api_only
        def protected_view():
            return "success"

        # Act
        with app.test_request_context(headers={"X-Inner-Api-Key": "valid_plugin_key"}):
            with patch.object(dify_config, "PLUGIN_DAEMON_KEY", "plugin_key"):
                with patch.object(dify_config, "INNER_API_KEY_FOR_PLUGIN", "valid_plugin_key"):
                    result = protected_view()

        # Assert
        assert result == "success"

    def test_should_return_404_when_plugin_daemon_key_not_set(self, app: Flask):
        """Test that 404 is returned when PLUGIN_DAEMON_KEY is not set"""

        # Arrange
        @plugin_inner_api_only
        def protected_view():
            return "success"

        # Act & Assert
        with app.test_request_context():
            with patch.object(dify_config, "PLUGIN_DAEMON_KEY", ""):
                with pytest.raises(HTTPException) as exc_info:
                    protected_view()
                assert exc_info.value.code == 404

    def test_should_return_404_when_api_key_invalid(self, app: Flask):
        """Test that 404 is returned when X-Inner-Api-Key header is invalid (note: returns 404, not 401)"""

        # Arrange
        @plugin_inner_api_only
        def protected_view():
            return "success"

        # Act & Assert
        with app.test_request_context(headers={"X-Inner-Api-Key": "invalid_key"}):
            with patch.object(dify_config, "PLUGIN_DAEMON_KEY", "plugin_key"):
                with patch.object(dify_config, "INNER_API_KEY_FOR_PLUGIN", "valid_plugin_key"):
                    with pytest.raises(HTTPException) as exc_info:
                        protected_view()
                    assert exc_info.value.code == 404
