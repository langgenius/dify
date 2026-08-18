"""
Unit tests for inner_api auth decorators
"""

from uuid import NAMESPACE_URL, uuid5

import pytest
from flask import Flask
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session
from werkzeug.exceptions import HTTPException

from controllers.inner_api.wraps import (
    billing_inner_api_only,
    enterprise_inner_api_only,
    enterprise_inner_api_user_auth,
    inner_api_only,
    plugin_inner_api_only,
)
from models.enums import EndUserType
from models.model import EndUser


@pytest.fixture(autouse=True)
def _inner_api_config(config_overrides) -> None:
    config_overrides(
        INNER_API=True,
        INNER_API_KEY="valid_key",
        PLUGIN_DAEMON_KEY="plugin_key",
        INNER_API_KEY_FOR_PLUGIN="valid_plugin_key",
    )


def _stable_uuid(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


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
            result = protected_view()

        # Assert
        assert result == "success"

    def test_should_return_404_when_inner_api_disabled(self, app: Flask, config_overrides):
        """Test that 404 is returned when INNER_API is disabled"""

        # Arrange
        @billing_inner_api_only
        def protected_view():
            return "success"

        # Act & Assert
        config_overrides(INNER_API=False)
        with app.test_request_context():
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
            result = protected_view()

        # Assert
        assert result == "success"

    def test_should_return_404_when_inner_api_disabled(self, app: Flask, config_overrides):
        """Test that 404 is returned when INNER_API is disabled"""

        # Arrange
        @enterprise_inner_api_only
        def protected_view():
            return "success"

        # Act & Assert
        config_overrides(INNER_API=False)
        with app.test_request_context():
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
            with pytest.raises(HTTPException) as exc_info:
                protected_view()
            assert exc_info.value.code == 401


class TestInnerApiOnly:
    """Test inner_api_only decorator."""

    def test_should_allow_when_inner_api_enabled_and_valid_key(self, app: Flask):
        @inner_api_only
        def protected_view():
            return "success"

        with app.test_request_context(headers={"X-Inner-Api-Key": "valid_key"}):
            result = protected_view()

        assert result == "success"

    def test_should_return_404_when_inner_api_disabled(self, app: Flask, config_overrides):
        @inner_api_only
        def protected_view():
            return "success"

        config_overrides(INNER_API=False)
        with app.test_request_context():
            with pytest.raises(HTTPException) as exc_info:
                protected_view()
            assert exc_info.value.code == 404

    def test_should_return_401_when_api_key_missing(self, app: Flask):
        @inner_api_only
        def protected_view():
            return "success"

        with app.test_request_context(headers={}):
            with pytest.raises(HTTPException) as exc_info:
                protected_view()
            assert exc_info.value.code == 401

    def test_should_return_401_when_api_key_invalid(self, app: Flask):
        @inner_api_only
        def protected_view():
            return "success"

        with app.test_request_context(headers={"X-Inner-Api-Key": "invalid_key"}):
            with pytest.raises(HTTPException) as exc_info:
                protected_view()
            assert exc_info.value.code == 401


class TestEnterpriseInnerApiUserAuth:
    """Test enterprise_inner_api_user_auth decorator for HMAC-based user authentication"""

    def test_should_pass_through_when_inner_api_disabled(self, app: Flask, config_overrides):
        """Test that request passes through when INNER_API is disabled"""

        # Arrange
        @enterprise_inner_api_user_auth
        def protected_view(**kwargs):
            return kwargs.get("user", "no_user")

        # Act
        config_overrides(INNER_API=False)
        with app.test_request_context():
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
            result = protected_view()

        # Assert
        assert result == "no_user"

    def test_should_pass_through_when_hmac_signature_invalid(self, app: Flask, sqlite_engine: Engine):
        """Invalid HMAC auth passes through without opening a database session."""

        # Arrange
        @enterprise_inner_api_user_auth
        def protected_view(**kwargs):
            return kwargs.get("user", "no_user")

        def fail_on_query(*_args, **_kwargs):
            pytest.fail("invalid HMAC must not access the database")

        event.listen(sqlite_engine, "before_cursor_execute", fail_on_query)
        try:
            with app.test_request_context(
                headers={"Authorization": "Bearer user123:wrong_signature", "X-Inner-Api-Key": "valid_key"}
            ):
                result = protected_view()
        finally:
            event.remove(sqlite_engine, "before_cursor_execute", fail_on_query)

        assert result == "no_user"

    @pytest.mark.parametrize("sqlite_session", [(EndUser,)], indirect=True)
    def test_should_inject_user_when_hmac_signature_valid(self, app: Flask, sqlite_session: Session):
        """Test that user is injected when HMAC signature is valid"""
        # Arrange
        from base64 import b64encode
        from hashlib import sha1
        from hmac import new as hmac_new

        @enterprise_inner_api_user_auth
        def protected_view(**kwargs):
            return kwargs.get("user")

        # Calculate valid HMAC signature
        user_id = _stable_uuid("end-user:user123")
        inner_api_key = "valid_key"
        data_to_sign = f"DIFY {user_id}"
        signature = hmac_new(inner_api_key.encode("utf-8"), data_to_sign.encode("utf-8"), sha1)
        valid_signature = b64encode(signature.digest()).decode("utf-8")

        end_user = EndUser(
            id=user_id,
            tenant_id=_stable_uuid("tenant:inner-api"),
            type=EndUserType.BROWSER,
            name="Inner API User",
            session_id="inner-api-session",
        )
        sqlite_session.add(end_user)
        sqlite_session.commit()

        # Act
        with app.test_request_context(
            headers={"Authorization": f"Bearer {user_id}:{valid_signature}", "X-Inner-Api-Key": inner_api_key}
        ):
            result = protected_view()

        # Assert
        assert isinstance(result, EndUser)
        assert result.id == end_user.id
        assert result.tenant_id == end_user.tenant_id
        assert result.session_id == "inner-api-session"


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
            result = protected_view()

        # Assert
        assert result == "success"

    def test_should_return_404_when_plugin_daemon_key_not_set(self, app: Flask, config_overrides):
        """Test that 404 is returned when PLUGIN_DAEMON_KEY is not set"""

        # Arrange
        @plugin_inner_api_only
        def protected_view():
            return "success"

        # Act & Assert
        config_overrides(PLUGIN_DAEMON_KEY="")
        with app.test_request_context():
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
            with pytest.raises(HTTPException) as exc_info:
                protected_view()
            assert exc_info.value.code == 404
