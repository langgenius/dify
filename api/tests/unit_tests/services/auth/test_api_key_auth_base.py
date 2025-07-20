import pytest

from services.auth.api_key_auth_base import ApiKeyAuthBase


class ConcreteApiKeyAuth(ApiKeyAuthBase):
    """Concrete implementation for testing abstract base class"""

    def validate_credentials(self):
        return True


class TestApiKeyAuthBase:
    def test_should_store_credentials_on_init(self):
        """Test that credentials are properly stored during initialization"""
        credentials = {"api_key": "test_key", "auth_type": "bearer"}
        auth = ConcreteApiKeyAuth(credentials)
        assert auth.credentials == credentials

    def test_should_not_instantiate_abstract_class(self):
        """Test that ApiKeyAuthBase cannot be instantiated directly"""
        credentials = {"api_key": "test_key"}

        with pytest.raises(TypeError) as exc_info:
            ApiKeyAuthBase(credentials)

        assert "Can't instantiate abstract class" in str(exc_info.value)
        assert "validate_credentials" in str(exc_info.value)

    def test_should_allow_subclass_implementation(self):
        """Test that subclasses can properly implement the abstract method"""
        credentials = {"api_key": "test_key", "auth_type": "bearer"}
        auth = ConcreteApiKeyAuth(credentials)

        # Should not raise any exception
        result = auth.validate_credentials()
        assert result is True

    def test_should_handle_empty_credentials(self):
        """Test initialization with empty credentials"""
        credentials = {}
        auth = ConcreteApiKeyAuth(credentials)
        assert auth.credentials == {}

    def test_should_handle_none_credentials(self):
        """Test initialization with None credentials"""
        credentials = None
        auth = ConcreteApiKeyAuth(credentials)
        assert auth.credentials is None
